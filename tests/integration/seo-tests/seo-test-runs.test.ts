/**
 * In the real database, a manager's session can READ its artist's test runs and nothing else;
 * the two service-role functions are the only way to write one, and they enforce cool-downs,
 * coalescing, per-person limits, the size cap, retention and immutability.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ NOT RUN until the migration is pushed. Flip MIGRATION_PUSHED to true in the SAME change  │
 * │ as `npm run db:push`, then run this file (and `npm run audit:grants`).                   │
 * │ The crawl block has its own gate: CRAWL_MIGRATION_PUSHED, for 20261001120000.            │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Code:     supabase/migrations/20260929140000_seo_test_runs.sql (the seo_test_runs table, its
 *           RLS and grants, seo_test_claim, seo_test_finish) and 20261001120000_seo_test_crawl.sql
 *           (the `crawl` column, its check, seo_test_finish + p_crawl), through
 *           src/lib/seo-tests/store.ts
 * Feature:  Test runs · storage (who may read and write a run), all 24 SEO tests
 * Tier:     STRICT (AGENTS.md "Test depth"): RLS, grants and stored data. Every denial has a
 *           planted witness (rule 2), every refused write is checked by row STATE through the
 *           service client (rule 3), and every row lives on a throwaway artist (rule 6): never
 *           Skeen, never the seed artists' data.
 * Covers:   • a manager reads its own runs (with passed / total / summary worked out by the database)
 *           • a manager cannot forge, rewrite or delete a run, nor call either write function;
 *             another manager and anon read nothing
 *           • even the service role cannot write the table directly, only through the functions
 *           • a person who doesn't manage the artist is denied, even through the service role
 *           • cool-down (60 s), one run per publish (coalesced), one run at a time (the race of
 *             three clicks makes one), at most 2 runs at once per person
 *           • a finished run is immutable; `reach` is stored as given and junk is refused; results
 *             over 256 KB (bytes) are refused and the run can still be failed; the newest 30 are kept
 *           • the crawl (what a run saw): stored with a done run and read back by its manager; a
 *             failed run keeps none; it never changes after the finish; only the service role may
 *             call the new seo_test_finish; over 64 KB (bytes) or not an object, the table refuses
 *           The 2026-09-29 security review's attacks are cases here (a forged run, skipping the
 *           cool-down by claiming as "publish", wiping the history by delete or by 35 claims).
 * Not here: the 5-minute "abandoned run" sweep and the hourly per-person ceiling (30): ran_at is
 *           stamped by the database so a client can't backdate a row, and 30 real runs are too
 *           slow for this suite; both were checked on a throwaway local Postgres. Likewise "a new
 *           run never starts with a crawl" and "a running run cannot gain one": no API role can
 *           insert or update the table, so only the owner could try (checked locally, 2026-09-30).
 *           The TypeScript side of each rule: tests/unit/seo-tests/runs/storage.test.ts.
 * Fixtures: the HOSTED project (no fake): the seeded managers A and B signed in, the service
 *           client, and throwaway artists made and deleted by this file; one finished run on
 *           artist A is the witness every denial is measured against.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimRun, failRun, finishRun, latestRun } from '@/lib/seo-tests/store'
import { FETCHING_BOTS, SEO_BOTS } from '@/lib/seo-tests/bots'
import { SEO_TEST_IDS, type SeoCrawl, type SeoTestResult } from '@/lib/seo-tests/types'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectExecuteDenied, expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const MIGRATION_PUSHED = true
/** 20261001120000_seo_test_crawl.sql. Flip in the same change as its push, then run this file. */
const CRAWL_MIGRATION_PUSHED = true

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
    // Reading: the manager sees its runs, and the database (not the client) worked out the score.
    it('CRITICAL: reads its own artist\'s runs; the database derived passed/total/summary from the results', async () => {
      const { data, error } = await mA.from('seo_test_runs').select('status, passed, total, summary, started_by').eq('artist_id', A.id)
      expect(error).toBeNull()
      expect(data).toEqual([expect.objectContaining({ status: 'done', passed: SEO_TEST_IDS.length - 2, total: SEO_TEST_IDS.length, started_by: uA })])
      expect(Object.keys((data![0] as { summary: object }).summary).sort()).toEqual([...SEO_TEST_IDS].sort())
    })

    // No forging: a manager can't insert a finished run or a "publish" claim that skips the cool-down.
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

    // No rewriting: update and delete are refused and the row is unchanged.
    it('CRITICAL: cannot rewrite a run or wipe the history (update, delete)', async () => {
      const [before] = await rowsOf(A.id)
      const up = await mA.from('seo_test_runs').update({ passed: 24, note: 'forged' }).eq('artist_id', A.id)
      expectRlsDenied(up.error, 'a manager\'s update')
      const del = await mA.from('seo_test_runs').delete().eq('artist_id', A.id)
      expectRlsDenied(del.error, 'a manager\'s delete')
      const [after] = await rowsOf(A.id)
      expect(after).toEqual(before)
    })

    // No write functions: a manager can call neither, so no forged results and no prune by 35 claims.
    it('CRITICAL: cannot call either write function (so no forged results, no cool-down games, no prune by 35 claims)', async () => {
      const [before] = await rowsOf(A.id)
      const claim = await mA.rpc('seo_test_claim', { p_artist_id: A.id, p_trigger: 'publish', p_user_id: uA, p_published_at: null })
      expectExecuteDenied(claim.error, 'seo_test_claim')
      const finish = await mA.rpc('seo_test_finish', { p_run_id: before.id, p_status: 'done', p_results: results(0), p_site_url: null, p_site_fresh: true, p_published_at: null, p_note: null })
      expectExecuteDenied(finish.error, 'seo_test_finish')
      expect((await rowsOf(A.id))[0]).toEqual(before)
    })

    // Isolation: another manager reads none of this artist's runs (the witness proves there are some).
    it('manager B reads none of A\'s runs', async () => {
      expect((await rowsOf(A.id)).length).toBeGreaterThan(0)
      const { data } = await mB.from('seo_test_runs').select('id').eq('artist_id', A.id)
      expect(data).toEqual([])
    })

    // Anon: no reads and no claims for someone who isn't signed in.
    it('CRITICAL: anon can read none and call neither function', async () => {
      expect((await rowsOf(A.id)).length).toBeGreaterThan(0)
      const anon = anonClient()
      expectRlsDenied((await anon.from('seo_test_runs').select('id').eq('artist_id', A.id)).error, 'anon read')
      expectExecuteDenied((await anon.rpc('seo_test_claim', { p_artist_id: A.id, p_trigger: 'manual', p_user_id: uA, p_published_at: null })).error, 'seo_test_claim')
    })
  })

  describe('the service role writes only through the functions, which enforce the rules', () => {
    // Only through the functions: even the service role can't insert or delete rows directly.
    it('CRITICAL: even the service role cannot write the table directly', async () => {
      const before = (await rowsOf(A.id)).length
      expectRlsDenied((await svc.from('seo_test_runs').insert({ artist_id: A.id, trigger: 'scheduled' })).error, 'service insert')
      expectRlsDenied((await svc.from('seo_test_runs').delete().eq('artist_id', A.id)).error, 'service delete')
      expect((await rowsOf(A.id)).length).toBe(before)
    })

    // The person is checked: a claim in the name of someone who doesn't manage the artist is denied.
    it('CRITICAL: a person who does not manage the artist is denied, even through the service role', async () => {
      expect(await claimRun(svc, A.id, 'manual', { userId: uB })).toMatchObject({ ok: false, reason: 'denied' })
    })

    // Cool-down: a manual run within 60 s of the last is refused, with the seconds left.
    it('CRITICAL: a manual run inside 60 s of the last one (its start or its finish) is refused, with the seconds left', async () => {
      const out = await claimRun(svc, A.id, 'manual', { userId: uA })
      expect(out).toMatchObject({ ok: false, reason: 'cooldown' })
      if (!out.ok) expect(out.retryInS).toBeGreaterThan(0)
    })

    // Publish runs: one per publish and one per 60 s, never a way around the cool-down.
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

    // One at a time: three clicks at once make exactly one run; the others are "busy".
    it('CRITICAL: while a run is running, no other run starts; the race of three clicks makes exactly ONE', async () => {
      const C = await fresh('seo-runs race')
      const outs = await Promise.all([1, 2, 3].map(() => claimRun(svc, C.id, 'manual', { userId: uA })))
      expect(outs.filter((o) => o.ok)).toHaveLength(1)
      expect(outs.filter((o) => !o.ok).every((o) => !o.ok && o.reason === 'busy')).toBe(true)
      expect(await rowsOf(C.id)).toHaveLength(1)
      const running = outs.find((o) => o.ok)
      if (running?.ok) await failRun(svc, running.runId, 'race test')
    })

    // Per person: at most 2 runs at once across all their artists.
    it('CRITICAL: one person, many artists: at most 2 runs at once', async () => {
      const [x, y, z] = [await fresh('seo-runs person x'), await fresh('seo-runs person y'), await fresh('seo-runs person z')]
      const a = await claimRun(svc, x.id, 'manual', { userId: uA })
      const b = await claimRun(svc, y.id, 'manual', { userId: uA })
      expect(a.ok && b.ok).toBe(true)
      expect(await claimRun(svc, z.id, 'manual', { userId: uA })).toMatchObject({ ok: false, reason: 'limit' })
      for (const o of [a, b]) if (o.ok) await failRun(svc, o.runId, 'limit test')
    })

    // Immutable: finishing a finished run again changes nothing.
    it('CRITICAL: a finished run is immutable: finishing it again changes nothing', async () => {
      const [before] = await rowsOf(A.id)
      expect(await finishRun(svc, before.id as string, { results: results(24), siteUrl: null, siteFresh: false, publishedAt: null })).toMatchObject({ ok: false })
      expect((await rowsOf(A.id))[0]).toEqual(before)
    })

    // Reach: stored as given; a malformed one is refused by the table's own check.
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

    // The size guard: results over 256 KB (bytes) are refused, and the run can still be marked failed.
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

    // Retention: the newest 30 runs per artist are kept, the oldest pruned.
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

/** A small crawl as a run makes one (types.ts SeoCrawl), every crawler from the registry (bots.ts). */
const crawl = (): SeoCrawl => ({
  v: 1,
  robots: {
    url: 'https://www.example-artist.com/robots.txt',
    status: 200,
    text: 'User-agent: *\nAllow: /',
    truncated: false,
    bots: SEO_BOTS.map((b) => ({ key: b.key, who: b.who, token: b.robotsToken, visits: b.fetches, verdict: 'allowed' as const, why: 'rules' as const, group: 'User-agent: *', rule: 'Allow: /' })),
  },
  sitemap: { url: 'https://www.example-artist.com/sitemap.xml', status: 200, namedInRobots: true, total: 1, pages: [{ path: '/', lastmod: '2026-09-28', status: 200 }], sameDates: true },
  pages: [{
    path: '/',
    status: 200,
    canonical: { person: 'https://www.example-artist.com/', google: 'https://www.example-artist.com/', bing: null },
    noindex: { meta: false, header: false },
    visits: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, 200])),
  }],
  otherHost: null,
  listing: { google: null, bing: [{ path: '/', answered: true, lastCrawled: '2026-09-26T08:00:00Z', status: 200 }] },
})

