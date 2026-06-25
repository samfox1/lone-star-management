/**
 * bandsintownClient — reads a public artist's upcoming events. No token flow;
 * an app_id query param authenticates. Owns the request, 429 backoff/retry, and
 * error shaping, and maps events to the tour-date input the sync consumes.
 *
 * A factory with injectable fetch/sleep for deterministic tests.
 */

const API_BASE = 'https://rest.bandsintown.com'

/** The shape the tour-dates sync consumes (one Bandsintown event). */
export type BandsintownTourDate = {
  bandsintown_id: string
  date: string // YYYY-MM-DD
  venue: string | null
  city: string | null
  country: string | null
  ticket_url: string | null
}

type BandsintownEvent = {
  id: string | number
  datetime: string
  venue?: { name?: string; city?: string; country?: string }
  offers?: { type?: string; url?: string }[]
  url?: string
}

type Options = {
  appId?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

export function createBandsintownClient(opts: Options = {}) {
  const appId = opts.appId ?? process.env.BANDSINTOWN_APP_ID
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3

  function mapEvent(e: BandsintownEvent): BandsintownTourDate {
    const ticket = e.offers?.find((o) => o.type === 'Tickets')?.url
    return {
      bandsintown_id: String(e.id),
      date: e.datetime.slice(0, 10),
      venue: e.venue?.name ?? null,
      city: e.venue?.city ?? null,
      country: e.venue?.country ?? null,
      ticket_url: ticket ?? e.url ?? null,
    }
  }

  async function getArtistEvents(artistName: string): Promise<BandsintownTourDate[]> {
    if (!appId) {
      throw new Error('Bandsintown app id not configured (BANDSINTOWN_APP_ID).')
    }
    const url = `${API_BASE}/artists/${encodeURIComponent(artistName)}/events?app_id=${encodeURIComponent(appId)}`

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await doFetch(url)
      if (res.status === 429) {
        const parsed = Number(res.headers.get('retry-after') ?? '1')
        const retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : 1 // date-form header → NaN
        await sleep(retryAfter * 1000)
        continue
      }
      if (!res.ok) throw new Error(`Bandsintown API error ${res.status} for ${artistName}`)

      const body = await res.json()
      // Unknown artist returns a non-array body (e.g. { errorMessage }).
      if (!Array.isArray(body)) return []
      return (body as BandsintownEvent[]).map(mapEvent)
    }
    throw new Error(`Bandsintown API rate-limited after ${maxRetries} retries: ${artistName}`)
  }

  return { getArtistEvents }
}

export type BandsintownClient = ReturnType<typeof createBandsintownClient>
