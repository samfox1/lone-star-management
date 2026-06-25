/**
 * ticketmasterClient — reads a public artist's events from the Discovery API.
 * An `apikey` query param authenticates (no token flow). Owns pagination (by page
 * number, bounded — Ticketmaster caps size*page < 1000), 429 backoff/retry, and
 * error shaping, and maps events to the tour-date input the sync consumes.
 *
 * Resolve the artist to an ATTRACTION id once (cached on the artist); this client
 * pulls events for that attraction. A factory with injectable fetch/sleep.
 */

import { httpGetJson } from '@/lib/http'

const API_BASE = 'https://app.ticketmaster.com/discovery/v2'

/** The shape the tour-dates sync consumes (one Ticketmaster event). */
export type TicketmasterTourDate = {
  ticketmaster_id: string
  date: string // YYYY-MM-DD
  venue: string | null
  city: string | null
  country: string | null
  ticket_url: string | null
}

type TmVenue = { name?: string; city?: { name?: string }; country?: { name?: string } }
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
      country: venue?.country?.name ?? null,
      ticket_url: e.url ?? null,
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

export type TicketmasterClient = ReturnType<typeof createTicketmasterClient>
