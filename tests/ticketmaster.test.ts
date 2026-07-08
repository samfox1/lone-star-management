/**
 * PHASE 4 — ticketmasterClient, test-first. Mocked at the fetch boundary (fast,
 * deterministic, no key). Covers mapping, page-number pagination, empty results,
 * 429 backoff, shaped errors, and missing-key handling. Mirrors spotify/
 * bandsintown clients.
 */
import { describe, expect, it, vi } from 'vitest'
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

const event = (id: string, date = '2026-09-01') => ({
  id,
  url: `https://ticketmaster.com/event/${id}`,
  dates: { start: { localDate: date } },
  _embedded: {
    venues: [
      { name: 'The Venue', city: { name: 'Austin' }, country: { name: 'US' }, location: { latitude: '30.2672', longitude: '-97.7431' } },
    ],
  },
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
        country: 'US',
        ticket_url: 'https://ticketmaster.com/event/e1',
        latitude: 30.2672,
        longitude: -97.7431,
      },
    ])
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
})