describe.skipIf(!CRAWL_MIGRATION_PUSHED)('seo_test_runs.crawl: what a run saw (20261001120000)', () => {
  let svc: SupabaseClient
  let mA: SupabaseClient
  const made: ThrowawayArtist[] = []

  const rowOf = async (runId: string) => {
    const { data, error } = await svc.from('seo_test_runs').select('*').eq('id', runId).single()
    if (error) throw new Error(error.message)
    return data as Record<string, unknown>
  }
  /** A running run on a fresh throwaway artist (scheduled: no cool-down, no per-person limit). */
  const running = async (label: string) => {
    const artist = await createThrowawayArtist(svc, label, mA)
    made.push(artist)
    const claim = await claimRun(svc, artist.id, 'scheduled', { userId: null })
    if (!claim.ok) throw new Error(`${label} claim: ${claim.error}`)
    return { artist, runId: claim.runId }
  }
  /** Every argument of the NEW seo_test_finish, p_crawl included (so only it can answer). */
  const finishArgs = (runId: string, over: Record<string, unknown> = {}) => ({
    p_run_id: runId, p_status: 'done', p_results: results(0), p_site_url: null, p_site_fresh: null, p_published_at: null, p_note: null, p_reach: null, p_crawl: crawl(), ...over,
  })

  beforeAll(async () => {
    svc = serviceClient()
    mA = await signInAs(SEED.managerA)
  })

  afterAll(async () => {
    for (const a of made) await deleteThrowawayArtist(svc, a)
  })

  // Stored and shown: finishRun stores the crawl with the run, and the manager's own session
  // (RLS) reads it back whole. The ROW is checked too: finishRun retries without the crawl when
  // the call with it fails, so `ok: true` alone would not prove the crawl was stored.
  it('CRITICAL: a run finished with a crawl reads back with it, in the manager\'s own session', async () => {
    const { artist, runId } = await running('seo-crawl read')
    expect(await finishRun(svc, runId, { results: results(0), siteUrl: null, siteFresh: null, publishedAt: null, crawl: crawl() })).toEqual({ ok: true })
    expect((await rowOf(runId)).crawl).toEqual(crawl())
    const run = await latestRun(mA, artist.id)
    expect(run?.id).toBe(runId)
    expect(run?.crawl).toEqual(crawl())
  })

  // A failed run keeps none: the finish is handed a crawl the table would take (no error: the
  // call reached the row), and the row still has no crawl.
  it('CRITICAL: a FAILED run keeps no crawl, even when the finish hands it one', async () => {
    const { runId } = await running('seo-crawl failed')
    const { data, error } = await svc.rpc('seo_test_finish', finishArgs(runId, { p_status: 'failed', p_results: null, p_note: 'failed on purpose' }))
    expect(error).toBeNull()
    expect(data).toBe(true)
    const row = await rowOf(runId)
    expect(row.status).toBe('failed')
    expect(row.crawl).toBeNull()
  })

  // Immutable: once finished, the crawl is fixed. Finishing again answers false, and neither a
  // manager nor the service role can write the column directly (42501); the row is unchanged.
  it('CRITICAL: a finished run\'s crawl can never change (finish again, a manager\'s update, the service role\'s update)', async () => {
    const { runId } = await running('seo-crawl immutable')
    await finishRun(svc, runId, { results: results(0), siteUrl: null, siteFresh: null, publishedAt: null, crawl: crawl() })
    const before = await rowOf(runId)
    expect(before.crawl).toEqual(crawl())
    const forged = { ...crawl(), otherHost: { url: 'https://forged.example/', status: 200, to: null } }
    const again = await svc.rpc('seo_test_finish', finishArgs(runId, { p_crawl: forged }))
    expect(again.error).toBeNull()
    expect(again.data).toBe(false)
    expectRlsDenied((await mA.from('seo_test_runs').update({ crawl: forged }).eq('id', runId)).error, 'a manager\'s update')
    expectRlsDenied((await svc.from('seo_test_runs').update({ crawl: null }).eq('id', runId)).error, 'the service role\'s update')
    expect(await rowOf(runId)).toEqual(before)
  })

  // The door: the new seo_test_finish (with p_crawl) is service-role only. The call names
  // p_crawl, so before the push it would be PGRST202 and fail here, never pass as "denied".
  it('CRITICAL: anon and a manager\'s session cannot execute the new seo_test_finish', async () => {
    const { runId } = await running('seo-crawl grants')
    const before = await rowOf(runId)
    expect(before.status).toBe('running')
    for (const client of [anonClient(), mA]) {
      expectExecuteDenied((await client.rpc('seo_test_finish', finishArgs(runId))).error, 'seo_test_finish')
    }
    expect(await rowOf(runId)).toEqual(before)
    await failRun(svc, runId, 'grants test')
  })

  // The table's own check: over 64 KB counted in BYTES, or not an object, is refused (23514)
  // and the run is still running. Straight through the function: capCrawl would have cut it.
  // Then finishRun with the same crawl stores the run, its robots text cut (capCrawl, step 1).
  it('the table refuses a crawl over 64 KB (bytes) or one that is not an object; finishRun cuts it and stores the run', async () => {
    const { runId } = await running('seo-crawl size')
    const big = crawl()
    big.robots.text = '音'.repeat(22_000) // 22,000 characters, 66,000 bytes
    expect((await svc.rpc('seo_test_finish', finishArgs(runId, { p_crawl: big }))).error?.code).toBe('23514')
    expect((await svc.rpc('seo_test_finish', finishArgs(runId, { p_crawl: [crawl()] }))).error?.code).toBe('23514')
    expect((await rowOf(runId)).status).toBe('running')
    expect(await finishRun(svc, runId, { results: results(0), siteUrl: null, siteFresh: null, publishedAt: null, crawl: big })).toEqual({ ok: true })
    const row = await rowOf(runId)
    expect(row.status).toBe('done')
    expect(row.crawl).toEqual({ ...crawl(), robots: { ...crawl().robots, text: null, truncated: true } })
  })
})
