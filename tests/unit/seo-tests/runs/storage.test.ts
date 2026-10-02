/**
 * Storing and reading SEO / GEO test runs: the database's refusals come back in plain words,
 * results are capped before they are stored, and reading back never passes junk to the page.
 *
 * Code:     src/lib/seo-tests/store.ts (claimRun, finishRun, failRun, capResult(s), capCrawl,
 *           crawlOf, latestRun, historyFor, recentRuns, currentRun, seoScore)
 * Feature:  Test runs · storage (the seo_test_runs table), all 24 SEO tests
 * Tier:     STRICT (AGENTS.md "Test depth"): stored data the live page reads back, and a stored
 *           `outside` link the page renders (a javascript: link would be stored XSS).
 * Covers:   • the only writes are the two service-role functions (seo_test_claim, seo_test_finish)
 *           • each refusal is its own reason + seconds + one plain sentence, never a raw Postgres message
 *           • finish stores the run-level `reach` only in its known shape
 *           • what is stored is capped in BYTES, as the table measures (multi-byte text included), a
 *             cut never leaves half a character, and an `outside` link survives only if https
 *           • a stored result is shown only if it has the whole shape; a failed read throws
 *             ("couldn't read" is not "never tested"); history is oldest first with every test id
 *           • a run left "running" over 5 minutes is abandoned, not "running"
 *           • `na` is kept everywhere and left out of the score on both sides
 *           • the crawl (what a run saw): sent as `p_crawl` only whole (v:1, every field), made
 *             storable (no NUL, no half emoji), cut under the table's 64 KB in the stated order
 *             (robots text, then sitemap pages, then opened pages, else nothing), never costing the
 *             run its results, and read back only whole
 * Not here: the database's own rules (cool-down, busy, limits, retention, immutability, the crawl's
 *           64 KB check): the migrations, pinned in tests/integration/seo-tests/seo-test-runs.test.ts;
 *           running the tests (runs/running.test.ts); building the crawl (run.ts).
 * Fixtures: a PostgREST fake (tests/helpers/fake-client.ts) answers each call; `pgJsonbTextBytes` below
 *           rebuilds Postgres's own jsonb text so the byte budget is the table's measure;
 *           `realCrawl` is a crawl as a run makes one, built from the crawler registry (bots.ts).
 */
import { describe, expect, it } from 'vitest'
import { CRAWL_MAX_BYTES, capCrawl, capResult, capResults, claimRun, crawlOf, currentRun, failRun, finishRun, historyFor, latestRun, recentRuns, seoScore } from '@/lib/seo-tests/store'
import { FETCHING_BOTS, SEO_BOTS } from '@/lib/seo-tests/bots'
import { SEO_TEST_IDS, SEO_TEST_STATUSES, type SeoCrawl, type SeoTestResult, type SeoTestStatus } from '@/lib/seo-tests/types'
import { fakeClient, type Reply } from '@tests/helpers/fake-client'

const A = 'artist-1'

/** A stored run row as PostgREST returns it. */
const row = (id: string, ranAt: string, summary: Record<string, string>) => ({
  id, artist_id: A, ran_at: ranAt, finished_at: ranAt, trigger: 'manual', site_url: 'https://x.example', passed: 1, total: 24, summary, site_fresh: true, published_at: null, note: null,
})

