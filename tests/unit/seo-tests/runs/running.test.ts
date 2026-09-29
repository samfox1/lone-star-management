/**
 * Running the SEO / GEO tests: all 24 run in order, one broken test never sinks the run, the run
 * keeps to its time budget, and the database decides whether a run may start at all.
 *
 * Code:     src/lib/seo-tests/run.ts (runSeoTests, runAllTests)
 * Feature:  Test runs · all 24 SEO tests (SEO_TEST_IDS), every Test-tab group
 * Tier:     STRICT (AGENTS.md "Test depth"): this decides what is STORED as the verdict on the
 *           artist's site, so what the manager is later told is true.
 * Covers:   • results come out in SEO_TEST_IDS order, one per test, whatever order the engine uses
 *           • a test that throws, answers junk or answers for another test is `unknown`; the rest stand
 *           • a missing test is `unknown`, never left out (a run always stores 24)
 *           • the time budget: a site that never answers ends the run in time, every test `unknown`
 *           • a slow share picture or a MusicBrainz outage makes ONLY its own test unknown
 *           • the database's refusal (cool-down, busy) stops the run before anything is fetched
 *           • every write goes through the service-role writer; the manager's session only reads
 *           • no site connected: 24 × unknown "no site", stored, nothing fetched
 *           • the stale-site verdict and the run-level `reach` are worked out and stored
 *           • a failure after the claim marks the run failed and returns a plain error
 *           • `na` (does not apply) is a verdict the run keeps
 * Not here: what each test decides (tests/unit/seo-tests/<test>.test.ts); how a run is stored and
 *           read back (runs/storage.test.ts); the wait after a publish (runs/after-publish.test.ts);
 *           the database rules themselves (tests/integration/seo-tests/seo-test-runs.test.ts).
 * Fixtures: a PostgREST fake (brand/_fake-client) answers the claim, finish and publish_moments
 *           calls; a fake engine whose 24 tests all pass unless a test swaps one out; what Tapir
 *           knows is handed in (`readKnown`), never read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAllTests, runSeoTests, type RunWho, type SeoEngine, type SitePages } from '@/lib/seo-tests/run'
import { SEO_TEST_IDS, type SeoEvidence, type SeoKnown, type SeoTest, type SeoTestId, type SeoTestResult } from '@/lib/seo-tests/types'
import { fakeClient, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const A = 'artist-1'
const ORIGIN = 'https://www.example-artist.com'
const PUBLISHED_AT = '2026-09-28T21:14:03.123456+00:00'

const known = (over: Partial<SeoKnown> = {}): SeoKnown => ({
  artistName: 'Example',
  siteUrl: ORIGIN,
  today: '2026-09-28',
  published: {
    bio: 'A bio.', genre: 'house', location: 'Chicago, IL', seoTitle: 'Example', seoDescription: 'Desc', ogImage: null,
    links: [], tourDates: [], releases: [], photos: [], publishedAt: PUBLISHED_AT,
    region: null, country: null, countryCode: null, artistType: 'MusicGroup', spotifyArtistId: null,
  },
  ...over,
})

const pages = (over: Partial<SitePages> = {}): SitePages => ({
  origin: ORIGIN,
  gatheredAt: '2026-09-28T21:20:00Z',
  paths: ['/'],
  plain: [{ path: '/', finalUrl: `${ORIGIN}/`, status: 200, headers: {}, html: '<html></html>' }],
  byBot: {},
  robots: { status: 200, body: '' },
  sitemap: { status: 200, urls: [`${ORIGIN}/`], lastmods: ['2026-09-28T21:14:03.123Z'] },
  ...over,
})

const pass = (id: SeoTestId): SeoTestResult => ({ id, status: 'pass', value: 'ok', sentence: 'fine.', evidence: [{ label: 'seen', value: id }] })
const allPass = (): Partial<Record<SeoTestId, SeoTest>> => Object.fromEntries(SEO_TEST_IDS.map((id) => [id, () => pass(id)]))

function engine(over: Partial<SeoEngine> = {}): SeoEngine & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    gatherSiteEvidence: async (origin) => (calls.push(`pages:${origin}`), pages()),
    fetchShareImage: async () => (calls.push('share'), { url: `${ORIGIN}/og.png`, status: 200, contentType: 'image/png', width: 1200, height: 630, bytes: 1000 }),
    lookupMusicBrainz: async () => (calls.push('mb'), { looked: true, artistUrl: 'https://musicbrainz.org/artist/x', matchedOn: ORIGIN }),
    tests: allPass(),
    appleStorefrontFix: () => null,
    ...over,
  }
}

type World = { claim?: { outcome: string; retry_in_s?: number | null }; finishRow?: boolean; finishError?: boolean; moments?: string[] }

/** ONE fake for the reader (the manager's session) and the writer (service role); `writerOf`
 *  below splits them when a test needs to see which client did what. */
