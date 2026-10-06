// Publish ships the IndexNow key with the site text and pings once afterwards; a ping never fails a publish.
/**
 * The IndexNow wiring in the publish actions (actions.ts `publishGated` + src/lib/indexnow.ts).
 *
 * STRICT (AGENTS.md "Test depth"): this touches Publish, the one path whose failure loses
 * a manager's work, and adds an outbound call to it. What is pinned:
 *   • the key is written to the draft BEFORE the snapshot, by the publishes that ship site
 *     text, so it goes live in that same publish (and never sits as a pending change);
 *   • an existing key is never replaced; a template site never gets one;
 *   • every successful gated publish schedules ONE ping, Brand's excepted; a refused or
 *     failed publish schedules none;
 *   • no failure in any of it (the key write, `after` itself, the ping) fails the publish;
 *   • only the system writes the key: the editor's field path refuses it.
 *
 * DB-free over the PostgREST fake; `after` is captured so each test decides whether the
 * scheduled ping runs; `fetch` is a stub, so nothing reaches the network. The password gate,
 * the fake and the list of publish actions come from tests/helpers/publish-world.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INDEXNOW_CONTENT_KEY, INDEXNOW_KEY_PATH, INDEXNOW_VERSION_HEADER, isIndexNowKey } from '@samfox1/site-bridge/indexnow'
import { INDEXNOW_ENDPOINT } from '@/lib/indexnow'
import { saveEditorField } from '@/lib/site-editor/save'
import { fakeClient, filterValue } from '@tests/helpers/fake-client'
import { A, WRONG_PASSWORD, gate, isKeyWrite, publishCases, setWorld, world as baseWorld, type World } from '@tests/helpers/publish-world'

const h = vi.hoisted(() => ({ after: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: h.after }))
// The SEO / GEO test run is scheduled beside the ping (its own `after`); this suite counts the
// PING's `after` only. The run's scheduling is pinned in tests/unit/seo-tests/runs/publish-hook.test.ts.
vi.mock('@/lib/seo-tests/after-publish', () => ({ scheduleSeoTestRun: vi.fn() }))
// The sitemap resend to Google is scheduled beside it too (its own `after`), pinned in
// tests/unit/seo-tests/runs/publish-hook.test.ts and tests/unit/search-engines/resubmit.test.ts.
vi.mock('@/lib/search-engines/resubmit', () => ({ scheduleSitemapResubmit: vi.fn() }))
// The ping reads the site through lib/net-guard's transport, never the global fetch (the SSRF
// guard, pinned in tests/unit/safe-fetching/blocked-before-connecting.test.ts). This suite is about WHEN a
// publish pings, so the default transport is pointed at the stubbed `fetch` below.
vi.mock('@/lib/net-guard', async (orig) => ({
  ...(await orig<typeof import('@/lib/net-guard')>()),
  pickTransport: (fetcher?: typeof fetch) => fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)),
}))
vi.mock('@supabase/supabase-js', async (orig) => (await import('@tests/helpers/publish-world')).passwordMock(orig))
vi.mock('@/lib/supabase/server', async () => (await import('@tests/helpers/publish-world')).serverMock)

const KEY = '0123456789abcdef0123456789abcdef'
const ORIGIN = 'https://www.skeenmusic.com'
/** The shared world, on a custom site that can be pinged unless a test says otherwise. */
const world = (w: World = {}) => setWorld(baseWorld({ site: { site_kind: 'custom', custom_site_url: `${ORIGIN}/` }, ...w }))
let fake = world()

/** A live site that serves `served` as its key, and an IndexNow that says 200. */
function stubNetwork(served = KEY) {
  const seen: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    if (url === `${ORIGIN}${INDEXNOW_KEY_PATH}`) return new Response(served, { status: 200, headers: { [INDEXNOW_VERSION_HEADER]: '0.42.0' } })
    if (url === INDEXNOW_ENDPOINT) return new Response(null, { status: 200 })
    return new Response('', { status: 404 })
  })
  return { seen, pings: () => seen.filter((u) => u === INDEXNOW_ENDPOINT) }
}

/** Run whatever the publish scheduled with `after`, as Next would once the response is sent. */
async function runScheduled() {
  for (const [cb] of h.after.mock.calls) await (cb as () => Promise<void>)()
}

const keyWrites = () => fake.calls.filter(isKeyWrite)
const revisionInsertAt = () => fake.calls.findIndex((c) => c.table === 'revisions' && c.op === 'insert')

