// The Ticketmaster client: mapping events, paging, backing off, and shaping errors.
/**
 * PHASE 4 — ticketmasterClient, test-first. Mocked at the fetch boundary (fast,
 * deterministic, no key). Covers mapping, page-number pagination, empty results,
 * 429 backoff, shaped errors, and missing-key handling. Mirrors spotify/
 * bandsintown clients.
 */
import { describe, expect, it, vi } from 'vitest'
import { createBandsintownClient } from '@/lib/bandsintown'
import { createTicketmasterClient } from '@/lib/ticketmaster'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }
function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function client(fetchImpl: typeof fetch) {
  return createTicketmasterClient({ apiKey: 'k', fetchImpl, sleep: () => Promise.resolve() })
}

// Discovery v2's real venue shape: the long country NAME plus a separate
// countryCode, and lat/lng as strings. A fixture with country:{name:'US'} made the
// mapper look like it emitted a code and hid the clash with Bandsintown's long name.
const venue = (over: Record<string, unknown> = {}) => ({
  name: 'The Venue',
  city: { name: 'Austin' },
  country: { name: 'United States Of America', countryCode: 'US' },
  location: { latitude: '30.2672', longitude: '-97.7431' },
  ...over,
})

const event = (id: string, date = '2026-09-01', venueOver: Record<string, unknown> = {}) => ({
  id,
  url: `https://ticketmaster.com/event/${id}`,
  dates: { start: { localDate: date } },
  _embedded: { venues: [venue(venueOver)] },
})

const page = (events: unknown[], number = 0, totalPages = 1) => ({
  _embedded: { events },
  page: { number, totalPages },
})

describe('getArtistEvents', () => {
  it('maps events to the tour-date shape', async () => {
    const fetchImpl = vi.fn(async () => res({ body: page([event('e1')]) }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('K123')
    expect(out).toEqual([
      {
        ticketmaster_id: 'e1',
        date: '2026-09-01',
        venue: 'The Venue',
        city: 'Austin',
        country: 'United States',
        ticket_url: 'https://ticketmaster.com/event/e1',
        latitude: 30.2672,
        longitude: -97.7431,
      },
    ])
  })

  // Number('') is 0, so a blank coordinate would pin the show to 0,0 — Null Island,
  // in the Gulf of Guinea — on the tour map, which looks like real data.
  it('maps venue coordinates to numbers, and null when missing/blank/non-numeric', async () => {
    const fetchImpl = vi.fn(
      async () =>
        res({
          body: page([
            event('e1', '2026-09-01', { location: undefined }),
            event('e2', '2026-09-02', { location: { latitude: '', longitude: '   ' } }),
            event('e3', '2026-09-03', { location: { latitude: 'n/a', longitude: '-97.7431' } }),
            event('e4', '2026-09-04', { location: { latitude: 30.2672, longitude: -97.7431 } }),
          ]),
        }) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('K123')
    expect(out.map((e) => [e.latitude, e.longitude])).toEqual([
      [null, null],
      [null, null],
      [null, -97.7431],
      [30.2672, -97.7431], // already numeric, passed through
    ])
  })

  it('falls back to countryCode when the venue has no country name', async () => {
    const fetchImpl = vi.fn(
      async () =>
        res({ body: page([event('e1', '2026-09-01', { country: { countryCode: 'GB' } })]) }) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('K123')
    expect(out[0].country).toBe('United Kingdom')
  })

  it('returns null country when the venue has none', async () => {
    const fetchImpl = vi.fn(
      async () => res({ body: page([event('e1', '2026-09-01', { country: undefined })]) }) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('K123')
    expect(out[0].country).toBeNull()
  })

  it('follows page-number pagination and concatenates', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      (url.includes('page=1')
        ? res({ body: page([event('e2')], 1, 2) })
        : res({ body: page([event('e1')], 0, 2) })) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('K123')
    expect(out.map((e) => e.ticketmaster_id)).toEqual(['e1', 'e2'])
  })

  it('returns [] when there are no events', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { page: { number: 0, totalPages: 0 } } }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('K123')
    expect(out).toEqual([])
  })

  it('retries on 429 with Retry-After backoff', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return (calls === 1
        ? res({ status: 429, headers: { 'retry-after': '2' }, body: {} })
        : res({ body: page([event('e1')]) })) as unknown as Response
    })
    const c = createTicketmasterClient({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, sleep })
    const out = await c.getArtistEvents('K123')
    expect(out).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('throws a shaped error on HTTP failure', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 500, body: {} }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getArtistEvents('K123')).rejects.toThrow(/500/)
  })

  it('throws when no API key is configured', async () => {
    const c = createTicketmasterClient({ fetchImpl: (async () => res({ body: {} })) as unknown as typeof fetch })
    await expect(c.getArtistEvents('K123')).rejects.toThrow(/Ticketmaster/i)
  })

  // Ticketmaster refuses size*page >= 1000, and a totalPages it keeps re-reporting
  // would page forever. The mock refuses an extra page so a missing cap fails loud.
  it('stops at maxPages even when totalPages says there is more', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls > 3) throw new Error('paged past maxPages')
      return res({ body: page([event(`e${calls}`)], calls - 1, 99) }) as unknown as Response
    })
    const c = createTicketmasterClient({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxPages: 3,
    })
    const out = await c.getArtistEvents('K123')
    expect(calls).toBe(3)
    expect(out.map((e) => e.ticketmaster_id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('gives up after maxRetries when the 429 never clears', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 429, headers: { 'retry-after': '0' }, body: {} }) as unknown as Response)
    const c = createTicketmasterClient({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxRetries: 2,
    })
    await expect(c.getArtistEvents('K123')).rejects.toThrow(/rate-limited after 2 retries/)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // attempt + 2 retries, then stop
  })
})