function world({ claim = { outcome: 'claimed' }, finishRow = true, finishError = false, moments = [PUBLISHED_AT] }: World = {}) {
  return fakeClient((c: Call): Reply => {
    if (c.op === 'rpc' && c.table === 'seo_test_claim') return { data: [{ run_id: claim.outcome === 'claimed' ? 'run-1' : null, ran_at: '2026-09-28T21:20:00Z', retry_in_s: null, ...claim }] }
    if (c.op === 'rpc' && c.table === 'seo_test_finish') return finishError ? { error: { code: '23514', message: 'seo_test_runs_results_size' } } : { data: finishRow }
    if (c.op === 'rpc' && c.table === 'publish_moments') return { data: moments.map((m) => ({ published_at: m, entities: 1 })) }
    return { data: null }
  })
}

const WHO = (f: ReturnType<typeof world>, over: Partial<RunWho> = {}): RunWho => ({ writer: f.client, userId: 'user-1', ...over })
const finishArgs = (f: ReturnType<typeof world>, status: 'done' | 'failed') =>
  f.calls.find((c) => c.op === 'rpc' && c.table === 'seo_test_finish' && (c.args as { p_status?: string }).p_status === status)
const finishCall = (f: ReturnType<typeof world>) => finishArgs(f, 'done')
type Stored = { results: SeoTestResult[]; site_fresh: boolean | null; site_url: string | null; note: string | null; published_at: string | null; reach: unknown }
const stored = (f: ReturnType<typeof world>): Stored => {
  const a = finishCall(f)?.args as { p_results: SeoTestResult[]; p_site_fresh: boolean | null; p_site_url: string | null; p_note: string | null; p_published_at: string | null; p_reach: unknown }
  return { results: a.p_results, site_fresh: a.p_site_fresh, site_url: a.p_site_url, note: a.p_note, published_at: a.p_published_at, reach: a.p_reach }
}

afterEach(() => vi.useRealTimers())

describe('order and completeness', () => {
  // Order: the page and the history dots read results by position, so a shuffled engine must not shuffle them.
  it('CRITICAL: results come out in SEO_TEST_IDS order, one per id, whatever order the engine lists them', async () => {
    const reversed = Object.fromEntries([...SEO_TEST_IDS].reverse().map((id) => [id, () => pass(id)]))
    const f = world()
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine({ tests: reversed }), readKnown: async () => known() })
    expect(out.ok).toBe(true)
    expect(stored(f).results.map((r) => r.id)).toEqual([...SEO_TEST_IDS])
  })

  // A missing test: a run must always hold 24 results, or the page would count a gap as nothing.
  it('a test the engine does not have yet is `unknown`, never left out', () => {
    const tests = allPass()
    delete tests.card
    const results = runAllTests(tests, { known: known() } as SeoEvidence)
    expect(results).toHaveLength(SEO_TEST_IDS.length)
    expect(results.find((r) => r.id === 'card')?.status).toBe('unknown')
  })
})

