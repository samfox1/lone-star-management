/**
 * EVENTBRITE'S API, READ — the artist's organizations and organizer pages (for "Connect with
 * Eventbrite") and their upcoming public events as tour dates (Sam, 2026-09-28: "by adding
 * eventbrite, I will allow users to be redirected to the artist's event information via
 * eventbrite"). The sign-in itself is `lib/eventbrite-oauth.ts`; the write is
 * `syncEventbriteTourDates` (lib/sync.ts), deciding with `planTourPull` (lib/tour-pull.ts).
 *
 * THE TOKEN. Every call here is made with the artist's own OAuth token (Eventbrite v3 has
 * no anonymous access and no app-only token: "every request to the OAuth API must be
 * authenticated", tokens "are tied to user accounts"). It rides in the Authorization header
 * only — never a URL, never an error message — and this module never stores it.
 *
 * Endpoints (Eventbrite API v3, https://www.eventbrite.com/platform/api):
 *   GET /users/me/organizations/                 the organizations the account belongs to
 *   GET /organizations/{id}/organizers/          an organization's public organizer pages
 *   GET /organizations/{id}/events/              its events; `organizer_filter`, `status`,
 *                                                `time_filter=current_future`, `expand=venue`
 * Lists are paged with a `continuation` token and `has_more_items`.
 *
 * Every id that goes into a path is checked to be digits BEFORE the request is built.
 */
import { platformFromUrl } from '@samfox1/site-bridge/social'
import { canonicalCountry } from './country'
import { coord } from './geo'
import { US_STATES } from './us-states'
import type { IncomingShow } from './tour-pull'

export const EVENTBRITE_API = 'https://www.eventbriteapi.com/v3'
/** Eventbrite's ids (organization, organizer, event) are digits. */
export const EVENTBRITE_ID = /^[0-9]{1,20}$/
const TIMEOUT_MS = 10_000
/** 50 per page: 20 pages is 1,000 upcoming events — far past any artist, short of a loop. */
const MAX_PAGES = 20

/** A refusal or a malformed answer. `auth`: the token is no longer good (the artist changed
 *  their password, or removed Tapir); `rate`: Eventbrite's hourly limit. The message is ours
 *  and never holds the token (at most Eventbrite's own UPPER_CASE error code). */
export class EventbriteApiError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate' | 'http' | 'shape',
    message: string,
  ) {
    super(message)
    this.name = 'EventbriteApiError'
  }
}

export type EventbriteOrganization = { id: string; name: string }
export type EventbriteOrganizer = { organizationId: string; id: string; name: string; url: string }

// ── One event → one show ───────────────────────────────────────────────────────────────

/** Statuses that are still a show to go to. `started` = it is on now. */
const UPCOMING = new Set(['live', 'started'])
const US_CODES = new Set(US_STATES.map((s) => s.code))
const LOCAL_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T/

type RawAddress = { city?: unknown; region?: unknown; country?: unknown; latitude?: unknown; longitude?: unknown } | null
type RawEvent = {
  id?: unknown
  url?: unknown
  status?: unknown
  listed?: unknown
  invite_only?: unknown
  password?: unknown
  online_event?: unknown
  start?: { timezone?: unknown; local?: unknown; utc?: unknown } | null
  venue?: { name?: unknown; latitude?: unknown; longitude?: unknown; address?: RawAddress } | null
}

function text(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function coordOf(v: unknown): number | null {
  return typeof v === 'string' || typeof v === 'number' ? coord(v) : null
}

/** The show's own calendar date: the local start, or the UTC start seen from the event's
 *  timezone. Null when neither can be read. */
function localDate(start: RawEvent['start']): string | null {
  const local = typeof start?.local === 'string' ? start.local : null
  if (local) return LOCAL_DATE.test(local) ? local.slice(0, 10) : null
  const utc = typeof start?.utc === 'string' ? new Date(start.utc) : null
  const zone = typeof start?.timezone === 'string' ? start.timezone : null
  if (!utc || Number.isNaN(utc.getTime()) || !zone) return null
  try {
    // en-CA formats as YYYY-MM-DD.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(utc)
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
  } catch {
    return null // an unknown timezone
  }
}

/** The event's own page, only as an https link the site reads as Eventbrite's. */
function eventPage(url: unknown): string | null {
  if (typeof url !== 'string') return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  return platformFromUrl(u.toString())?.slug === 'eventbrite' ? u.toString() : null
}

/**
 * One Eventbrite event as a tour date, or null when it must not land: not public (unlisted,
 * invite-only, password), not upcoming (draft, cancelled, ended, completed), no readable
 * date, no https Eventbrite page to send fans to, or an id that is not one.
 */
export function showFromEvent(raw: unknown): IncomingShow | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as RawEvent
  const id = typeof e.id === 'number' ? String(e.id) : e.id
  if (typeof id !== 'string' || !EVENTBRITE_ID.test(id)) return null
  if (typeof e.status !== 'string' || !UPCOMING.has(e.status)) return null
  if (e.listed === false || e.invite_only === true) return null
  if (typeof e.password === 'string' && e.password !== '') return null
  const date = localDate(e.start)
  if (!date) return null
  const ticket = eventPage(e.url)
  if (!ticket) return null

  if (e.online_event === true) {
    return { externalId: id, values: { date, venue: 'Online', city: null, state: null, country: null, ticket_url: ticket, latitude: null, longitude: null } }
  }
  const venue = e.venue && typeof e.venue === 'object' ? e.venue : null
  const address = venue?.address && typeof venue.address === 'object' ? venue.address : null
  const iso = text(address?.country, 8)
  const region = text(address?.region, 8)
  return {
    externalId: id,
    values: {
      date,
      venue: text(venue?.name),
      city: text(address?.city),
      // The state column takes a real US state code or nothing (its CHECK).
      state: iso?.toUpperCase() === 'US' && region && US_CODES.has(region.toUpperCase()) ? region.toUpperCase() : null,
      country: canonicalCountry(iso),
      ticket_url: ticket,
      latitude: coordOf(venue?.latitude ?? address?.latitude),
      longitude: coordOf(venue?.longitude ?? address?.longitude),
    },
  }
}

