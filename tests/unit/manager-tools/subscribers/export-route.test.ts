// The subscribers CSV export: who gets it, and exactly what is in it.
/**
 * GET /artists/[id]/subscribers/export (Sam, 2026-09-24). The toolbar's "Download CSV" is a
 * plain link here. What this pins:
 *   - OWNER-ONLY, by the same check the dashboard actions make (`requireOwnedArtist`), and
 *     FIRST: a signed-out caller or a non-owner gets a 404 before a single subscriber row is
 *     read, and the 404 carries no CSV headers;
 *   - the read goes through the CALLER's client (RLS), scoped to this artist, and it is the
 *     FULL list: every page past PostgREST's 1000-row cap, and never the page's search;
 *   - the body is `email,subscribed_at`, newest first, escaped and injection-guarded, and the
 *     response is an uncached attachment named `<slug>-subscribers-<YYYY-MM-DD>.csv`.
 *
 * The Supabase client is a small PostgREST-shaped fake that records every call in order, so
 * "before any read" is an assertion on that order, not on a comment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = {
  table: string
  cols?: string
  opts?: { count?: string }
  eq: [string, unknown][]
  order: [string, { ascending?: boolean } | undefined][]
  range?: [number, number]
  terminal?: 'single' | 'maybeSingle'
}

type World = {
  user: { id: string } | null
  owner: boolean
  slug: string
  subscribers: { id: string; email: string; created_at: string }[]
  /** PostgREST's max_rows: a page never holds more than this. */
  maxRows: number
  readError: boolean
}

let world: World
let calls: Call[]

function fakeClient() {
  const from = (table: string) => {
    const call: Call = { table, eq: [], order: [] }
    const chain = {
      select(cols: string, opts?: { count?: string }) {
        call.cols = cols
        call.opts = opts
        return chain
      },
      eq(col: string, v: unknown) {
        call.eq.push([col, v])
        return chain
      },
      order(col: string, o?: { ascending?: boolean }) {
        call.order.push([col, o])
        return chain
      },
      range(a: number, b: number) {
        call.range = [a, b]
        return chain
      },
      single() {
        call.terminal = 'single'
        return chain
      },
      maybeSingle() {
        call.terminal = 'maybeSingle'
        return chain
      },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        calls.push(call)
        return Promise.resolve(reply(call)).then(ok, bad)
      },
    }
    return chain
  }
  return {
    auth: { getUser: async () => ({ data: { user: world.user } }) },
    from,
  }
}

/** What the database would answer, RLS included: a non-owner sees no artist and no rows. */
function reply(call: Call) {
  if (call.table === 'artists') {
    return world.owner ? { data: { id: 'a1', slug: world.slug }, error: null } : { data: null, error: { message: 'no rows' } }
  }
  if (call.table === 'subscribers') {
    if (world.readError) return { data: null, error: { message: 'boom' }, count: null }
    const visible = world.owner ? world.subscribers : []
    // The fake honours the ORDER the route asks for, so paging is tested for real.
    const sorted = [...visible].sort((a, b) => {
      for (const [col, o] of call.order) {
        const k = col as 'created_at' | 'id'
        const d = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0
        if (d) return o?.ascending === false ? -d : d
      }
      return 0
    })
    const [lo, hi] = call.range ?? [0, Infinity]
    const page = sorted.slice(lo, Math.min(hi + 1, lo + world.maxRows))
    return { data: page.map(({ email, created_at }) => ({ email, created_at })), error: null, count: call.opts?.count === 'exact' ? visible.length : null }
  }
  return { data: null, error: null }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() }))

import { GET } from '@/app/artists/[id]/(dashboard)/(manager-tools)/subscribers/export/route'

const call = (id = 'a1', query = '') =>
  GET(new Request(`http://x/artists/${id}/subscribers/export${query}`), { params: Promise.resolve({ id }) })