describe('claimRun / finishRun: the ONLY write path, the service-role functions', () => {
  const U = 'user-1'
  const claimWith = (reply: Reply, opts: { trigger?: 'manual' | 'publish'; publishedAt?: string | null } = {}) => {
    const f = fakeClient(() => reply)
    return { f, out: claimRun(f.client, A, opts.trigger ?? 'manual', { userId: U, publishedAt: opts.publishedAt ?? null }) }
  }

  // The claim: one call to the service-role function, carrying who and which publish; never a table write.
  it('CRITICAL: a claim is ONE call to seo_test_claim with the artist, trigger, person and publish, never a table write', async () => {
    const { f, out } = claimWith({ data: [{ outcome: 'claimed', run_id: 'r1', ran_at: '2026-09-28T21:00:00Z', retry_in_s: null }] }, { trigger: 'publish', publishedAt: '2026-09-28T20:59:00Z' })
    expect(await out).toEqual({ ok: true, runId: 'r1', ranAt: '2026-09-28T21:00:00Z' })
    expect(f.calls.map((c) => `${c.op}:${c.table}`)).toEqual(['rpc:seo_test_claim'])
    expect(f.calls[0].args).toEqual({ p_artist_id: A, p_trigger: 'publish', p_user_id: U, p_published_at: '2026-09-28T20:59:00Z' })
  })

  // Refusals: each is its own reason and seconds, so the page never has to read the sentence to know which.
  it('CRITICAL: each refusal is its own reason with the seconds the database counted, and a plain sentence', async () => {
    const answer = async (outcome: string, retry_in_s: number | null) => claimWith({ data: [{ outcome, run_id: null, ran_at: null, retry_in_s }] }).out
    expect(await answer('cooldown', 42)).toEqual({ ok: false, reason: 'cooldown', retryInS: 42, error: 'Tested a moment ago. Try again in 42 seconds.' })
    expect(await answer('busy', 10)).toEqual({ ok: false, reason: 'busy', retryInS: 10, error: 'A test is already running. It will show here when it finishes.' })
    expect(await answer('coalesced', null)).toMatchObject({ ok: false, reason: 'coalesced', retryInS: null })
    expect(await answer('limit', 1800)).toMatchObject({ ok: false, reason: 'limit', retryInS: 1800, error: 'You’ve started a lot of tests lately. Try again in 30 minutes.' })
    expect(await answer('denied', null)).toMatchObject({ ok: false, reason: 'denied', error: 'Artist not found.' })
  })

  // The unexpected: a surprise answer, an error or a throw is a plain error, and never leaks an internal address.
  it('an unknown answer, an error or a throw is a plain error, never the raw message and never a throw', async () => {
    expect(await claimWith({ data: [{ outcome: 'surprise' }] }).out).toMatchObject({ ok: false, reason: 'error' })
    const other = await claimWith({ error: { code: '08006', message: 'connection failure at 10.0.0.3' } }).out
    expect(other).toMatchObject({ ok: false, reason: 'error' })
    if (!other.ok) expect(other.error).not.toMatch(/10\.0\.0\.3/)
    const f = fakeClient(() => {
      throw new Error('socket hang up')
    })
    await expect(claimRun(f.client, A, 'manual', { userId: U })).resolves.toMatchObject({ ok: false, reason: 'error' })
  })

  // The finish: one call; `false` (no running run matched) must not be reported as saved.
  it('CRITICAL: finish is ONE call to seo_test_finish; `false` (no running run) is not reported as saved', async () => {
    const yes = fakeClient(() => ({ data: true }))
    const r = [{ id: 'title', status: 'pass', value: 'v', sentence: 's.', evidence: [] }] as SeoTestResult[]
    expect(await finishRun(yes.client, 'r1', { results: r, siteUrl: 'https://x.example', siteFresh: true, publishedAt: null, note: null })).toEqual({ ok: true })
    expect(yes.calls.map((c) => `${c.op}:${c.table}`)).toEqual(['rpc:seo_test_finish'])
    expect(yes.calls[0].args).toMatchObject({ p_run_id: 'r1', p_status: 'done', p_results: r, p_site_fresh: true })
    const no = fakeClient(() => ({ data: false }))
    expect(await finishRun(no.client, 'r1', { results: r, siteUrl: null, siteFresh: null, publishedAt: null })).toMatchObject({ ok: false })
  })

  // Reach: stored only in its known shape; junk becomes null rather than a guess the page would believe.
  it('CRITICAL: finish stores the run-level `reach`, and only its known shape (junk becomes null, never a guess)', async () => {
    const r = [{ id: 'title', status: 'pass', value: 'v', sentence: 's.', evidence: [] }] as SeoTestResult[]
    const call = async (reach: unknown) => {
      const f = fakeClient(() => ({ data: true }))
      await finishRun(f.client, 'r1', { results: r, siteUrl: 'https://x.example', siteFresh: null, publishedAt: null, reach: reach as never })
      return (f.calls[0].args as { p_reach: unknown }).p_reach
    }
    expect(await call({ state: 'server-error', status: 503 })).toEqual({ state: 'server-error', status: 503 })
    expect(await call({ state: 'no-answer', status: null, error: 'timeout' })).toEqual({ state: 'no-answer', status: null, error: 'timeout' })
    expect(await call({ state: 'down', status: 503 })).toBeNull()
    expect(await call({ state: 'answered', status: '200' })).toBeNull()
    expect(await call(null)).toBeNull()
    expect(await call(undefined)).toBeNull()
  })

  // failRun: marks the run failed through the same function and never throws (it runs inside error handling).
  it('failRun marks the run failed through the same function, and never throws', async () => {
    const f = fakeClient(() => ({ data: true }))
    await failRun(f.client, 'r1', 'The test couldn’t finish.')
    expect(f.calls[0]).toMatchObject({ op: 'rpc', table: 'seo_test_finish', args: { p_run_id: 'r1', p_status: 'failed', p_note: 'The test couldn’t finish.' } })
    await expect(failRun(fakeClient(() => { throw new Error('x') }).client, 'r1', 'n')).resolves.toBeUndefined()
  })
})

