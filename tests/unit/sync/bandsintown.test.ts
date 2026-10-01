// The Bandsintown client: mapping events, retrying a rate limit, and shaping errors.
/**
 * MILESTONE 7 — bandsintownClient, test-first. Mocked at the fetch boundary.
 * Covers: event mapping, 429 retry, error shaping, unknown-artist → [], and the
 * missing-app-id guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BANDSINTOWN_GATE_CLOSED_MESSAGE, createBandsintownClient } from '@/lib/bandsintown'

function res({ status = 200, headers = {}, body }: { status?: number; headers?: Record<string, string>; body: unknown }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

// Every non-gate test below is about event mapping/retry/error-shaping, not the gate
// itself, so it opens the gate explicitly (appId + termsCompliant) rather than relying
// on ambient env vars nobody set.
function client(fetchImpl: typeof fetch, appId: string | undefined = 'app123') {
  return createBandsintownClient({ appId, termsCompliant: true, fetchImpl, sleep: () => Promise.resolve() })
}

const EVENT = {
  id: '987',
  datetime: '2026-09-01T20:00:00',
  venue: { name: 'Mohawk', city: 'Austin', country: 'United States', latitude: '30.2672', longitude: '-97.7431' },
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
      // The local time part of `datetime`, as 24h HH:MM (20261001140000).
      start_time: '20:00',
      venue: 'Mohawk',
      city: 'Austin',
      country: 'United States',
      ticket_url: 'https://tix.example/987',
      latitude: 30.2672,
      longitude: -97.7431,
    })
  })

  it('maps venue coordinates to numbers, and null when missing/non-numeric', async () => {
    const noCoords = { ...EVENT, venue: { name: 'Mohawk', city: 'Austin', country: 'US' } }
    const badCoords = { ...EVENT, venue: { ...EVENT.venue, latitude: '', longitude: 'n/a' } }
    const fetchImpl = vi.fn(async () => res({ body: [noCoords, badCoords] }) as unknown as Response)
    const events = await client(fetchImpl as unknown as typeof fetch).getArtistEvents('Lone Pine')
    expect(events[0].latitude).toBeNull()
    expect(events[0].longitude).toBeNull()
    expect(events[1].latitude).toBeNull()
    expect(events[1].longitude).toBeNull()
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

  it('throws when no app id is configured (the gate is closed)', async () => {
    const fetchImpl = vi.fn(async () => res({ body: [] }) as unknown as Response)
    const c = createBandsintownClient({ appId: '', termsCompliant: true, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: () => Promise.resolve() })
    await expect(c.getArtistEvents('x')).rejects.toThrow(BANDSINTOWN_GATE_CLOSED_MESSAGE)
  })
})

describe('compliance gate (BANDSINTOWN_APP_ID + BANDSINTOWN_TERMS_COMPLIANT)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** A fetch mock that fails the test outright if the gate ever lets a call through. */
  function witnessFetch() {
    return vi.fn(async () => {
      throw new Error('fetch must not be called while the Bandsintown gate is closed')
    }) as unknown as typeof fetch
  }

  it('is closed without an app id, even when the terms flag is true — and never calls fetch', async () => {
    const fetchImpl = witnessFetch()
    const c = createBandsintownClient({ appId: '', termsCompliant: true, fetchImpl, sleep: () => Promise.resolve() })
    await expect(c.getArtistEvents('x')).rejects.toThrow(BANDSINTOWN_GATE_CLOSED_MESSAGE)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is closed with an app id but no compliance flag — and never calls fetch', async () => {
    const fetchImpl = witnessFetch()
    const c = createBandsintownClient({ appId: 'app123', fetchImpl, sleep: () => Promise.resolve() })
    await expect(c.getArtistEvents('x')).rejects.toThrow(BANDSINTOWN_GATE_CLOSED_MESSAGE)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is closed with an app id and the compliance flag explicitly false — and never calls fetch', async () => {
    const fetchImpl = witnessFetch()
    const c = createBandsintownClient({ appId: 'app123', termsCompliant: false, fetchImpl, sleep: () => Promise.resolve() })
    await expect(c.getArtistEvents('x')).rejects.toThrow(BANDSINTOWN_GATE_CLOSED_MESSAGE)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is open when both the app id and the compliance flag are set', async () => {
    const fetchImpl = vi.fn(async () => res({ body: [] }) as unknown as Response)
    const c = createBandsintownClient({ appId: 'app123', termsCompliant: true, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: () => Promise.resolve() })
    await expect(c.getArtistEvents('x')).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reads both env vars directly when no options override them (the real production path)', async () => {
    const fetchImpl = witnessFetch()
    vi.stubEnv('BANDSINTOWN_APP_ID', '')
    vi.stubEnv('BANDSINTOWN_TERMS_COMPLIANT', '')
    const closed = createBandsintownClient({ fetchImpl, sleep: () => Promise.resolve() })
    await expect(closed.getArtistEvents('x')).rejects.toThrow(BANDSINTOWN_GATE_CLOSED_MESSAGE)
    expect(fetchImpl).not.toHaveBeenCalled()

    const openFetch = vi.fn(async () => res({ body: [] }) as unknown as Response)
    vi.stubEnv('BANDSINTOWN_APP_ID', 'app123')
    vi.stubEnv('BANDSINTOWN_TERMS_COMPLIANT', 'true')
    const open = createBandsintownClient({ fetchImpl: openFetch as unknown as typeof fetch, sleep: () => Promise.resolve() })
    await expect(open.getArtistEvents('x')).resolves.toEqual([])
    expect(openFetch).toHaveBeenCalledTimes(1)
  })

  it('only "true" (exact string) opens the flag — a typo stays closed', async () => {
    const fetchImpl = witnessFetch()
    const c = createBandsintownClient({ appId: 'app123', fetchImpl, sleep: () => Promise.resolve(), termsCompliant: false })
    vi.stubEnv('BANDSINTOWN_APP_ID', 'app123')
    vi.stubEnv('BANDSINTOWN_TERMS_COMPLIANT', 'TRUE')
    // Options were passed explicitly as false above; this second client relies purely on env.
    const c2 = createBandsintownClient({ fetchImpl, sleep: () => Promise.resolve() })
    await expect(c.getArtistEvents('x')).rejects.toThrow(BANDSINTOWN_GATE_CLOSED_MESSAGE)
    await expect(c2.getArtistEvents('x')).rejects.toThrow(BANDSINTOWN_GATE_CLOSED_MESSAGE)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