const SUBS = [
  { id: 's1', email: 'old@x.io', created_at: '2026-07-01T10:00:00+00:00' },
  { id: 's2', email: '=HYPERLINK("http://evil")@x.io', created_at: '2026-08-01T10:00:00+00:00' },
  { id: 's3', email: 'new@x.io', created_at: '2026-09-22T23:30:00+00:00' },
]

beforeEach(() => {
  calls = []
  world = { user: { id: 'u1' }, owner: true, slug: 'lone-pine', subscribers: SUBS, maxRows: 1000, readError: false }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

const subscriberReads = () => calls.filter((c) => c.table === 'subscribers')

describe('subscribers export — who gets a CSV', () => {
  it('CRITICAL: a non-owner gets a 404 with no CSV headers, and not one subscriber row is read', async () => {
    world.owner = false
    const res = await call()
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type') ?? '').not.toContain('text/csv')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(subscriberReads()).toEqual([])
    // The gate that refused is the dashboard's ownership read of THIS artist.
    expect(calls.some((c) => c.table === 'artists' && c.eq.some(([k, v]) => k === 'id' && v === 'a1'))).toBe(true)
  })

  it('CRITICAL: a signed-out caller gets a 404 and nothing is read', async () => {
    world.user = null
    const res = await call()
    expect(res.status).toBe(404)
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(calls).toEqual([])
  })

  it('the ownership check comes BEFORE the first subscriber read', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const gate = calls.findIndex((c) => c.table === 'artists')
    const firstRead = calls.findIndex((c) => c.table === 'subscribers')
    expect(gate).toBeGreaterThanOrEqual(0)
    expect(firstRead).toBeGreaterThan(gate)
  })

  it('reads through the caller’s client, scoped to this artist', async () => {
    await call()
    const reads = subscriberReads()
    expect(reads.length).toBeGreaterThan(0)
    for (const r of reads) expect(r.eq).toContainEqual(['artist_id', 'a1'])
  })
})

describe('subscribers export — the file', () => {
  it('an owner gets an uncached CSV attachment named <slug>-subscribers-<today>.csv', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="lone-pine-subscribers-2026-09-24.csv"')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('CRITICAL: the body is email,subscribed_at, NEWEST first, ISO days, formula cells guarded', async () => {
    const body = await (await call()).text()
    expect(body).toBe(
      ['email,subscribed_at', 'new@x.io,2026-09-22', `"'=HYPERLINK(""http://evil"")@x.io",2026-08-01`, 'old@x.io,2026-07-01'].join('\r\n') + '\r\n',
    )
  })

  it('CRITICAL: the FULL list, past the 1000-row page cap', async () => {
    world.subscribers = Array.from({ length: 2345 }, (_, i) => ({
      id: `s${String(i).padStart(5, '0')}`,
      email: `fan${i}@x.io`,
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    }))
    const lines = (await (await call()).text()).trimEnd().split('\r\n')
    expect(lines).toHaveLength(1 + 2345)
    // Every subscriber exactly once: paging neither skipped nor repeated a row.
    expect(new Set(lines.slice(1).map((l) => l.split(',')[0])).size).toBe(2345)
    expect(subscriberReads().length).toBeGreaterThan(2)
  })

  it('the full list even when the server pages smaller than we ask', async () => {
    world.maxRows = 250
    world.subscribers = Array.from({ length: 600 }, (_, i) => ({
      id: `s${String(i).padStart(4, '0')}`,
      email: `fan${i}@x.io`,
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    }))
    const lines = (await (await call()).text()).trimEnd().split('\r\n')
    expect(lines).toHaveLength(1 + 600)
  })

  it('ignores the page’s search: a ?q= on the link still exports everyone', async () => {
    const lines = (await (await call('a1', '?q=new')).text()).trimEnd().split('\r\n')
    expect(lines).toHaveLength(1 + SUBS.length)
  })

  it('no subscribers: the header alone, still a CSV', async () => {
    world.subscribers = []
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('email,subscribed_at\r\n')
  })

  it('a failed read is an error, never an empty-looking CSV', async () => {
    world.readError = true
    const res = await call()
    expect(res.status).toBe(502)
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