describe('capResult: what may be stored', () => {
  const base: SeoTestResult = { id: 'title', status: 'fail', value: 'x', sentence: 'y', evidence: [] }

  // A NUL anywhere in a result would make Postgres refuse the whole finish (22P05): it becomes U+FFFD.
  it('CRITICAL: a NUL in a result becomes U+FFFD, so one bad byte can’t lose the run', () => {
    const r = capResult({ ...base, value: 'a\u0000b', sentence: 's\u0000', evidence: [{ label: 'l\u0000', value: '\u0000v' }] })
    expect(JSON.stringify(r)).not.toContain('\\u0000')
    expect(r.value).toBe('a\uFFFDb')
    expect(r.evidence[0]).toEqual({ label: 'l\uFFFD', value: '\uFFFDv' })
  })

  // Outside links: only https survives storage, since the page renders it as a link.
  it('CRITICAL: an `outside` action keeps only a https href (a javascript: link would be a stored XSS)', () => {
    expect(capResult({ ...base, action: { kind: 'outside', href: 'javascript:alert(1)', label: 'Open' } }).action).toBeUndefined()
    expect(capResult({ ...base, action: { kind: 'outside', href: 'http://www.bing.com/webmasters', label: 'Open' } }).action).toBeUndefined()
    expect(capResult({ ...base, action: { kind: 'outside', href: 'https://www.bing.com/webmasters', label: 'Open' } }).action).toEqual({ kind: 'outside', href: 'https://www.bing.com/webmasters', label: 'Open' })
  })

  // Caps: every string and the evidence list are capped, and the verdict itself is never touched.
  it('every string is capped and evidence is at most 12 rows; the verdict itself is untouched', () => {
    const long = 'a'.repeat(5_000)
    const r = capResult({ ...base, value: long, sentence: long, todo: long, evidence: Array.from({ length: 30 }, (_, i) => ({ label: `l${i}`, value: 'v'.repeat(100) })) })
    expect(r.id).toBe('title')
    expect(r.status).toBe('fail')
    expect(r.value.length).toBeLessThanOrEqual(120)
    expect(r.sentence.length).toBeLessThanOrEqual(800)
    expect(r.todo!.length).toBeLessThanOrEqual(400)
    expect(r.evidence).toHaveLength(12)
    // 24 worst-case ASCII results stay far under the table's 256 KB check.
    expect(JSON.stringify(SEO_TEST_IDS.map((id) => ({ ...r, id }))).length).toBeLessThan(200_000)
  })
})

/**
 * The table's size check is `octet_length(results::text) <= 262144`: BYTES of Postgres's jsonb
 * text. This reproduces that text exactly (", " and ": " separators; JSON string escapes), so the
 * budget below is the database's own measure, not an estimate.
 */
function pgJsonbTextBytes(v: unknown): number {
  const enc = new TextEncoder()
  const out = (x: unknown): string => {
    if (x === null) return 'null'
    if (Array.isArray(x)) return `[${x.map(out).join(', ')}]`
    if (typeof x === 'object') return `{${Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).map(([k, y]) => `${JSON.stringify(k)}: ${out(y)}`).join(', ')}}`
    return JSON.stringify(x)
  }
  return enc.encode(out(v)).length
}
const jsonBytes = (s: string) => new TextEncoder().encode(JSON.stringify(s)).length - 2
const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)

