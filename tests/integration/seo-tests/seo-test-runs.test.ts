// The kept SEO / GEO runs in the real database: a manager's session can READ its runs and nothing else; the service-role functions are the only write path, with cool-downs, coalescing, per-person limits, retention and immutability.
/**
 * supabase/migrations/20260929140000_seo_test_runs.sql against the HOSTED project.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ NOT RUN until the migration is pushed. Flip MIGRATION_PUSHED to true in the SAME change  │
 * │ as `npm run db:push`, then run this file (and `npm run audit:grants`).                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * STRICT (AGENTS.md: RLS, grants, data). Every denial has a planted witness (rule 2), every
 * refused write is checked by row STATE through the service client (rule 3), and every row lives
 * on a throwaway artist (rule 6): never Skeen, never the seed artists' data.
 *
 * The 2026-09-29 security review's attacks are cases here: a manager forging a run, skipping the
 * cool-down by claiming as "publish", and wiping the history (direct delete, or 35 claims to make
 * retention prune it). Each was reproduced on the first version of this migration and must now be
 * refused.
 *
 * Not pinned here, said plainly: the 5-minute "abandoned run" sweep and the hourly per-person
 * ceiling (30). ran_at is stamped by the database, so a client cannot backdate a row, and 30 real
 * runs are too slow for this suite; both were checked on a throwaway local Postgres instead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimRun, failRun, finishRun } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, type SeoTestResult } from '@/lib/seo-tests/types'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectExecuteDenied, expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const MIGRATION_PUSHED = false

const results = (fails: number): SeoTestResult[] =>
  SEO_TEST_IDS.map((id, i) => ({ id, status: i < fails ? 'fail' : 'pass', value: 'v', sentence: 's.', evidence: [{ label: 'seen', value: id }] }))

describe.skipIf(!MIGRATION_PUSHED)('seo_test_runs', () => {
  let svc: SupabaseClient
  let mA: SupabaseClient
  let mB: SupabaseClient
  let uA: string
  let uB: string
  const made: ThrowawayArtist[] = []
  let A: ThrowawayArtist

  const rowsOf = async (artistId: string) => {
    const { data, error } = await svc.from('seo_test_runs').select('*').eq('artist_id', artistId).order('ran_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Record<string, unknown>[]
  }
  const fresh = async (label: string, manager = mA) => {
    const a = await createThrowawayArtist(svc, label, manager)
    made.push(a)
    return a
  }

  beforeAll(async () => {
    svc = serviceClient()
    mA = await signInAs(SEED.managerA)
    mB = await signInAs(SEED.managerB)
    uA = (await mA.auth.getUser()).data.user!.id
    uB = (await mB.auth.getUser()).data.user!.id
    A = await fresh('seo-runs A')
    // The witness every denial below is measured against: one finished run on A.
    const claim = await claimRun(svc, A.id, 'manual', { userId: uA })
    if (!claim.ok) throw new Error(`witness claim: ${claim.error}`)
    const done = await finishRun(svc, claim.runId, { results: results(2), siteUrl: 'https://www.example-artist.com', siteFresh: true, publishedAt: null })
    if (!done.ok) throw new Error('witness finish')
  })

  afterAll(async () => {
    for (const a of made) await deleteThrowawayArtist(svc, a)
  })

  describe('a manager\'s browser session can read its runs and write NOTHING', () => {
    it('CRITICAL: reads its own artist\'s runs; the database derived passed/total/summary from the results', async () => {
      const { data, error } = await mA.from('seo_test_runs').select('status, passed, total, summary, started_by').eq('artist_id', A.id)
      expect(error).toBeNull()
      expect(data).toEqual([expect.objectContaining({ status: 'done', passed: SEO_TEST_IDS.length - 2, total: SEO_TEST_IDS.length, started_by: uA })])
      expect(Object.keys((data![0] as { summary: object }).summary).sort()).toEqual([...SEO_TEST_IDS].sort())
    })

    it('CRITICAL: cannot FORGE a run (insert a finished one) or skip the cool-down by claiming as "publish"', async () => {
      const before = (await rowsOf(A.id)).length
      expect(before).toBeGreaterThan(0)
      const attempts: Record<string, unknown>[] = [
        { artist_id: A.id, trigger: 'publish', started_by: uA },
        { artist_id: A.id, trigger: 'manual', status: 'done', results: results(0), started_by: uA },
      ]
      for (const row of attempts) {
        const { error } = await mA.from('seo_test_runs').insert(row)
        expectRlsDenied(error, 'a manager\'s insert')
      }
      expect((await rowsOf(A.id)).length).toBe(before)
    })

    it('CRITICAL: cannot rewrite a run or wipe the history (update, delete)', async () => {
      const [before] = await rowsOf(A.id)
      const up = await mA.from('seo_test_runs').update({ passed: 24, note: 'forged' }).eq('artist_id', A.id)
      expectRlsDenied(up.error, 'a manager\'s update')
      const del = await mA.from('seo_test_runs').delete().eq('artist_id', A.id)
      expectRlsDenied(del.error, 'a manager\'s delete')
      const [after] = await rowsOf(A.id)
      expect(after).toEqual(before)
    })

    it('CRITICAL: cannot call either write function (so no forged results, no cool-down games, no prune by 35 claims)', async () => {
      const [before] = await rowsOf(A.id)
      const claim = await mA.rpc('seo_test_claim', { p_artist_id: A.id, p_trigger: 'publish', p_user_id: uA, p_published_at: null })
      expectExecuteDenied(claim.error, 'seo_test_claim')
      const finish = await mA.rpc('seo_test_finish', { p_run_id: before.id, p_status: 'done', p_results: results(0), p_site_url: null, p_site_fresh: true, p_published_at: null, p_note: null })
      expectExecuteDenied(finish.error, 'seo_test_finish')
      expect((await rowsOf(A.id))[0]).toEqual(before)
    })

    it('manager B reads none of A\'s runs', async () => {
      expect((await rowsOf(A.id)).length).toBeGreaterThan(0)
      const { data } = await mB.from('seo_test_runs').select('id').eq('artist_id', A.id)
      expect(data).toEqual([])
    })

    it('CRITICAL: anon can read none and call neither function', async () => {
      expect((await rowsOf(A.id)).length).toBeGreaterThan(0)
      const anon = anonClient()
      expectRlsDenied((await anon.from('seo_test_runs').select('id').eq('artist_id', A.id)).error, 'anon read')
      expectExecuteDenied((await anon.rpc('seo_test_claim', { p_artist_id: A.id, p_trigger: 'manual', p_user_id: uA, p_published_at: null })).error, 'seo_test_claim')
    })
  })

  describe('the service role writes only through the functions, which enforce the rules', () => {
    it('CRITICAL: even the service role cannot write the table directly', async () => {
      const before = (await rowsOf(A.id)).length
      expectRlsDenied((await svc.from('seo_test_runs').insert({ artist_id: A.id, trigger: 'scheduled' })).error, 'service insert')
      expectRlsDenied((await svc.from('seo_test_runs').delete().eq('artist_id', A.id)).error, 'service delete')
      expect((await rowsOf(A.id)).length).toBe(before)
    })

    it('CRITICAL: a person who does not manage the artist is denied, even through the service role', async () => {
      expect(await claimRun(svc, A.id, 'manual', { userId: uB })).toMatchObject({ ok: false, reason: 'denied' })
    })

    it('CRITICAL: a manual run inside 60 s of the last one (its start or its finish) is refused, with the seconds left', async () => {
      const out = await claimRun(svc, A.id, 'manual', { userId: uA })
      expect(out).toMatchObject({ ok: false, reason: 'cooldown' })
      if (!out.ok) expect(out.retryInS).toBeGreaterThan(0)
    })

    it('CRITICAL: publish runs: one per publish (coalesced) and one per 60 s, never a way around the cool-down', async () => {
      const P = await fresh('seo-runs publish')
      const t1 = new Date(Date.now() - 5_000).toISOString()
      const first = await claimRun(svc, P.id, 'publish', { userId: uA, publishedAt: t1 })
      expect(first.ok).toBe(true)
      if (first.ok) await finishRun(svc, first.runId, { results: results(0), siteUrl: null, siteFresh: null, publishedAt: t1 })
      // The same publish again: already covered.
      expect(await claimRun(svc, P.id, 'publish', { userId: uA, publishedAt: t1 })).toMatchObject({ ok: false, reason: 'coalesced' })
      // A newer publish inside the minute: refused, with the seconds left.
      expect(await claimRun(svc, P.id, 'publish', { userId: uA, publishedAt: new Date().toISOString() })).toMatchObject({ ok: false, reason: 'cooldown' })
      // And "Test again" right after the publish's run finished: refused too.
      expect(await claimRun(svc, P.id, 'manual', { userId: uA })).toMatchObject({ ok: false, reason: 'cooldown' })
      expect(await rowsOf(P.id)).toHaveLength(1)
    })

    it('CRITICAL: while a run is running, no other run starts; the race of three clicks makes exactly ONE', async () => {
      const C = await fresh('seo-runs race')
      const outs = await Promise.all([1, 2, 3].map(() => claimRun(svc, C.id, 'manual', { userId: uA })))
      expect(outs.filter((o) => o.ok)).toHaveLength(1)
      expect(outs.filter((o) => !o.ok).every((o) => !o.ok && o.reason === 'busy')).toBe(true)
      expect(await rowsOf(C.id)).toHaveLength(1)
      const running = outs.find((o) => o.ok)
      if (running?.ok) await failRun(svc, running.runId, 'race test')
    })

    it('CRITICAL: one person, many artists: at most 2 runs at once', async () => {
      const [x, y, z] = [await fresh('seo-runs person x'), await fresh('seo-runs person y'), await fresh('seo-runs person z')]
      const a = await claimRun(svc, x.id, 'manual', { userId: uA })
      const b = await claimRun(svc, y.id, 'manual', { userId: uA })
      expect(a.ok && b.ok).toBe(true)
      expect(await claimRun(svc, z.id, 'manual', { userId: uA })).toMatchObject({ ok: false, reason: 'limit' })
      for (const o of [a, b]) if (o.ok) await failRun(svc, o.runId, 'limit test')
    })

    it('CRITICAL: a finished run is immutable: finishing it again changes nothing', async () => {
      const [before] = await rowsOf(A.id)
      expect(await finishRun(svc, before.id as string, { results: results(24), siteUrl: null, siteFresh: false, publishedAt: null })).toMatchObject({ ok: false })
      expect((await rowsOf(A.id))[0]).toEqual(before)
    })

    it('`reach` is stored as given, and a malformed one is refused by the table', async () => {
      const R = await fresh('seo-runs reach')
      const claim = await claimRun(svc, R.id, 'scheduled', { userId: null })
      if (!claim.ok) throw new Error(claim.error)
      expect(await finishRun(svc, claim.runId, { results: results(0), siteUrl: null, siteFresh: null, publishedAt: null, reach: { state: 'server-error', status: 503 } })).toEqual({ ok: true })
      expect((await rowsOf(R.id))[0].reach).toEqual({ state: 'server-error', status: 503 })
      const next = await claimRun(svc, R.id, 'scheduled', { userId: null })
      if (!next.ok) throw new Error(next.error)
      const { error } = await svc.rpc('seo_test_finish', { p_run_id: next.runId, p_status: 'done', p_results: results(0), p_site_url: null, p_site_fresh: null, p_published_at: null, p_note: null, p_reach: { state: 'down', status: '503' } })
      expect(error?.code).toBe('23514')
      await failRun(svc, next.runId, 'reach test')
    })

    it('the size guard: results over 256 KB (BYTES, multi-byte text) are refused, and the run can still be failed', async () => {
      const D = await fresh('seo-runs size')
      const claim = await claimRun(svc, D.id, 'scheduled', { userId: null })
      expect(claim.ok).toBe(true)
      if (!claim.ok) return
      // Straight through the function: store.ts caps what it writes, so it could never trip this.
      // 24 × 4,000 CJK characters is 96,000 characters but ~288 KB.
      const huge = SEO_TEST_IDS.map((id) => ({ id, status: 'pass', value: 'v', sentence: '音'.repeat(4_000), evidence: [] }))
      const { error } = await svc.rpc('seo_test_finish', { p_run_id: claim.runId, p_status: 'done', p_results: huge, p_site_url: null, p_site_fresh: null, p_published_at: null, p_note: null })
      expect(error?.code).toBe('23514')
      expect((await rowsOf(D.id))[0].status).toBe('running')
      await failRun(svc, claim.runId, 'size test')
      expect((await rowsOf(D.id))[0].status).toBe('failed')
    })

    it('CRITICAL: retention keeps the newest 30 runs per artist', async () => {
      const E = await fresh('seo-runs retention')
      const ids: string[] = []
      for (let i = 0; i < 32; i++) {
        const claim = await claimRun(svc, E.id, 'scheduled', { userId: null })
        if (!claim.ok) throw new Error(`claim ${i}: ${claim.error}`)
        ids.push(claim.runId)
        await failRun(svc, claim.runId, 'retention test')
      }
      const kept = (await rowsOf(E.id)).map((r) => r.id)
      expect(kept).toHaveLength(30)
      expect(kept).not.toContain(ids[0])
      expect(kept).not.toContain(ids[1])
      expect(kept).toContain(ids[31])
    }, 120_000)
  })
})
