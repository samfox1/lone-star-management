/**
 * ticketmasterClient — reads a public artist's events from the Discovery API.
 * An `apikey` query param authenticates (no token flow). Owns pagination (by page
 * number, bounded — Ticketmaster caps size*page < 1000), 429 backoff/retry, and
 * error shaping, and maps events to the tour-date input the sync consumes.
 *
 * Resolve the artist to an ATTRACTION id once (cached on the artist); this client
 * pulls events for that attraction. A factory with injectable fetch/sleep.
 *
 * Also exports `ticketmasterAttractionId`, a pure parser for what the manager types into
 * that field: keeps asking for the id itself (Sam, 2026-09-28: no name-search flow — an
 * attraction id is what the Discovery API needs, so that is what gets asked for), but
 * reads it straight out of a pasted Ticketmaster artist-page link so the manager never has
 * to dig it out by hand.
 */

import { canonicalCountry } from '@/lib/country'
import { coord } from '@/lib/geo'
import { httpGetJson } from '@/lib/http'

const API_BASE = 'https://app.ticketmaster.com/discovery/v2'

/**
 * Whatever the manager pastes into the Ticketmaster field — a bare attraction id (used
 * as is, trimmed) or their artist page link (`ticketmaster.com/<slug>/artist/<id>`, any
 * regional host — `.co.uk`, `.ca`, `.com.au`… — query string and all) — as the id to
 * save, or the one sentence explaining what to paste instead. Pure: no network.
 *
 * Attraction ids are Ticketmaster's own global id scheme (letters, digits, sometimes an
 * underscore — e.g. `K8vZ917_szV7`), NOT necessarily numeric, so a bare id is accepted by
 * shape (URL-safe characters), never assumed to be digits-only.
 */
export function ticketmasterAttractionId(input: string): { id: string } | { error: string } {
  const error = { error: 'Paste the Ticketmaster attraction ID or your artist page link.' }
  const text = input.trim()
  if (!text) return error

  const looksLikeLink = /^https?:\/\//i.test(text) || text.includes('/') || text.toLowerCase().includes('ticketmaster.')
  if (!looksLikeLink) return /^[A-Za-z0-9_-]+$/.test(text) ? { id: text } : error

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return error
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
  if (!/^ticketmaster\.[a-z.]+$/.test(host)) return error

  const artist = url.pathname.match(/\/artist\/([A-Za-z0-9_-]+)/i)
  return artist ? { id: artist[1] } : error
}

/** The shape the tour-dates sync consumes (one Ticketmaster event). */
export type TicketmasterTourDate = {
  ticketmaster_id: string
  date: string // YYYY-MM-DD
  venue: string | null
  city: string | null
  country: string | null
  ticket_url: string | null
  /** Venue coordinates for the tour map (null when the API omits them). */
  latitude: number | null
  longitude: number | null
}

type TmVenue = {
  name?: string
  city?: { name?: string }
  /** Discovery v2 sends both: name "United States Of America", countryCode "US". */
  country?: { name?: string; countryCode?: string }
  location?: { latitude?: string | number; longitude?: string | number }
}

type TmEvent = {
  id: string
  url?: string
  dates?: { start?: { localDate?: string } }
  _embedded?: { venues?: TmVenue[] }
}
type TmPage = {
  _embedded?: { events?: TmEvent[] }
  page?: { number?: number; totalPages?: number }
}

type Options = {
  apiKey?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  maxPages?: number
}

export function createTicketmasterClient(opts: Options = {}) {
  const apiKey = opts.apiKey ?? process.env.TICKETMASTER_API_KEY
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const maxPages = opts.maxPages ?? 10 // size 100 * 10 = 1000, the deep-paging cap

  function apiGet(path: string): Promise<TmPage> {
    if (!apiKey) throw new Error('Ticketmaster API key not configured (TICKETMASTER_API_KEY).')
    const url = `${API_BASE}${path}&apikey=${encodeURIComponent(apiKey)}`
    return httpGetJson<TmPage>(url, { fetchImpl: doFetch, sleep, maxRetries, provider: 'Ticketmaster' })
  }

  function map(e: TmEvent): TicketmasterTourDate {
    const venue = e._embedded?.venues?.[0]
    return {
      ticketmaster_id: e.id,
      date: e.dates?.start?.localDate ?? '',
      venue: venue?.name ?? null,
      city: venue?.city?.name ?? null,
      // Canonicalised so Ticketmaster and Bandsintown dates in the same table read
      // the same ("United States Of America" and "United States" are one country).
      country: canonicalCountry(venue?.country?.name ?? venue?.country?.countryCode),
      ticket_url: e.url ?? null,
      latitude: coord(venue?.location?.latitude),
      longitude: coord(venue?.location?.longitude),
    }
  }

  /** Every upcoming event for an attraction id, across pages. */
  async function getArtistEvents(attractionId: string): Promise<TicketmasterTourDate[]> {
    const out: TicketmasterTourDate[] = []
    let page = 0
    let totalPages = 1
    while (page < totalPages && page < maxPages) {
      const data = await apiGet(
        `/events.json?attractionId=${encodeURIComponent(attractionId)}&size=100&page=${page}`,
      )
      totalPages = data.page?.totalPages ?? 1
      for (const e of data._embedded?.events ?? []) out.push(map(e))
      page++
    }
    return out
  }

  return { getArtistEvents }
}