describe('one broken test never sinks the run', () => {
  // A crashing test: one bug in one test must not throw away the other 23 verdicts.
  it('CRITICAL: a test that THROWS is `unknown` ("this test broke") and the other 23 keep their results', async () => {
    const tests = allPass()
    tests.title = () => {
      throw new Error('boom')
    }
    const f = world()
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine({ tests }), readKnown: async () => known() })
    expect(out.ok).toBe(true)
    const results = stored(f).results
    const title = results.find((r) => r.id === 'title')!
    expect(title.status).toBe('unknown')
    expect(title.sentence).toMatch(/broke/)
    expect(results.filter((r) => r.id !== 'title').every((r) => r.status === 'pass')).toBe(true)
  })

  // Junk answers: a malformed, async or mislabelled answer is "couldn't check", never stored as a verdict.
  it('a test that answers junk, an async answer, or another test\'s id is `unknown` too', () => {
    const tests = allPass()
    tests.bio = (() => ({ id: 'bio', status: 'great' })) as unknown as SeoTest
    tests.genre = (async () => pass('genre')) as unknown as SeoTest
    tests.place = () => pass('genre') // wrong id: a copy-paste bug, not a verdict about `place`
    const results = runAllTests(tests, { known: known() } as SeoEvidence)
    for (const id of ['bio', 'genre', 'place'] as SeoTestId[]) expect(results.find((r) => r.id === id)?.status, id).toBe('unknown')
    expect(results.find((r) => r.id === 'title')?.status).toBe('pass')
  })
})

describe('the time budget', () => {
  // The budget: a hung site must not hold the run (and the manager's "Testing…") open forever.
  it('CRITICAL: a site that never answers ends the run inside the budget, every test `unknown`', async () => {
    const f = world()
    const hang = engine({ gatherSiteEvidence: () => new Promise<SitePages>(() => {}) })
    const t0 = Date.now()
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: hang, readKnown: async () => known(), budgetMs: 40 })
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(out.ok).toBe(true)
    const results = stored(f).results
    expect(results).toHaveLength(SEO_TEST_IDS.length)
    expect(results.every((r) => r.status === 'unknown' && /ran out of time/.test(r.sentence))).toBe(true)
    expect(stored(f).note).toMatch(/too long/)
  })

  // A slow share picture: only the share test is unknown, and "no answer" is never read as "no picture named".
  it('a slow share picture makes ONLY the `share` test unknown; a null picture is never read as "none named"', async () => {
    const tests = allPass()
    // A test that would FAIL on a null picture ("your page names no share picture").
    tests.share = (e) => (e.shareImage ? pass('share') : { id: 'share', status: 'fail', value: 'None', sentence: 'no picture.', evidence: [] })
    const f = world()
    const slow = engine({ tests, fetchShareImage: () => new Promise(() => {}) })
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: slow, readKnown: async () => known(), budgetMs: 40 })
    expect(out.ok).toBe(true)
    const results = stored(f).results
    expect(results.find((r) => r.id === 'share')?.status).toBe('unknown')
    expect(results.filter((r) => r.id !== 'share').every((r) => r.status === 'pass')).toBe(true)
  })

  // A MusicBrainz outage: only the MusicBrainz test is unknown; the evidence says it didn't look.
  it('MusicBrainz throwing leaves `looked: false` evidence and ONLY `mb` unknown', async () => {
    let seen: SeoEvidence['musicbrainz'] | null = null
    const tests = allPass()
    tests.mb = (e) => ((seen = e.musicbrainz), pass('mb'))
    const f = world()
    await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine({ tests, lookupMusicBrainz: async () => { throw new Error('503') } }), readKnown: async () => known() })
    expect(seen).toMatchObject({ looked: false })
    expect(stored(f).results.find((r) => r.id === 'mb')?.status).toBe('unknown')
  })
})