beforeEach(() => {
  fake = world()
  h.after.mockReset()
  gate.error = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the key goes live WITH the site text', () => {
  it.each(publishCases((e) => e.shipsSiteText))('CRITICAL: $name writes a new key to the draft BEFORE the snapshot', async ({ run }) => {
    const actions = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await run(actions)).toEqual({ ok: true })
    const writes = keyWrites()
    expect(writes).toHaveLength(1)
    const idx = fake.calls.indexOf(writes[0])
    expect(idx, 'key written').toBeGreaterThanOrEqual(0)
    expect(idx, 'before the one revisions insert, so the snapshot carries it').toBeLessThan(revisionInsertAt())
    const row = writes[0].payload as { artist_id: string; key: string; value: string }
    expect(row.artist_id).toBe(A)
    expect(isIndexNowKey(row.value)).toBe(true)
    expect(writes[0].options).toEqual({ onConflict: 'artist_id,key' })
  })

  it('an existing key is kept: it is never rotated by a publish', async () => {
    fake = world({ key: KEY })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: true })
    expect(keyWrites()).toEqual([])
  })

  it('a malformed key is replaced', async () => {
    fake = world({ key: 'not a key' })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await publishAction(A, 'pw')
    expect(keyWrites()).toHaveLength(1)
  })

  it('a site that can never be pinged gets no key (template, preview, localhost)', async () => {
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    for (const site of [
      { site_kind: 'template', custom_site_url: null },
      { site_kind: 'custom', custom_site_url: 'https://wren-site-theta.vercel.app' },
      { site_kind: 'custom', custom_site_url: 'http://localhost:3004' },
    ]) {
      fake = world({ site })
      expect(await publishAction(A, 'pw')).toEqual({ ok: true })
      expect(keyWrites(), site.custom_site_url ?? site.site_kind).toEqual([])
    }
  })

  it('a wrong password writes no key', async () => {
    gate.error = WRONG_PASSWORD
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'nope')).toEqual({ ok: false, error: 'Incorrect password.' })
    expect(keyWrites()).toEqual([])
  })
})

describe('one ping per publish', () => {
  it.each(publishCases((e) => e.pings))('CRITICAL: $name schedules exactly one ping, and it posts once', async ({ run }) => {
    fake = world({ key: KEY })
    const net = stubNetwork()
    const actions = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await run(actions)).toEqual({ ok: true })
    expect(h.after).toHaveBeenCalledTimes(1)
    expect(net.seen, 'nothing leaves before the response').toEqual([])
    await runScheduled()
    expect(net.pings()).toHaveLength(1)
  })

  it("Brand's publish does not ping: colours and fonts change no page's words", async () => {
    fake = world({ key: KEY })
    const { publishBrandWithPasswordAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishBrandWithPasswordAction(A, 'pw')).toEqual({ ok: true })
    expect(h.after).not.toHaveBeenCalled()
  })

  it('a wrong password schedules nothing', async () => {
    gate.error = WRONG_PASSWORD
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await publishAction(A, 'nope')
    expect(h.after).not.toHaveBeenCalled()
  })

  it('CRITICAL: a publish that FAILED schedules nothing: nothing new is live to announce', async () => {
    fake = world({ key: KEY, insertError: true })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: false, error: 'insert refused' })
    expect(h.after).not.toHaveBeenCalled()
  })

  it('the first publish with a new key does not ping yet: the site is not serving it', async () => {
    const net = stubNetwork('ffffffffffffffffffffffffffffffff') // the site still has no (or an old) key
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await publishAction(A, 'pw')
    await runScheduled()
    expect(net.pings()).toEqual([])
  })
})

describe('a ping never fails a publish', () => {
  it('CRITICAL: `after` itself throwing (outside a request) still returns ok', async () => {
    fake = world({ key: KEY })
    h.after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.')
    })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: true })
  })

  it('CRITICAL: the scheduled ping resolves even when every request throws', async () => {
    fake = world({ key: KEY })
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: true })
    await expect(runScheduled()).resolves.toBeUndefined()
  })

  it('CRITICAL: IndexNow refusing (429) is logged quietly, never thrown', async () => {
    fake = world({ key: KEY })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${ORIGIN}${INDEXNOW_KEY_PATH}`) return new Response(KEY, { status: 200, headers: { [INDEXNOW_VERSION_HEADER]: '0.42.0' } })
      if (url === INDEXNOW_ENDPOINT) return new Response(null, { status: 429 })
      return new Response('', { status: 404 })
    })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: true })
    await expect(runScheduled()).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('429'))
  })

  it('CRITICAL: the key write failing does not stop the publish', async () => {
    fake = world({ upsertError: true })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: true })
    expect(revisionInsertAt()).toBeGreaterThanOrEqual(0)
  })

  it('the state read failing does not stop the publish either', async () => {
    fake = setWorld(fakeClient((c) => {
      if (c.table === 'site_content' && filterValue(c, 'key') === INDEXNOW_CONTENT_KEY) throw new Error('socket hang up')
      if (c.op === 'rpc') return { data: [] }
      if (c.table === 'artists') return { data: { name: 'Fake' } }
      return { data: [{ id: `${c.table}-1`, artist_id: A }], count: 1 }
    }))
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: true })
    // …and the ping, which reads the same row after the response, swallows it too.
    await expect(runScheduled()).resolves.toBeUndefined()
  })
})

describe('only the system writes the key', () => {
  it("CRITICAL: a custom site's field named after it is refused, and nothing is written", async () => {
    const f = fakeClient()
    expect(await saveEditorField(f.client, A, null, INDEXNOW_CONTENT_KEY, KEY)).toEqual({ ok: false, error: 'That field name is reserved.' })
    expect(f.writes()).toEqual([])
  })
})