describe('capResult counts BYTES, as the table does', () => {
  // Three bytes a character (CJK), four (emoji), and characters JSON must escape (quotes, a
  // control character: six bytes each as \u0001).
  const heavy = (n: number) => '音"😀\u0001'.repeat(n)
  const worst = (id: SeoTestResult['id']): SeoTestResult => ({
    id, status: 'fail', value: heavy(500), sentence: heavy(5_000), good: heavy(5_000), todo: heavy(5_000), limits: heavy(5_000),
    evidence: Array.from({ length: 40 }, (_, i) => ({ label: heavy(200) + i, value: heavy(5_000) })),
    action: { kind: 'outside', href: `https://www.bing.com/${'a'.repeat(5_000)}`, label: heavy(500) },
  })

  // The table's size check: 24 worst-case results must fit, or the database refuses the whole run.
  it('CRITICAL: 24 results at every cap, in multi-byte text, stay under the table\'s 256 KB as Postgres counts it', () => {
    const results = capResults(SEO_TEST_IDS.map(worst))
    expect(pgJsonbTextBytes(results)).toBeLessThanOrEqual(220 * 1024)
  })

  // Bytes, not characters: CJK, emoji and escaped characters take more room than they look.
  it('CRITICAL: each field is capped in bytes of its JSON form, not in characters', () => {
    const r = capResult(worst('title'))
    expect(jsonBytes(r.value)).toBeLessThanOrEqual(120)
    expect(jsonBytes(r.sentence)).toBeLessThanOrEqual(800)
    expect(r.evidence.reduce((n, e) => n + jsonBytes(e.label) + jsonBytes(e.value), 0)).toBeLessThanOrEqual(4_000)
    // A plain ASCII sentence of 700 characters is kept whole: the cap is bytes, not a smaller char count.
    expect(capResult({ id: 'title', status: 'pass', value: 'v', sentence: 'a'.repeat(700), evidence: [] }).sentence).toBe('a'.repeat(700))
  })

  // Half an emoji: a lone surrogate makes the database refuse the run, so a cut must never leave one.
  it('CRITICAL: a cut never leaves half an emoji (a lone surrogate would make the database refuse the whole run)', () => {
    const r = capResult(worst('bio'))
    for (const text of [r.value, r.sentence, r.good!, r.todo!, r.limits!, ...r.evidence.flatMap((e) => [e.label, e.value])]) {
      expect(hasLoneSurrogate(text)).toBe(false)
    }
    // A lone surrogate that ARRIVES in a result is replaced, not stored.
    expect(hasLoneSurrogate(capResult({ id: 'bio', status: 'pass', value: 'a\uD800b', sentence: 's', evidence: [] }).value)).toBe(false)
  })
})

describe('readers', () => {
  // History: oldest first per test, every test present, and a status the page doesn't know is dropped.
  it('CRITICAL: history is OLDEST first per test, every id present, unknown statuses dropped', async () => {
    const f = fakeClient(() => ({
      data: [row('r3', '2026-09-28T03:00:00Z', { title: 'pass', bio: 'fail' }), row('r2', '2026-09-27T03:00:00Z', { title: 'fail', bio: 'weird' }), row('r1', '2026-09-26T03:00:00Z', { title: 'unknown' })],
    }))
    const h = await historyFor(f.client, A, 8)
    expect(Object.keys(h).sort()).toEqual([...SEO_TEST_IDS].sort())
    expect(h.title.map((d) => d.status)).toEqual(['unknown', 'fail', 'pass'])
    expect(h.bio.map((d) => d.status)).toEqual(['fail'])
    expect(h.card).toEqual([])
    const read = f.calls[0]
    expect(read.filters).toContainEqual(['eq', 'status', 'done'])
    expect(read.filters).toContainEqual(['limit', 8, undefined])
  })

  // A failed read throws, so the page says "couldn't read" rather than "never tested".
  it('latestRun throws when the read fails: "couldn\'t read" must not look like "never tested"', async () => {
    const f = fakeClient(() => ({ error: { message: 'permission denied for table seo_test_runs' } }))
    await expect(latestRun(f.client, A)).rejects.toThrow()
    expect(await latestRun(fakeClient(() => ({ data: null })).client, A)).toBeNull()
  })

  // Before the crawl column exists (the migration not pushed yet), the page must keep working:
  // the read tries again without it. Any other failure still throws.
  it('latestRun reads without the crawl when that column doesn’t exist yet', async () => {
    const run = row('r1', '2026-09-28T03:00:00Z', {})
    const f = fakeClient((call) => (String(call.cols).includes('crawl') ? { error: { code: '42703', message: 'column seo_test_runs.crawl does not exist' } } : { data: { ...run, results: [] } }))
    const got = await latestRun(f.client, A)
    expect(got?.id).toBe('r1')
    expect(got?.crawl ?? null).toBeNull()
    expect(f.calls).toHaveLength(2)
    expect(String(f.calls[1].cols)).not.toContain('crawl')
    const other = fakeClient(() => ({ error: { code: '42501', message: 'permission denied for table seo_test_runs' } }))
    await expect(latestRun(other.client, A)).rejects.toThrow()
    expect(other.calls).toHaveLength(1)
  })

  // Shape: a stored result the page can't draw (a missing field, an unknown test, not an object) is dropped, never shown; `na` is kept.
  it('CRITICAL: a stored result without the whole shape is dropped, not shown; a real one (`na` too) is kept', async () => {
    const good = { id: 'title', status: 'pass', value: 'v', sentence: 's', evidence: [{ label: 'l', value: 'v' }] }
    const f = fakeClient(() => ({
      data: {
        ...row('r1', '2026-09-28T03:00:00Z', {}),
        results: [
          good,
          { id: 'genre', status: 'na', value: 'doesn’t apply', sentence: 's.', evidence: [] },
          { ...good, id: 'desc', value: { html: '<b>' } },
          { ...good, id: 'bio', sentence: 42 },
          { ...good, id: 'genre', evidence: [{ label: 1 }] },
          { ...good, id: 'place', evidence: 'x' },
          { id: 'nope', status: 'pass' },
          'junk',
        ],
      },
    }))
    const kept = (await latestRun(f.client, A))?.results
    expect(kept?.map((r) => `${r.id}:${r.status}`)).toEqual(['title:pass', 'genre:na'])
  })

  // Reach read back: as stored, or null for older runs, no site, or junk.
  it('CRITICAL: readers hand the page `reach` as stored, or null (older runs, no site, junk)', async () => {
    const at = (reach: unknown) => latestRun(fakeClient(() => ({ data: { ...row('r1', '2026-09-28T03:00:00Z', {}), reach, results: [] } })).client, A)
    expect((await at({ state: 'refused', status: 403 }))?.reach).toEqual({ state: 'refused', status: 403 })
    expect((await at(null))?.reach).toBeNull()
    expect((await at(undefined))?.reach).toBeNull()
    expect((await at({ state: 'refused', status: 403, error: { x: 1 } }))?.reach).toBeNull()
    const f = fakeClient(() => ({ data: [{ ...row('r1', '2026-09-28T03:00:00Z', {}), reach: { state: 'no-answer', status: null } }] }))
    const [summary] = await recentRuns(f.client, A, 5)
    expect(summary.reach).toEqual({ state: 'no-answer', status: null })
    expect(String(f.calls[0].cols)).toContain('reach')
  })

  // Abandoned runs: a run "running" for over 5 minutes is dead, so the page must not wait on it.
  it('a running row older than 5 minutes is abandoned, not "running"', async () => {
    const now = Date.parse('2026-09-28T21:10:00Z')
    const at = (ranAt: string) => currentRun(fakeClient(() => ({ data: { ran_at: ranAt, trigger: 'publish' } })).client, A, now)
    expect(await at('2026-09-28T21:08:00Z')).toEqual({ ranAt: '2026-09-28T21:08:00Z', trigger: 'publish' })
    expect(await at('2026-09-28T21:00:00Z')).toBeNull()
  })
})

