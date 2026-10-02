/**
 * The SEO / GEO page's server actions check that the caller is signed in and manages the artist
 * FIRST, then run the tests, apply a fix, or read the results.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions.ts
 *           (runSeoTestsAction, applySeoFixAction, readSeoTestsAction)
 * Feature:  SEO / GEO page · AI test tab actions; the `apple` test's fix (Facts are true)
 * Tier:     STRICT (AGENTS.md "Test depth"): server actions (permissions), and the fix writes a link.
 * Covers:   • signed out, or not this artist's manager: refused before anything is read, run or written
 *           • "Test again" is a MANUAL run written by the service role in the manager's name
 *           • a refusal (limit, cool-down, busy) comes back as a reason + seconds beside the sentence
 *           • reading the Test tab: table missing = "off", any other failure = "error", else "ready"
 *           • the Apple fix changes only this artist's Apple link, through the Connections door,
 *             as a draft, only when the latest run OFFERS it, with the address worked out from
 *             the link as it is NOW
 * Not here: the run itself (tests/unit/seo-tests/runs/running.test.ts); how the Test tab reads its data
 *           (tests/unit/manager-tools/seo/test-tab-model.test.ts); the Apple store rule itself
 *           (src/lib/seo-tests/apple-storefront.ts, with the SEO tests under tests/unit/seo-tests/).
 * Fixtures: the signed-in user, ownership and the stored runs come from a PostgREST fake; the
 *           run, the engine's Apple rule and updateContentAction are mocks; the service-role
 *           client is a marker object so a test can see which client a write was handed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, type Call, type Reply } from '@tests/helpers/fake-client'

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  owns: true,
  runs: [] as unknown[][],
  runResult: { ok: true, runId: 'run-1', results: [], siteFresh: true, note: null } as Record<string, unknown>,
  updates: [] as { type: string; id: string; artistId: string; url: string | null }[],
  updateError: null as string | null,
  links: [] as { id: string; url: string }[],
  offered: true,
  runsError: null as { code?: string; message: string } | null,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
// The service-role client: a marker, so a test can see WHICH client a write was handed.
const ADMIN = { role: 'service' }
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ADMIN }))

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
      if (h.runsError) return { error: h.runsError }
      const apple = h.offered
        ? { id: 'apple', status: 'fail', value: 'Norway store', sentence: 's', evidence: [], action: { kind: 'fix', fix: 'apple-storefront', label: 'Fix' } }
        : { id: 'apple', status: 'pass', value: 'US store', sentence: 's', evidence: [] }
      const row = { id: 'run-1', artist_id: A, ran_at: '2026-09-28T21:00:00Z', trigger: 'manual', status: 'done', summary: { apple: apple.status }, results: [apple] }
      // One row for a `maybeSingle` read; a list for the history read and the probe.
      if (c.terminal === 'maybeSingle') return { data: c.filters.some(([, col, v]) => col === 'status' && v === 'running') ? null : row }
      return { data: [row] }
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
  h.runsError = null
  h.links = [
    { id: 'l-apple', url: 'https://music.apple.com/no/artist/example/123' },
    { id: 'l-spotify', url: 'https://open.spotify.com/artist/1' },
  ]
  fake = world()
})

const actions = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions')

describe('every action checks who is asking FIRST', () => {
  // Who is asking: every action refuses a signed-out caller and a stranger before touching anything else.
  it.each([
    ['runSeoTestsAction', (m: Awaited<ReturnType<typeof actions>>) => m.runSeoTestsAction(A)],
    ['applySeoFixAction', (m: Awaited<ReturnType<typeof actions>>) => m.applySeoFixAction(A, 'apple-storefront')],
    ['readSeoTestsAction', (m: Awaited<ReturnType<typeof actions>>) => m.readSeoTestsAction(A)],
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
  // Test again: a manual run, written by the service role, read through the manager's own session.
  it('CRITICAL: runs a MANUAL run for this artist, written by the SERVICE ROLE in the signed-in manager\'s name', async () => {
    const m = await actions()
    expect(await m.runSeoTestsAction(A)).toMatchObject({ ok: true })
    expect(h.runs).toHaveLength(1)
    expect(h.runs[0].slice(1, 3)).toEqual([A, 'manual'])
    const who = h.runs[0][3] as { writer: unknown; userId: string }
    expect(who.writer).toBe(ADMIN)
    expect(who.userId).toBe('u1')
    // The reader stays the manager's own session.
    expect(h.runs[0][0]).not.toBe(ADMIN)
  })

  // Refusals: each comes back with its reason and seconds beside the sentence, so the page never reads the words.
  it.each([
    { reason: 'limit', error: 'You’ve started a lot of tests lately. Try again in 30 minutes.', retryInS: 1800 },
    { reason: 'cooldown', error: 'Tested a moment ago. Try again in 42 seconds.', retryInS: 42 },
    { reason: 'busy', error: 'A test is already running. It will show here when it finishes.', retryInS: null },
  ])('CRITICAL: a $reason refusal comes back machine-readable: reason + seconds, beside the plain sentence', async (refusal) => {
    h.runResult = { ok: false, ...refusal }
    const m = await actions()
    expect(await m.runSeoTestsAction(A)).toEqual({ ok: false, ...refusal })
  })
})

describe('reading the Test tab: "not switched on" is its own state', () => {
  // Not switched on: the table missing (migration not pushed) is "off", not an error.
  it('CRITICAL: the table not being there yet (migration not pushed) is state "off", not an error', async () => {
    const m = await actions()
    for (const err of [
      { code: 'PGRST205', message: "Could not find the table 'public.seo_test_runs' in the schema cache" },
      { code: '42P01', message: 'relation "public.seo_test_runs" does not exist' },
    ]) {
      h.runsError = err
      expect(await m.readSeoTestsAction(A), err.code).toEqual({ ok: true, state: 'off' })
    }
  })

  // Any other failed read is "error" with a plain sentence, never "off" or "never tested".
  it('CRITICAL: any other read failure is state "error" with a plain sentence, never "off" or "never tested"', async () => {
    h.runsError = { code: '42501', message: 'permission denied for table seo_test_runs' }
    const m = await actions()
    expect(await m.readSeoTestsAction(A)).toEqual({ ok: false, state: 'error', error: 'Couldn’t read the test results.' })
  })

  // Switched on: "ready" with the latest run, the history dots and any run in progress.
  it('switched on: state "ready" with the latest run, the history dots and any run in progress', async () => {
    const m = await actions()
    const out = await m.readSeoTestsAction(A)
    expect(out).toMatchObject({ ok: true, state: 'ready', running: null })
    if (out.ok && out.state === 'ready') {
      expect(out.latest?.id).toBe('run-1')
      expect(out.history.apple.map((d) => d.status)).toEqual(['fail'])
    }
  })
})

describe('the Apple storefront fix', () => {
  // The fix: only the Apple link, through the Connections door, left as a draft for the manager to publish.
  it('CRITICAL: changes only the Apple link, through updateContentAction (the Connections door), as a draft', async () => {
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: true, changed: 1 })
    expect(h.updates).toEqual([{ type: 'link', id: 'l-apple', artistId: A, url: 'https://music.apple.com/us/artist/example/123' }])
    const read = fake.calls.find((c) => c.table === 'links')!
    expect(read.filters).toContainEqual(['eq', 'artist_id', A])
    // No publish: the fix is a draft the manager publishes.
    expect(fake.calls.some((c) => c.table === 'revisions')).toBe(false)
  })

  // Only when offered: the US store is right only for a US-based artist, so the test must have flagged it.
  it('CRITICAL: refused unless the latest run OFFERS the fix (the US store is right only for a US-based artist)', async () => {
    h.offered = false
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: false, error: 'Test again first: this fix is only for a link the test flagged.' })
    expect(h.updates).toEqual([])
  })

  // Now, not then: the new address is worked out from the link as it is now, never from the stored result.
  it('the address written is recomputed from the link as it is NOW, never taken from the stored result', async () => {
    h.links = [{ id: 'l-apple', url: 'https://music.apple.com/gb/artist/example/123' }] // edited since the run
    const m = await actions()
    await m.applySeoFixAction(A, 'apple-storefront')
    expect(h.updates.map((u) => u.url)).toEqual(['https://music.apple.com/us/artist/example/123'])
  })

  // The link rules still apply: their refusal stops the fix, in their words.
  it('the link rules refusing the new address stops the fix with their sentence', async () => {
    h.updateError = 'That isn’t an Apple Music artist link.'
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: false, error: 'That isn’t an Apple Music artist link.' })
  })

  // Nothing to fix, or an unknown fix: said plainly, nothing written.
  it('nothing to fix is said plainly, and an unknown fix is refused', async () => {
    h.links = [{ id: 'l-spotify', url: 'https://open.spotify.com/artist/1' }]
    const m = await actions()
    expect(await m.applySeoFixAction(A, 'apple-storefront')).toEqual({ ok: false, error: 'No Apple Music link needs this fix.' })
    expect(await m.applySeoFixAction(A, 'nope' as 'apple-storefront')).toEqual({ ok: false, error: 'Unknown fix.' })
    expect(h.updates).toEqual([])
  })
})
