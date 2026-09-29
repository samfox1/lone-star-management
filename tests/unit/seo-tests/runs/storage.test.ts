/**
 * Storing and reading SEO / GEO test runs: the database's refusals come back in plain words,
 * results are capped before they are stored, and reading back never passes junk to the page.
 *
 * Code:     src/lib/seo-tests/store.ts (claimRun, finishRun, failRun, capResult(s), latestRun,
 *           historyFor, recentRuns, currentRun, seoScore)
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
 * Not here: the database's own rules (cool-down, busy, limits, retention, immutability): the
 *           migration, pinned in tests/integration/seo-tests/seo-test-runs.test.ts; running the
 *           tests (runs/running.test.ts).
 * Fixtures: a PostgREST fake (brand/_fake-client) answers each call; `pgJsonbTextBytes` below
 *           rebuilds Postgres's own jsonb text so the byte budget is the table's measure.
 */
import { describe, expect, it } from 'vitest'
import { capResult, capResults, claimRun, currentRun, failRun, finishRun, historyFor, latestRun, recentRuns, seoScore } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, SEO_TEST_STATUSES, type SeoTestResult, type SeoTestStatus } from '@/lib/seo-tests/types'
import { fakeClient, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

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