describe('`na` (does not apply): kept, shown, and left out of the score on both sides', () => {
  // The score: passes over every status but `na`, the same rule the migration uses.
  it('CRITICAL: seoScore counts passes over every status but `na` (the migration\'s rule)', () => {
    const of = (...st: SeoTestStatus[]) => seoScore(st.map((status) => ({ status })))
    expect(of('pass', 'fail', 'unknown', 'na')).toEqual({ passed: 1, total: 3 })
    expect(of(...Array.from({ length: 19 }, () => 'pass' as const), 'fail', 'fail', 'unknown', 'na', 'fail')).toEqual({ passed: 19, total: 23 })
    expect(of('na', 'na')).toEqual({ passed: 0, total: 0 })
    expect(of()).toEqual({ passed: 0, total: 0 })
  })

  // Every status is kept (derived from SEO_TEST_STATUSES), so a new status can't silently vanish from the history.
  it('every status the contract has is one the readers keep (derived, not hand-listed)', async () => {
    const summary = Object.fromEntries(SEO_TEST_STATUSES.map((st, i) => [SEO_TEST_IDS[i], st]))
    const h = await historyFor(fakeClient(() => ({ data: [row('r1', '2026-09-28T03:00:00Z', summary)] })).client, A, 8)
    SEO_TEST_STATUSES.forEach((st, i) => expect(h[SEO_TEST_IDS[i]].map((d) => d.status)).toEqual([st]))
  })
})

/**
 * A crawl as a run makes one (types.ts SeoCrawl): every crawler the tests know (SEO_BOTS, in
 * order, GPTBot blocked), "/" and four pages opened and answered by every VISITING crawler
 * (FETCHING_BOTS), a sitemap of 50, the other spelling, and both listing answers. Built from the
 * registries, so a crawler added to bots.ts is in it too.
 */