/**
 * Both clients write into the SAME tour_dates.country column, so a country has to
 * come out spelled one way whichever source found the show. Ticketmaster's
 * "United States Of America" and Bandsintown's "United States" are the real payloads.
 */
describe('country agrees across sources', () => {
  const tmEvent = (countryName: string) =>
    page([{ id: 'e1', dates: { start: { localDate: '2026-09-01' } }, _embedded: { venues: [venue({ country: { name: countryName, countryCode: 'US' } })] } }])

  it('Ticketmaster and Bandsintown emit the same string for the same country', async () => {
    const tmFetch = vi.fn(async () => res({ body: tmEvent('United States Of America') }) as unknown as Response)
    const tm = await client(tmFetch as unknown as typeof fetch).getArtistEvents('K123')

    const bitFetch = vi.fn(
      async () =>
        res({
          body: [
            {
              id: '987',
              datetime: '2026-09-01T20:00:00',
              venue: { name: 'Mohawk', city: 'Austin', country: 'United States' },
              url: 'https://www.bandsintown.com/e/987',
            },
          ],
        }) as unknown as Response,
    )
    const bit = await createBandsintownClient({
      appId: 'app123',
      fetchImpl: bitFetch as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
    }).getArtistEvents('Lone Pine')

    expect(tm[0].country).toBe('United States')
    expect(bit[0].country).toBe(tm[0].country)
  })

  // "USA" is not a payload Bandsintown is known to send. Feeding it to BOTH clients
  // pins that both paths run the same normalizer, so the day either API changes its
  // spelling the two sources still land one value in the column.
  it('runs both mappers through the same normalizer', async () => {
    const tmFetch = vi.fn(async () => res({ body: tmEvent('USA') }) as unknown as Response)
    const tm = await client(tmFetch as unknown as typeof fetch).getArtistEvents('K123')

    const bitFetch = vi.fn(
      async () =>
        res({
          body: [{ id: '1', datetime: '2026-09-01T20:00:00', venue: { name: 'Mohawk', country: 'USA' } }],
        }) as unknown as Response,
    )
    const bit = await createBandsintownClient({
      appId: 'app123',
      fetchImpl: bitFetch as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
    }).getArtistEvents('Lone Pine')

    expect(tm[0].country).toBe('United States')
    expect(bit[0].country).toBe('United States')
  })
})