describe('the database decides whether a run may start', () => {
  // A refusal (cool-down, or a run already going): nothing is read or fetched, nothing is finished, and the seconds come back.
  it.each([
    { outcome: 'cooldown', retry_in_s: 42 },
    { outcome: 'busy', retry_in_s: 10 },
  ])('CRITICAL: a $outcome refusal fetches NOTHING and says when to try again', async (claim) => {
    const f = world({ claim })
    const e = engine()
    const read = vi.fn(async () => known())
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: e, readKnown: read })
    expect(out).toMatchObject({ ok: false, reason: claim.outcome, retryInS: claim.retry_in_s })
    expect(e.calls).toEqual([])
    expect(read).not.toHaveBeenCalled()
    expect(finishCall(f)).toBeUndefined()
  })

  // Who writes: only the service role may write runs, so the manager's own session must write nothing.
  it('CRITICAL: every write goes through the WRITER (service role); the manager\'s session only reads', async () => {
    const reader = world()
    const writer = world()
    await runSeoTests(reader.client, A, 'publish', { writer: writer.client, userId: 'user-1', publishedAt: PUBLISHED_AT }, { engine: engine(), readKnown: async () => known() })
    const writes = (f: ReturnType<typeof world>) => f.calls.filter((c) => (c.op === 'rpc' && c.table.startsWith('seo_test_')) || (c.table === 'seo_test_runs' && c.op !== 'select'))
    expect(writes(reader)).toEqual([])
    expect(writes(writer).map((c) => c.table)).toEqual(['seo_test_claim', 'seo_test_finish'])
    expect(writes(writer)[0].args).toEqual({ p_artist_id: A, p_trigger: 'publish', p_user_id: 'user-1', p_published_at: PUBLISHED_AT })
  })
})

describe('no site connected', () => {
  // No site: say "no site" 24 times in storage (the page says it once) and fetch nothing.
  it('CRITICAL: 24 × unknown "no site", stored, and nothing fetched', async () => {
    const f = world()
    const e = engine()
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: e, readKnown: async () => known({ siteUrl: null }) })
    expect(out.ok).toBe(true)
    const s = stored(f)
    expect(s.results).toHaveLength(SEO_TEST_IDS.length)
    expect(s.results.every((r) => r.status === 'unknown' && /no site/.test(r.sentence))).toBe(true)
    expect(s.site_url).toBeNull()
    expect(e.calls).toEqual([])
  })
})

describe('the stale-site verdict is stored with the run', () => {
  // Fresh: the sitemap names the latest publish, so the run is stored as a test of the new site.
  it('fresh when the sitemap names the latest publish', async () => {
    const f = world()
    await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine(), readKnown: async () => known() })
    expect(stored(f).site_fresh).toBe(true)
    expect(stored(f).published_at).toBe(PUBLISHED_AT)
  })

  // Stale: the site still shows an older publish, so the run must say its verdict is about the old site.
  it('CRITICAL: stale when the sitemap still names an OLDER publish, and the run says so', async () => {
    const older = '2026-09-20T10:00:00.000001+00:00'
    const f = world({ moments: [PUBLISHED_AT, older] })
    const e = engine({ gatherSiteEvidence: async () => pages({ sitemap: { status: 200, urls: [`${ORIGIN}/`], lastmods: ['2026-09-20T10:00:00.000Z'] } }) })
    await runSeoTests(f.client, A, 'manual', WHO(f), { engine: e, readKnown: async () => known() })
    expect(stored(f).site_fresh).toBe(false)
    expect(stored(f).note).toMatch(/older publish/)
  })

  // Couldn't tell: no timed sitemap date is null, never "fresh"; the publish hook's own look can fill it in.
  it('couldn\'t tell (no timed lastmod) is null, never true; the publish hook\'s own look fills in', async () => {
    const f = world()
    const e = engine({ gatherSiteEvidence: async () => pages({ sitemap: null }) })
    await runSeoTests(f.client, A, 'manual', WHO(f), { engine: e, readKnown: async () => known() })
    expect(stored(f).site_fresh).toBeNull()
    const g = world()
    await runSeoTests(g.client, A, 'publish', WHO(g), { engine: e, readKnown: async () => known(), freshness: { fresh: true } })
    expect(stored(g).site_fresh).toBe(true)
  })
})

