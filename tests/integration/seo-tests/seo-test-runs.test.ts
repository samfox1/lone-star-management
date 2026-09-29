// The kept SEO / GEO runs in the real database: only the artist's managers read or write them, one run at a time, a cool-down, retention, immutability.
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
 * Not pinned here, said plainly: the 5-minute "abandoned run" sweep. ran_at is stamped by the
 * claim trigger and pinned by the finish trigger, so no client (the service role included) can
 * backdate a row to make one; it would take raw SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimRun, finishRun, seoScore } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, type SeoTestResult, type SeoTestStatus } from '@/lib/seo-tests/types'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const MIGRATION_PUSHED = false

const results = (fails: number): SeoTestResult[] =>
  SEO_TEST_IDS.map((id, i) => ({ id, status: i < fails ? 'fail' : 'pass', value: 'v', sentence: 's.', evidence: [{ label: 'seen', value: id }] }))

describe.skipIf(!MIGRATION_PUSHED)('seo_test_runs', () => {
  let svc: SupabaseClient
  let mA: SupabaseClient
  let mB: SupabaseClient
  const made: ThrowawayArtist[] = []
  let A: ThrowawayArtist
  let B: ThrowawayArtist

  const rowsOf = async (artistId: string) => {
    const { data, error } = await svc.from('seo_test_runs').select('*').eq('artist_id', artistId).order('ran_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Record<string, unknown>[]
  }

  beforeAll(async () => {
    svc = serviceClient()
    mA = await signInAs(SEED.managerA)
    mB = await signInAs(SEED.managerB)
    A = await createThrowawayArtist(svc, 'seo-runs A', mA)
    B = await createThrowawayArtist(svc, 'seo-runs B', mB)
    made.push(A, B)
  })

  afterAll(async () => {
    for (const a of made) await deleteThrowawayArtist(svc, a)
  })

  it('CRITICAL: a manager claims and finishes a run; the database derives passed, total and summary', async () => {
    const claim = await claimRun(mA, A.id, 'manual')
    expect(claim.ok).toBe(true)
    if (!claim.ok) return
    expect(await finishRun(mA, claim.runId, { results: results(2), siteUrl: 'https://www.example-artist.com', siteFresh: true, publishedAt: null })).toEqual({ ok: true })
    const [row] = await rowsOf(A.id)
    expect(row).toMatchObject({ id: claim.runId, status: 'done', trigger: 'manual', passed: SEO_TEST_IDS.length - 2, total: SEO_TEST_IDS.length, site_fresh: true })
    expect(Object.keys(row.summary as object).sort()).toEqual([...SEO_TEST_IDS].sort())
    expect(row.finished_at).not.toBeNull()
  })

  it('CRITICAL: `na` (does not apply) is left out of the score on both sides, and the TS mirror agrees', async () => {
    const F = await createThrowawayArtist(svc, 'seo-runs na', mA)
    made.push(F)
    // 19 pass, 3 fail, 1 unknown, 1 na: "19 of 23", not "19 of 24".
    const mixed: SeoTestResult[] = SEO_TEST_IDS.map((id, i) => ({
      id, status: (i < 19 ? 'pass' : i < 22 ? 'fail' : i === 22 ? 'unknown' : 'na') as SeoTestStatus, value: 'v', sentence: 's.', evidence: [],
    }))
    const claim = await claimRun(svc, F.id, 'publish')
    if (!claim.ok) throw new Error(claim.error)
    expect(await finishRun(svc, claim.runId, { results: mixed, siteUrl: null, siteFresh: null, publishedAt: null })).toEqual({ ok: true })
    const [row] = await rowsOf(F.id)
    expect(row).toMatchObject({ status: 'done', passed: 19, total: 23 })
    expect({ passed: row.passed, total: row.total }).toEqual(seoScore(mixed))
    expect((row.summary as Record<string, string>)[SEO_TEST_IDS[23]]).toBe('na')
  })

  it('CRITICAL: a run where every test is `na` is a done run of 0 of 0; an unknown status is refused', async () => {
    const G = await createThrowawayArtist(svc, 'seo-runs all na', mA)
    made.push(G)
    const claim = await claimRun(svc, G.id, 'publish')
    if (!claim.ok) throw new Error(claim.error)
    const bad = SEO_TEST_IDS.map((id) => ({ id, status: 'great', value: 'v', sentence: 's.', evidence: [] }))
    const refused = await svc.from('seo_test_runs').update({ status: 'done', results: bad }).eq('id', claim.runId)
    expect(refused.error?.message).toMatch(/seo_test_bad_status/)
    expect((await rowsOf(G.id))[0].status).toBe('running')
    const allNa: SeoTestResult[] = SEO_TEST_IDS.map((id) => ({ id, status: 'na', value: 'v', sentence: 's.', evidence: [] }))
    expect(await finishRun(svc, claim.runId, { results: allNa, siteUrl: null, siteFresh: null, publishedAt: null })).toEqual({ ok: true })
    expect((await rowsOf(G.id))[0]).toMatchObject({ status: 'done', passed: 0, total: 0 })
  })

  it('CRITICAL: a finished run cannot change, not by its manager (RLS) and not by the service role (trigger)', async () => {
    const [before] = await rowsOf(A.id)
    // The manager's UPDATE matches no row (the policy admits running rows only): no error, no change.
    await mA.from('seo_test_runs').update({ results: results(24), status: 'done' }).eq('id', before.id as string)
    const [after] = await rowsOf(A.id)
    expect(after.passed).toBe(before.passed)
    const { error } = await svc.from('seo_test_runs').update({ note: 'rewritten' }).eq('id', before.id as string)
    expect(error?.message).toMatch(/seo_test_finished/)
  })

  it('CRITICAL: manager B can neither read A\'s runs nor start one for A', async () => {
    const witness = await rowsOf(A.id)
    expect(witness.length).toBeGreaterThan(0) // planted by the first test: the denial below is not vacuous
    const { data } = await mB.from('seo_test_runs').select('id').eq('artist_id', A.id)
    expect(data).toEqual([])
    const { error } = await mB.from('seo_test_runs').insert({ artist_id: A.id, trigger: 'publish' })
    expectRlsDenied(error, 'a stranger\'s claim')
    expect(error?.message ?? '').not.toMatch(/seo_test_(busy|cooldown)/) // it learned nothing about A
    expect((await rowsOf(A.id)).length).toBe(witness.length)
  })

  it('CRITICAL: anon can read none and claim none', async () => {
    expect((await rowsOf(A.id)).length).toBeGreaterThan(0)
    const anon = anonClient()
    const read = await anon.from('seo_test_runs').select('id').eq('artist_id', A.id)
    expectRlsDenied(read.error, 'anon read')
    const write = await anon.from('seo_test_runs').insert({ artist_id: A.id, trigger: 'manual' })
    expectRlsDenied(write.error, 'anon claim')
  })

  it('CRITICAL: a manual run inside 60 s of the last one is refused, with the seconds left', async () => {
    const out = await claimRun(mA, A.id, 'manual')
    expect(out).toMatchObject({ ok: false, reason: 'cooldown' })
    if (!out.ok) expect(out.retryInS).toBeGreaterThan(0)
  })

  it('CRITICAL: while a run is running, no other run starts (a publish run included)', async () => {
    const first = await claimRun(mA, A.id, 'publish')
    expect(first.ok).toBe(true)
    expect(await claimRun(mA, A.id, 'publish')).toMatchObject({ ok: false, reason: 'busy' })
    if (first.ok) await finishRun(mA, first.runId, { results: results(0), siteUrl: null, siteFresh: null, publishedAt: null })
  })

  it('CRITICAL: the race: two "Test again" clicks at once make exactly ONE run', async () => {
    const C = await createThrowawayArtist(svc, 'seo-runs race', mA)
    made.push(C)
    const outs = await Promise.all([claimRun(mA, C.id, 'manual'), claimRun(mA, C.id, 'manual'), claimRun(mA, C.id, 'manual')])
    expect(outs.filter((o) => o.ok)).toHaveLength(1)
    expect(outs.filter((o) => !o.ok).every((o) => !o.ok && (o.reason === 'busy' || o.reason === 'cooldown'))).toBe(true)
    expect(await rowsOf(C.id)).toHaveLength(1)
  })

  it('the size guard: results over 256 KB are refused, and the run stays running', async () => {
    const D = await createThrowawayArtist(svc, 'seo-runs size', mA)
    made.push(D)
    const claim = await claimRun(svc, D.id, 'publish')
    expect(claim.ok).toBe(true)
    if (!claim.ok) return
    // Straight through the service client: store.ts caps what it writes, so it could never trip this.
    const huge = SEO_TEST_IDS.map((id) => ({ id, status: 'pass', value: 'v', sentence: 'x'.repeat(20_000), evidence: [] }))
    const { error } = await svc.from('seo_test_runs').update({ status: 'done', results: huge }).eq('id', claim.runId)
    expect(error?.code).toBe('23514')
    const [row] = await rowsOf(D.id)
    expect(row.status).toBe('running')
  })

  it('CRITICAL: retention keeps the newest 30 runs per artist', async () => {
    const E = await createThrowawayArtist(svc, 'seo-runs retention', mA)
    made.push(E)
    const ids: string[] = []
    for (let i = 0; i < 32; i++) {
      const claim = await claimRun(svc, E.id, 'publish')
      if (!claim.ok) throw new Error(`claim ${i}: ${claim.error}`)
      ids.push(claim.runId)
      const { error } = await svc.from('seo_test_runs').update({ status: 'failed', note: 'retention test' }).eq('id', claim.runId)
      if (error) throw new Error(error.message)
    }
    const kept = (await rowsOf(E.id)).map((r) => r.id)
    expect(kept).toHaveLength(30)
    expect(kept).not.toContain(ids[0])
    expect(kept).not.toContain(ids[1])
    expect(kept).toContain(ids[31])
  }, 120_000)
})