function realCrawl(): SeoCrawl {
  const site = 'https://www.example-artist.com'
  const opened = ['/', '/music', '/shows', '/about', '/press']
  const blocked = (key: string) => key === 'gptbot'
  return {
    v: 1,
    robots: {
      url: `${site}/robots.txt`,
      status: 200,
      text: `User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${site}/sitemap.xml`,
      truncated: false,
      bots: SEO_BOTS.map((b) => ({
        key: b.key, who: b.who, token: b.robotsToken, visits: b.fetches,
        verdict: blocked(b.key) ? ('blocked' as const) : ('allowed' as const), why: 'rules' as const,
        group: blocked(b.key) ? 'User-agent: GPTBot' : 'User-agent: *', rule: blocked(b.key) ? 'Disallow: /' : 'Allow: /',
      })),
    },
    sitemap: {
      url: `${site}/sitemap.xml`,
      status: 200,
      namedInRobots: true,
      total: 50,
      pages: Array.from({ length: 50 }, (_, i) => ({ path: opened[i] ?? `/music/song-${i}`, lastmod: '2026-09-28', status: i < opened.length ? 200 : null })),
      sameDates: true,
    },
    pages: opened.map((path) => ({
      path,
      status: 200,
      canonical: { person: `${site}${path}`, google: `${site}${path}`, bing: `${site}${path}` },
      noindex: { meta: false, header: false },
      visits: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, blocked(b.key) ? 403 : 200])),
    })),
    otherHost: { url: 'https://example-artist.com/', status: 308, to: `${site}/` },
    listing: {
      google: opened.map((path) => ({ path, answered: true, verdict: 'PASS', coverage: 'Submitted and indexed', lastCrawl: '2026-09-27T10:00:00Z' })),
      bing: opened.map((path) => ({ path, answered: true, lastCrawled: '2026-09-26T08:00:00Z', status: 200 })),
    },
  }
}

/** Every string in `v`, object keys included. */
const allText = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(allText) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...allText(x)]) : []