describe('the run-level `reach`: did the site answer at all?', () => {
  // Reach: whether the site answered at all is stored, so the page can say "we couldn't reach your site" once.
  it('CRITICAL: the gather\'s own `reach` is stored with the run', async () => {
    const f = world()
    const e = engine({ gatherSiteEvidence: async () => ({ ...pages(), reach: { state: 'server-error', status: 503 } }) })
    await runSeoTests(f.client, A, 'manual', WHO(f), { engine: e, readKnown: async () => known() })
    expect(stored(f).reach).toEqual({ state: 'server-error', status: 503 })
  })

  // No site, no reach: "not connected" must not be stored as "your site didn't answer".
  it('CRITICAL: no site connected has NO reach (null), not "no answer"', async () => {
    const f = world()
    await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine(), readKnown: async () => known({ siteUrl: null }) })
    expect(stored(f).reach).toBeNull()
  })

  // Timeout vs our bug: a hung site is "no-answer"; our own gatherer breaking says nothing about the site.
  it('a site that never answered inside the budget is "no-answer"; a gatherer that BROKE says nothing about the site (null)', async () => {
    const f = world()
    await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine({ gatherSiteEvidence: () => new Promise<SitePages>(() => {}) }), readKnown: async () => known(), budgetMs: 40 })
    expect(stored(f).reach).toMatchObject({ state: 'no-answer', status: null })
    const g = world()
    await runSeoTests(g.client, A, 'manual', WHO(g), { engine: engine({ gatherSiteEvidence: async () => { throw new Error('bug') } }), readKnown: async () => known() })
    expect(stored(g).reach).toBeNull()
  })
})

describe('failures after the claim', () => {
  // A failed read after the claim: the run is marked failed (not left "running") and the raw error stays hidden.
  it('CRITICAL: reading what Tapir knows failing marks the run FAILED and returns a plain error', async () => {
    const f = world()
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine(), readKnown: async () => { throw new Error('get_public_site: boom') } })
    expect(out).toMatchObject({ ok: false, reason: 'error' })
    if (!out.ok) expect(out.error).not.toMatch(/boom/)
    expect(finishArgs(f, 'failed')).toBeDefined()
  })

  // A finish that saved nothing: never tell the manager the results were saved.
  it('a finish that matched no running row is NOT reported as saved', async () => {
    const f = world({ finishRow: false })
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine(), readKnown: async () => known() })
    expect(out).toMatchObject({ ok: false, reason: 'error' })
  })

  // A refused finish: the run is marked failed so the artist isn't stuck as "busy" for 5 minutes.
  it('CRITICAL: a finish the database REFUSES (e.g. the size check) marks the run failed, so the artist is not "busy" for 5 minutes', async () => {
    const f = world({ finishError: true })
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine(), readKnown: async () => known() })
    expect(out).toMatchObject({ ok: false, reason: 'error' })
    expect(finishArgs(f, 'failed')).toBeDefined()
  })
})

describe('`na` (does not apply) is a verdict the run keeps', () => {
  const na = (id: SeoTestId): SeoTestResult => ({ id, status: 'na', value: 'doesn’t apply', sentence: 'this doesn’t apply to you.', evidence: [] })

  // `na` kept: "doesn't apply" is a real answer, not a broken test.
  it('CRITICAL: a test answering `na` is stored as `na`, not turned into "this test broke"', () => {
    const tests = allPass()
    tests.genre = () => na('genre')
    const results = runAllTests(tests, { known: known() } as SeoEvidence)
    expect(results.find((r) => r.id === 'genre')?.status).toBe('na')
  })

  // `na` needs no look: a MusicBrainz outage must not turn "doesn't apply" into "couldn't check".
  it('CRITICAL: a missed part of the evidence never overwrites a test that does not apply (`na` needs no look)', async () => {
    const tests = allPass()
    tests.mb = () => na('mb')
    const f = world()
    const out = await runSeoTests(f.client, A, 'manual', WHO(f), { engine: engine({ tests, lookupMusicBrainz: async () => { throw new Error('down') } }), readKnown: async () => known() })
    expect(out.ok).toBe(true)
    expect(stored(f).results.find((r) => r.id === 'mb')?.status).toBe('na')
  })
})
