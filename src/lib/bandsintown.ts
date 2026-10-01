/**
 * bandsintownClient — reads a public artist's upcoming events. No token flow;
 * an app_id query param authenticates. Owns the request, 429 backoff/retry, and
 * error shaping, and maps events to the tour-date input the sync consumes.
 *
 * A factory with injectable fetch/sleep for deterministic tests.
 */

import { canonicalCountry } from '@/lib/country'
import { coord } from '@/lib/geo'
import { httpGetJson } from '@/lib/http'
import { parseStartTime } from '@/lib/tour'

const API_BASE = 'https://rest.bandsintown.com'

/** The shape the tour-dates sync consumes (one Bandsintown event). */
export type BandsintownTourDate = {
  bandsintown_id: string
  date: string // YYYY-MM-DD
  /** 24h HH:MM, the venue's local time: `datetime`'s time part. Null if it has none. */
  start_time: string | null
  venue: string | null
  city: string | null
  country: string | null
  ticket_url: string | null
  /** Venue coordinates for the tour map (null when the API omits them). */
  latitude: number | null
  longitude: number | null
}

type BandsintownEvent = {
  id: string | number
  datetime: string
  venue?: { name?: string; city?: string; country?: string; latitude?: string | number; longitude?: string | number }
  offers?: { type?: string; url?: string }[]
  url?: string
}

type Options = {
  appId?: string
  /** Overrides BANDSINTOWN_TERMS_COMPLIANT — for tests. Production never sets this;
   *  the real gate reads the env var. */
  termsCompliant?: boolean
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

/** The one plain sentence a manager sees when the gate is closed, whatever the reason. */
export const BANDSINTOWN_GATE_CLOSED_MESSAGE = "Bandsintown isn't switched on yet."

export function createBandsintownClient(opts: Options = {}) {
  const appId = opts.appId ?? process.env.BANDSINTOWN_APP_ID
  const termsCompliant = opts.termsCompliant ?? process.env.BANDSINTOWN_TERMS_COMPLIANT === 'true'
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3

  function mapEvent(e: BandsintownEvent): BandsintownTourDate {
    const ticket = e.offers?.find((o) => o.type === 'Tickets')?.url
    return {
      bandsintown_id: String(e.id),
      date: e.datetime.slice(0, 10),
      // `datetime` is local to the venue with no zone ("2026-09-01T20:00:00"), which is
      // exactly what start_time holds. Anything else there reads as no time.
      start_time: parseStartTime(e.datetime.slice(11, 16)),
      venue: e.venue?.name ?? null,
      city: e.venue?.city ?? null,
      // Same canonical spelling Ticketmaster writes — both land in tour_dates.country.
      country: canonicalCountry(e.venue?.country),
      ticket_url: ticket ?? e.url ?? null,
      latitude: coord(e.venue?.latitude),
      longitude: coord(e.venue?.longitude),
    }
  }

  async function getArtistEvents(artistName: string): Promise<BandsintownTourDate[]> {
    /**
     * The compliance gate (Sam, 2026-09-28: TODO.md's Bandsintown note was a promise,
     * not a lock — nothing stopped a live pull once BANDSINTOWN_APP_ID was set). Every
     * Bandsintown call goes through this client, so this is the one place it lives:
     * Connect, Sync, Pull now and Retry all end up in `syncBandsintownAction`, which
     * always builds its client here.
     *
     * Opens only when BOTH are true:
     * - `BANDSINTOWN_APP_ID` is set (granted by emailing support@bandsintown.com — see
     *   the README's "Sync / integration" section).
     * - `BANDSINTOWN_TERMS_COMPLIANT` is the exact string `"true"` — hand-set only once
     *   the README's compliance checklist is actually done (attribution + Track/RSVP/
     *   Notify Me buttons on the public tour page, upstream-removal cleanup in the
     *   sync, written approval for commercial use — see the README's "Known gaps").
     *
     * No dev exception: both checks run the same in every environment. Bandsintown's
     * terms don't change for NODE_ENV, and this repo's existing dev-only hatches
     * (`custom-site.ts`'s loopback allowance, `supabase/middleware.ts`'s dev auto-login)
     * exist for local convenience, not for skipping a third party's terms.
     */
    if (!appId || !termsCompliant) {
      throw new Error(BANDSINTOWN_GATE_CLOSED_MESSAGE)
    }
    const url = `${API_BASE}/artists/${encodeURIComponent(artistName)}/events?app_id=${encodeURIComponent(appId)}`
    const body = await httpGetJson<unknown>(url, {
      fetchImpl: doFetch,
      sleep,
      maxRetries,
      provider: 'Bandsintown',
    })
    // Unknown artist returns a non-array body (e.g. { errorMessage }).
    if (!Array.isArray(body)) return []
    return (body as BandsintownEvent[]).map(mapEvent)
  }

  return { getArtistEvents }
}

export type BandsintownClient = ReturnType<typeof createBandsintownClient>