describe('the crawl (what a run saw): stored only whole, under the table\'s 64 KB, read back only whole', () => {
  const r = [{ id: 'title', status: 'pass', value: 'v', sentence: 's.', evidence: [] }] as SeoTestResult[]
  const finishWith = async (crawl: unknown, reply: (args: Record<string, unknown>) => Reply = () => ({ data: true })) => {
    const f = fakeClient((call) => reply(call.args as Record<string, unknown>))
    const out = await finishRun(f.client, 'r1', { results: r, siteUrl: 'https://www.example-artist.com', siteFresh: true, publishedAt: null, crawl: crawl as never })
    return { out, args: f.calls.map((c) => c.args as Record<string, unknown>) }
  }

  // The witness every "null" below is measured against: the fixture IS a whole crawl, and a crawl
  // that fits is stored exactly as the run made it.
  it('a real crawl is whole (crawlOf keeps it) and, under 64 KB, is stored exactly as made', () => {
    expect(crawlOf(realCrawl())).toEqual(realCrawl())
    expect(capCrawl(realCrawl())).toEqual(realCrawl())
    expect(pgJsonbTextBytes(realCrawl())).toBeLessThan(CRAWL_MAX_BYTES)
  })

  // The crawl reaches the database: one finish call carrying it as `p_crawl`, capped, with a
  // field the page does not know dropped rather than stored.
  it('CRITICAL: finish sends the crawl as `p_crawl` through capCrawl: a real crawl arrives whole, an unknown extra field does not', async () => {
    const { out, args } = await finishWith({ ...realCrawl(), extra: '<script>' })
    expect(out).toEqual({ ok: true })
    expect(args).toHaveLength(1)
    expect(args[0].p_crawl).toEqual(realCrawl())
    expect(args[0].p_results).toEqual(r)
  })

  // No crawl, no argument: a database from before the crawl migration has no `p_crawl`, and a
  // finish that named it would be refused there (PGRST202).
  it('without a crawl (absent, null or junk) `p_crawl` is not sent at all', async () => {
    for (const crawl of [undefined, null, { ...realCrawl(), v: 2 }]) {
      const { args } = await finishWith(crawl)
      expect(Object.keys(args[0])).not.toContain('p_crawl')
    }
  })

  // The crawl is extra, never the run: when the finish WITH one fails, the run is finished again
  // without it, so its 24 results are kept. Without a crawl there is nothing to drop: no retry.
  it('CRITICAL: when the finish WITH a crawl fails (not pushed yet, or refused), the run is finished again without it: its results are never lost', async () => {
    const refused = (args: Record<string, unknown>): Reply => ('p_crawl' in args ? { error: { code: 'PGRST202', message: 'Could not find the function public.seo_test_finish' } } : { data: true })
    const { out, args } = await finishWith(realCrawl(), refused)
    expect(out).toEqual({ ok: true })
    expect(args).toHaveLength(2)
    expect(args[0].p_crawl).toEqual(realCrawl())
    expect(args[1]).not.toHaveProperty('p_crawl')
    expect(args[1].p_results).toEqual(args[0].p_results)
    const bare = await finishWith(null, () => ({ error: { code: '23514', message: 'check' } }))
    expect(bare.out).toMatchObject({ ok: false })
    expect(bare.args).toHaveLength(1)
  })

  // Sent again ONLY when the database REFUSED the call (nothing was written). A lost answer (a
  // dropped connection, a timeout) may have finished the run with its crawl: a second call would
  // find it no longer running, and the artist would be told the results weren't saved.
  it('CRITICAL: the finish is sent again without the crawl only when the database refused it, never after a lost answer', async () => {
    for (const code of ['PGRST202', '23514', '22P02', '22P05']) {
      const { out, args } = await finishWith(realCrawl(), (a) => ('p_crawl' in a ? { error: { code, message: 'refused' } } : { data: true }))
      expect(out, code).toEqual({ ok: true })
      expect(args, code).toHaveLength(2)
    }
    // supabase-js reports a dropped connection as code '' ("TypeError: fetch failed"); 57014 is a
    // statement cut off by its timeout.
    for (const error of [{ code: '', message: 'TypeError: fetch failed' }, { message: 'AbortError: The operation was aborted.' }, { code: '57014', message: 'canceling statement due to statement timeout' }]) {
      const { out, args } = await finishWith(realCrawl(), (a) => ('p_crawl' in a ? { error } : { data: false }))
      expect(out, error.message).toMatchObject({ ok: false })
      expect(args, error.message).toHaveLength(1)
    }
  })

  // Only a WHOLE v:1 crawl is stored or shown: each broken piece makes the whole crawl null, on
  // the way in (capCrawl) and on the way out (crawlOf, what the reader uses).
  it.each<[string, (c: Record<string, any>) => void]>([ // eslint-disable-line @typescript-eslint/no-explicit-any
    ['another version', (c) => { c.v = 2 }],
    ['no robots part', (c) => { delete c.robots }],
    ['a status as text', (c) => { c.robots.status = '200' }],
    ['a status that is not a whole number', (c) => { c.pages[0].status = 200.5 }],
    ['a verdict the page does not know', (c) => { c.robots.bots[0].verdict = 'maybe' }],
    ['a reason the page does not know', (c) => { c.robots.bots[1].why = 'because' }],
    ['a crawler without its plain name', (c) => { delete c.robots.bots[0].who }],
    ['a nullable part missing (absent is not "none")', (c) => { delete c.otherHost }],
    ['a crawler\'s deciding rule missing (absent is not "none")', (c) => { delete c.robots.bots[2].rule }],
    ['a sitemap path that is not text', (c) => { c.sitemap.pages[3].path = { html: '<b>' } }],
    ['a crawler\'s answer as text', (c) => { c.pages[1].visits[FETCHING_BOTS[0].key] = 'ok' }],
    ['a listing that is not a list', (c) => { c.listing.google = 'indexed' }],
    ['a negative total', (c) => { c.sitemap.total = -1 }],
    ['a noindex that is not true or false', (c) => { c.pages[0].noindex.meta = 'yes' }],
    ['a canonical that is not text', (c) => { c.pages[2].canonical.google = 42 }],
  ])('CRITICAL: %s: the whole crawl is null, in and out', (_what, breakIt) => {
    const c = structuredClone(realCrawl()) as unknown as Record<string, unknown>
    breakIt(c)
    expect(crawlOf(c)).toBeNull()
    expect(capCrawl(c)).toBeNull()
  })

  // Not a crawl at all: never stored, never shown.
  it('something that is not an object at all is null', () => {
    for (const v of [null, undefined, 'crawl', 1, [], [realCrawl()]]) {
      expect(crawlOf(v)).toBeNull()
      expect(capCrawl(v)).toBeNull()
    }
  })

  // Step 1 of the size cap: the robots.txt text goes first (marked truncated: read, not kept),
  // and when that is enough nothing else is cut.
  it('CRITICAL: over 64 KB, the robots.txt TEXT goes first, marked truncated, and nothing else is cut when that is enough', () => {
    const c = realCrawl()
    c.robots.text = '音'.repeat(25_000) // 75,000 bytes: the crawl is over the limit because of it alone
    expect(pgJsonbTextBytes(c)).toBeGreaterThan(CRAWL_MAX_BYTES)
    const out = capCrawl(c)!
    expect(out.robots.text).toBeNull()
    expect(out.robots.truncated).toBe(true)
    expect(out.sitemap).toEqual(realCrawl().sitemap)
    expect(out.pages).toEqual(realCrawl().pages)
    expect(out.robots.bots).toEqual(realCrawl().robots.bots)
    expect(pgJsonbTextBytes(out)).toBeLessThanOrEqual(CRAWL_MAX_BYTES)
  })

  // Step 2: then sitemap pages, from the END, keeping as many as fit (one more would not: short
  // pages, so a cut of even ~70 bytes too many shows); the opened pages are untouched and `total`
  // still says how many the list named. (run.ts keeps 50; the cap does not count on it.)
  it('CRITICAL: then sitemap pages from the end, as few as needed; opened pages untouched; `total` unchanged', () => {
    const c = realCrawl()
    c.sitemap.total = 2_000
    c.sitemap.pages = Array.from({ length: 2_000 }, (_, i) => ({ path: `/music/song-${i}`, lastmod: '2026-09-28', status: null }))
    expect(pgJsonbTextBytes(c)).toBeGreaterThan(CRAWL_MAX_BYTES)
    const out = capCrawl(c)!
    const n = out.sitemap.pages.length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(2_000)
    expect(out.sitemap.pages).toEqual(c.sitemap.pages.slice(0, n))
    expect(out.sitemap.total).toBe(2_000)
    expect(out.robots.text).toBeNull()
    expect(out.pages).toEqual(realCrawl().pages)
    expect(pgJsonbTextBytes(out)).toBeLessThanOrEqual(CRAWL_MAX_BYTES)
    expect(pgJsonbTextBytes({ ...out, sitemap: { ...out.sitemap, pages: c.sitemap.pages.slice(0, n + 1) } })).toBeGreaterThan(CRAWL_MAX_BYTES)
  })

  // Step 3: then opened pages, from the end ("/" is first, so it goes last); every crawler's
  // robots verdict is kept whatever else goes.
  it('CRITICAL: then opened pages from the end ("/" last), after every sitemap page; every crawler\'s verdict is kept', () => {
    const c = realCrawl()
    c.pages = c.pages.map((p) => ({ ...p, canonical: { ...p.canonical, person: `https://www.example-artist.com/${'音'.repeat(6_000)}` } })) // ~18 KB each
    const out = capCrawl(c)!
    const n = out.pages.length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(5)
    expect(out.pages).toEqual(c.pages.slice(0, n))
    expect(out.pages[0].path).toBe('/')
    expect(out.sitemap.pages).toEqual([])
    expect(out.robots.bots).toEqual(realCrawl().robots.bots)
    expect(crawlOf(out)).toEqual(out)
    expect(pgJsonbTextBytes(out)).toBeLessThanOrEqual(CRAWL_MAX_BYTES)
  })

  // Too big even then (the verdicts alone): null, never an oversized crawl the table would refuse.
  it('CRITICAL: when even the verdicts alone are over 64 KB the crawl is null, never an oversized one', () => {
    const c = realCrawl()
    c.robots.bots = c.robots.bots.map((b) => ({ ...b, rule: `Disallow: /${'a'.repeat(6_000)}` }))
    expect(c.robots.bots.length * 6_000).toBeGreaterThan(CRAWL_MAX_BYTES)
    expect(capCrawl(c)).toBeNull()
  })

  // Postgres refuses a NUL or half an emoji inside jsonb, which would sink the whole finish (the
  // results with it): each is replaced before it is sent; a whole emoji is kept.
  it('CRITICAL: a NUL or half an emoji (anywhere, keys included) is replaced before it is sent; a whole emoji is kept', () => {
    const c = realCrawl()
    c.robots.text = 'a\u0000b\uD800c 😀'
    c.sitemap.pages[0].path = '/\uDC00x'
    c.pages[0].visits['bad\u0000key'] = 200
    const out = capCrawl(c)!
    for (const s of allText(out)) {
      expect(s).not.toContain('\u0000')
      expect(hasLoneSurrogate(s)).toBe(false)
    }
    expect(out.robots.text).toBe('a�b�c 😀')
  })

  // The page reads the crawl back only whole: as stored, or null for a run from before crawls and
  // for junk. The full-run read asks for it; the history read (many rows) never does.
  it('CRITICAL: latestRun hands the page the crawl as stored, or null (older runs, junk); only the full-run read selects it', async () => {
    const at = async (crawl: unknown) => {
      const f = fakeClient(() => ({ data: { ...row('r1', '2026-09-28T03:00:00Z', {}), results: [], crawl } }))
      return { run: await latestRun(f.client, A), cols: String(f.calls[0].cols) }
    }
    const real = await at(realCrawl())
    expect(real.run?.crawl).toEqual(realCrawl())
    expect(real.cols).toMatch(/\bcrawl\b/)
    expect((await at(undefined)).run?.crawl).toBeNull()
    expect((await at(null)).run?.crawl).toBeNull()
    expect((await at({ ...realCrawl(), v: 2 })).run?.crawl).toBeNull()
    expect((await at({ ...realCrawl(), pages: [{ path: '/' }] })).run?.crawl).toBeNull()
    const f = fakeClient(() => ({ data: [] }))
    await recentRuns(f.client, A, 5)
    expect(String(f.calls[0].cols)).not.toMatch(/\bcrawl\b/)
  })
})
