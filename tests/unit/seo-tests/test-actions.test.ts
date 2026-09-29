// The SEO / GEO Test tab's server actions: signed in and the artist's manager FIRST, then run / fix / read.
/**
 * tools/seo/test-actions.ts. STRICT (server actions, AGENTS.md "Test depth"). Pinned:
 *   • signed out: refused before anything is read, claimed or fetched;
 *   • not this artist's manager (`callerOwns` sees no row): refused the same way;
 *   • "Test again" is a MANUAL run, and a refusal comes back as the plain sentence + seconds;
 *   • the Apple fix changes only this artist's Apple links, through `updateContentAction` (the
 *     Connections edit's door), only when the latest run's `apple` test OFFERS it, with the
 *     address recomputed from the link as it is now; a stranger's call changes nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  owns: true,
  runs: [] as unknown[][],
  runResult: { ok: true, runId: 'run-1', results: [], siteFresh: true, note: null } as Record<string, unknown>,
  updates: [] as { type: string; id: string; artistId: string; url: string | null }[],
  updateError: null as string | null,
  links: [] as { id: string; url: string }[],
  offered: true,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))

let fake = fakeClient()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ ...fake.client, auth: { getUser: async () => ({ data: { user: h.user } }) } })),
}))

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  updateContentAction: vi.fn(async (type: string, id: string, artistId: string, fd: FormData) => {
    h.updates.push({ type, id, artistId, url: fd.get('url') as string | null })
    return h.updateError ? { error: h.updateError } : {}
  }),
}))

vi.mock('@/lib/seo-tests/run', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo-tests/run')>()),
  runSeoTests: vi.fn(async (...args: unknown[]) => (h.runs.push(args), h.runResult)),
  loadEngine: async () => ({
    // As the real one (apple-storefront.ts): another country's store → the US store.
    appleStorefrontFix: (url: string) => (/music\.apple\.com\/(?!us\/)[a-z]{2}\//.test(url) ? url.replace(/music\.apple\.com\/[a-z]{2}\//, 'music.apple.com/us/') : null),
  }),
}))

const A = 'a1'

function world() {
  return fakeClient((c: Call): Reply => {
    // callerOwns: artists select id … maybeSingle, RLS-scoped.
    if (c.table === 'artists') return { data: h.owns ? { id: A } : null }
    if (c.table === 'links') return { data: h.links }
    if (c.table === 'seo_test_runs') {
      const apple = h.offered
        ? { id: 'apple', status: 'fail', value: 'Norway store', sentence: 's', evidence: [], action: { kind: 'fix', fix: 'apple-storefront', label: 'Fix' } }
        : { id: 'apple', status: 'pass', value: 'US store', sentence: 's', evidence: [] }
      return { data: { id: 'run-1', artist_id: A, ran_at: '2026-09-28T21:00:00Z', trigger: 'manual', summary: {}, results: [apple] } }
    }
    return { data: [] }
  })
}

beforeEach(() => {
  h.user = { id: 'u1' }
  h.owns = true
  h.runs = []
  h.runResult = { ok: true, runId: 'run-1', results: [], siteFresh: true, note: null }
  h.updates = []
  h.updateError = null
  h.offered = true
  h.links = [
    { id: 'l-apple', url: 'https://music.apple.com/no/artist/example/123' },
    { id: 'l-spotify', url: 'https://open.spotify.com/artist/1' },
  ]
  fake = world()
})

const actions = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions')

describe('every action checks who is asking FIRST', () => {
  it.each([
    ['runSeoTestsAction', (m: Awaited<ReturnType<typeof actions>>) => m.runSeoTestsAction(A)],
    ['applySeoFixAction', (m: Awaited<ReturnType<typeof actions>>) => m.applySeoFixAction(A, 'apple-storefront')],
    ['readSeoTestsAction', (m: Awaited<ReturnType<typeof actions>>) => m.readSeoTestsAction(A)],
    ['readSeoOverviewAction', (m: Awaited<ReturnType<typeof actions>>) => m.readSeoOverviewAction(A)],
  ])('CRITICAL: %s refuses a signed-out caller and a stranger, touching nothing else', async (_name, call) => {
    const m = await actions()
    h.user = null
    expect(await call(m)).toEqual({ ok: false, error: 'Not signed in.' })
    expect(fake.calls).toEqual([])

    h.user = { id: 'u2' }
    h.owns = false
    expect(await call(m)).toEqual({ ok: false, error: 'Artist not found.' })
    expect(fake.calls.map((c) => c.table)).toEqual(['artists']) // the ownership read, and nothing after it
    expect(h.runs).toEqual([])
    expect(h.updates).toEqual([])
  })
})

describe('Test again', () => {
  it('runs a MANUAL run for this artist', async () => {
    const m = await actions()
    expect(await m.runSeoTestsAction(A)).toMatchObject({ ok: true })
    expect(h.runs).toHaveLength(1)
    expect(h.runs[0].slice(1)).toEqual([A, 'manual'])
  })

  it('a cool-down comes back as the plain sentence and the seconds', async () => {
    h.runResult = { ok: false, reason: 'cooldown', error: 'Tested a moment ago. Try again in 42 seconds.', retryInS: 42 }
    const m = await actions()
    expect(await m.runSeoTestsAction(A)).toEqual({ ok: false, error: 'Tested a moment ago. Try again in 42 seconds.', retryInS: 42 })
  })
})

describe('the Apple storefront fix', () => {
  it('CRITICAL: changes only the Apple link, through updateContentAction (the Connections door), as a draft', async () => {
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: true, changed: 1 })
    expect(h.updates).toEqual([{ type: 'link', id: 'l-apple', artistId: A, url: 'https://music.apple.com/us/artist/example/123' }])
    const read = fake.calls.find((c) => c.table === 'links')!
    expect(read.filters).toContainEqual(['eq', 'artist_id', A])
    // No publish: the fix is a draft the manager publishes.
    expect(fake.calls.some((c) => c.table === 'revisions')).toBe(false)
  })

  it('CRITICAL: refused unless the latest run OFFERS the fix (the US store is right only for a US-based artist)', async () => {
    h.offered = false
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: false, error: 'Test again first: this fix is only for a link the test flagged.' })
    expect(h.updates).toEqual([])
  })

  it('the address written is recomputed from the link as it is NOW, never taken from the stored result', async () => {
    h.links = [{ id: 'l-apple', url: 'https://music.apple.com/gb/artist/example/123' }] // edited since the run
    const m = await actions()
    await m.applySeoFixAction(A, 'apple-storefront')
    expect(h.updates.map((u) => u.url)).toEqual(['https://music.apple.com/us/artist/example/123'])
  })

  it('the link rules refusing the new address stops the fix with their sentence', async () => {
    h.updateError = 'That isn’t an Apple Music artist link.'
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: false, error: 'That isn’t an Apple Music artist link.' })
  })

  it('nothing to fix is said plainly, and an unknown fix is refused', async () => {
    h.links = [{ id: 'l-spotify', url: 'https://open.spotify.com/artist/1' }]
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: false, error: 'No Apple Music link needs this fix.' })
    expect(await m.applySeoFixAction(A, 'nope' as 'apple-storefront')).toEqual({ ok: false, error: 'Unknown fix.' })
    expect(h.updates).toEqual([])
  })
})