// ── The client ─────────────────────────────────────────────────────────────────────────

/** Eventbrite's `error` field, only when it is the UPPER_CASE code it should be. */
function errorCode(json: unknown): string {
  const e = (json as { error?: unknown } | null)?.error
  return typeof e === 'string' && /^[A-Z_]{1,64}$/.test(e) ? ` ${e}` : ''
}

/** An https organizer page the site reads as Eventbrite's, or the plain `/o/<id>` page. */
function organizerPage(url: unknown, id: string): string {
  return (typeof url === 'string' && url.startsWith('https://') && platformFromUrl(url)?.slug === 'eventbrite' ? url : null) ?? `https://www.eventbrite.com/o/${id}`
}

export function createEventbriteClient(opts: { fetchImpl?: typeof fetch; maxPages?: number } = {}) {
  const doFetch = opts.fetchImpl ?? fetch
  const maxPages = opts.maxPages ?? MAX_PAGES

  async function get(path: string, token: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${EVENTBRITE_API}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await doFetch(url.toString(), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const code = errorCode(json)
      if (res.status === 401 || code === ' INVALID_AUTH' || code === ' NO_AUTH') {
        throw new EventbriteApiError('auth', 'Eventbrite no longer accepts this sign-in. Connect with Eventbrite again.')
      }
      if (res.status === 429) throw new EventbriteApiError('rate', 'Eventbrite is busy (rate limit). Try again in a few minutes.')
      throw new EventbriteApiError('http', `Eventbrite refused the request (HTTP ${res.status}${code}).`)
    }
    if (!json || typeof json !== 'object') throw new EventbriteApiError('shape', 'Eventbrite sent something that isn’t JSON.')
    return json
  }

  /** Every item under `key`, following the continuation up to the page cap. */
  async function all(path: string, token: string, key: string, params: Record<string, string> = {}): Promise<unknown[]> {
    const items: unknown[] = []
    let continuation: string | null = null
    for (let page = 0; page < maxPages; page++) {
      const body = await get(path, token, continuation ? { ...params, continuation } : params)
      const list = body[key]
      if (Array.isArray(list)) items.push(...list)
      const p = body.pagination as { has_more_items?: unknown; continuation?: unknown } | undefined
      continuation = p?.has_more_items === true && typeof p.continuation === 'string' && p.continuation ? p.continuation : null
      if (!continuation) break
    }
    return items
  }

  function checkId(id: string, what: string) {
    if (!EVENTBRITE_ID.test(id)) throw new EventbriteApiError('shape', `That isn’t an Eventbrite ${what} id.`)
  }

  return {
    async listOrganizations(token: string): Promise<EventbriteOrganization[]> {
      const raw = await all('/users/me/organizations/', token, 'organizations')
      return raw.flatMap((o) => {
        const { id, name } = (o ?? {}) as { id?: unknown; name?: unknown }
        const sid = typeof id === 'number' ? String(id) : id
        return typeof sid === 'string' && EVENTBRITE_ID.test(sid) ? [{ id: sid, name: text(name) ?? '' }] : []
      })
    },

    async listOrganizers(token: string, organizationId: string): Promise<EventbriteOrganizer[]> {
      checkId(organizationId, 'organization')
      const raw = await all(`/organizations/${organizationId}/organizers/`, token, 'organizers')
      return raw.flatMap((o) => {
        const { id, name, url } = (o ?? {}) as { id?: unknown; name?: unknown; url?: unknown }
        const sid = typeof id === 'number' ? String(id) : id
        if (typeof sid !== 'string' || !EVENTBRITE_ID.test(sid)) return []
        return [{ organizationId, id: sid, name: text(name) ?? '', url: organizerPage(url, sid) }]
      })
    },

    /** The organizer's upcoming public events in this organization, as shows. */
    async listUpcomingShows(token: string, organizationId: string, organizerId: string): Promise<IncomingShow[]> {
      checkId(organizationId, 'organization')
      checkId(organizerId, 'organizer')
      const raw = await all(`/organizations/${organizationId}/events/`, token, 'events', {
        organizer_filter: organizerId,
        status: 'live,started',
        time_filter: 'current_future',
        order_by: 'start_asc',
        expand: 'venue',
        page_size: '50',
      })
      return raw.flatMap((e) => {
        const show = showFromEvent(e)
        return show ? [show] : []
      })
    },
  }
}

export type EventbriteClient = ReturnType<typeof createEventbriteClient>
