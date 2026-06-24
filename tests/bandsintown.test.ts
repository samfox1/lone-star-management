/**
 * MILESTONE 7 — bandsintownClient, test-first. Mocked at the fetch boundary.
 * Covers: event mapping, 429 retry, error shaping, unknown-artist → [], and the
 * missing-app-id guard.
 */
import { describe, expect, it, vi } from 'vitest'
import { createBandsintownClient } from '@/lib/bandsintown'

function res({ status = 200, headers = {}, body }: { status?: number; headers?: Record<string, string>; body: unknown }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function client(fetchImpl: typeof fetch, appId: string | undefined = 'app123') {
  return createBandsintownClient({ appId, fetchImpl, sleep: () => Promise.resolve() })
}

const EVENT = {
  id: '987',
  datetime: '2026-09-01T20:00:00',
  venue: { name: 'Mohawk', city: 'Austin', country: 'United States' },
  offers: [{ type: 'Tickets', url: 'https://tix.example/987', status: 'available' }],
  url: 'https://www.bandsintown.com/e/987',
}

describe('getArtistEvents', () => {
  it('maps Bandsintown events to tour-date inputs', async () => {
    const fetchImpl = vi.fn(async () => res({ body: [EVENT] }) as unknown as Response)
    const events = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('Lone Pine')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      bandsintown_id: '987',
      date: '2026-09-01',
      venue: 'Mohawk',
      city: 'Austin',
      country: 'United States',
      ticket_url: 'https://tix.example/987',
    })
  })

  it('falls back to the event url when there is no ticket offer', async () => {
    const fetchImpl = vi.fn(async () => res({ body: [{ ...EVENT, offers: [] }] }) as unknown as Response)
    const events = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('Lone Pine')
    expect(events[0].ticket_url).toBe('https://www.bandsintown.com/e/987')
  })

  it('url-encodes the artist name in the request', async () => {
    const fetchImpl = vi.fn(async (_url: string) => res({ body: [] }) as unknown as Response)
    await client(fetchImpl as unknown as typeof fetch).getArtistEvents('AC/DC')
    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('AC%2FDC')
    expect(url).toContain('app_id=app123')
  })

  it('retries after a 429 then succeeds', async () => {
    let hits = 0
    const fetchImpl = vi.fn(async () => {
      hits++
      if (hits === 1) return res({ status: 429, headers: { 'retry-after': '0' }, body: {} }) as unknown as Response
      return res({ body: [EVENT] }) as unknown as Response
    })
    const events = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('x')
    expect(hits).toBe(2)
    expect(events).toHaveLength(1)
  })

  it('returns [] for an unknown artist (non-array body)', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { errorMessage: 'Unknown Artist' } }) as unknown as Response)
    const events = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('nobody')
    expect(events).toEqual([])
  })

  it('throws a shaped error on upstream failure', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 500, body: {} }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getArtistEvents('x')).rejects.toThrow(/bandsintown/i)
  })

  it('throws when no app id is configured', async () => {
    const fetchImpl = vi.fn(async () => res({ body: [] }) as unknown as Response)
    const c = createBandsintownClient({ appId: '', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: () => Promise.resolve() })
    await expect(c.getArtistEvents('x')).rejects.toThrow(/app id/i)
  })
})
