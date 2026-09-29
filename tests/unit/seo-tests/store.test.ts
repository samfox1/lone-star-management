// The kept SEO / GEO runs: the database's refusals mapped to plain words, results capped before storage, history read oldest first.
/**
 * src/lib/seo-tests/store.ts over a PostgREST fake. The rules themselves (busy, cool-down,
 * retention, immutability) live in the migration and are pinned against the real database in
 * tests/integration/seo-tests/seo-test-runs.test.ts; this pins the TS side of each:
 *   • each refusal becomes its own reason + one plain sentence (never the raw Postgres message);
 *   • what is written is capped, and an `outside` action survives only with a https href;
 *   • readers throw on a failed read ("couldn't read" ≠ "never tested"), history is oldest first
 *     with every test id present, and a status the page does not know is dropped.
 */
import { describe, expect, it } from 'vitest'
import { capResult, claimRun, currentRun, historyFor, latestRun, seoScore } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, SEO_TEST_STATUSES, type SeoTestResult, type SeoTestStatus } from '@/lib/seo-tests/types'
import { fakeClient, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const A = 'artist-1'

describe('claimRun: the database says yes or no', () => {
  const claimWith = (reply: Reply) => claimRun(fakeClient(() => reply).client, A, 'manual')

  it('yes: the run id the database made', async () => {
    expect(await claimWith({ data: { id: 'r1', ran_at: '2026-09-28T21:00:00Z' } })).toEqual({ ok: true, runId: 'r1', ranAt: '2026-09-28T21:00:00Z' })
  })

  it('CRITICAL: the cool-down, with the seconds the database counted', async () => {
    const out = await claimWith({ error: { code: '23514', message: 'seo_test_cooldown: try again in 42 s' } })
    expect(out).toMatchObject({ ok: false, reason: 'cooldown', retryInS: 42 })
    if (!out.ok) expect(out.error).toBe('Tested a moment ago. Try again in 42 seconds.')
  })

  it('CRITICAL: busy, by the trigger OR by the one-running index (23505)', async () => {
    expect(await claimWith({ error: { code: '23514', message: 'seo_test_busy: a test is already running for this artist' } })).toMatchObject({ ok: false, reason: 'busy' })
    expect(await claimWith({ error: { code: '23505', message: 'duplicate key value violates unique constraint "seo_test_runs_one_running"' } })).toMatchObject({ ok: false, reason: 'busy' })
  })

  it('not a manager (42501) is "Artist not found.", and anything else a plain sentence, not the raw error', async () => {
    expect(await claimWith({ error: { code: '42501', message: 'permission denied: not a manager of this artist' } })).toMatchObject({ ok: false, reason: 'denied', error: 'Artist not found.' })
    const other = await claimWith({ error: { code: '08006', message: 'connection failure at 10.0.0.3' } })
    expect(other).toMatchObject({ ok: false, reason: 'error' })
    if (!other.ok) expect(other.error).not.toMatch(/10\.0\.0\.3/)
  })

  it('a client that throws is a plain error, never a throw', async () => {
    const f = fakeClient(() => {
      throw new Error('socket hang up')
    })
    await expect(claimRun(f.client, A, 'manual')).resolves.toMatchObject({ ok: false, reason: 'error' })
  })
})

describe('capResult: what may be stored', () => {
  const base: SeoTestResult = { id: 'title', status: 'fail', value: 'x', sentence: 'y', evidence: [] }

  it('CRITICAL: an `outside` action keeps only a https href (a javascript: link would be a stored XSS)', () => {
    expect(capResult({ ...base, action: { kind: 'outside', href: 'javascript:alert(1)', label: 'Open' } }).action).toBeUndefined()
    expect(capResult({ ...base, action: { kind: 'outside', href: 'http://www.bing.com/webmasters', label: 'Open' } }).action).toBeUndefined()
    expect(capResult({ ...base, action: { kind: 'outside', href: 'https://www.bing.com/webmasters', label: 'Open' } }).action).toEqual({ kind: 'outside', href: 'https://www.bing.com/webmasters', label: 'Open' })
  })

  it('every string is capped and evidence is at most 12 rows; the verdict itself is untouched', () => {
    const long = 'a'.repeat(5_000)
    const r = capResult({ ...base, value: long, sentence: long, todo: long, evidence: Array.from({ length: 30 }, (_, i) => ({ label: `l${i}`, value: long })) })
    expect(r.id).toBe('title')
    expect(r.status).toBe('fail')
    expect(r.value.length).toBeLessThanOrEqual(60)
    expect(r.sentence.length).toBeLessThanOrEqual(500)
    expect(r.todo!.length).toBeLessThanOrEqual(300)
    expect(r.evidence).toHaveLength(12)
    expect(r.evidence.every((e) => e.value.length <= 500)).toBe(true)
    // 24 worst-case results stay far under the table's 256 KB check.
    expect(JSON.stringify(SEO_TEST_IDS.map((id) => ({ ...r, id }))).length).toBeLessThan(200_000)
  })
})

describe('readers', () => {
  const row = (id: string, ranAt: string, summary: Record<string, string>) => ({
    id, artist_id: A, ran_at: ranAt, finished_at: ranAt, trigger: 'manual', site_url: 'https://x.example', passed: 1, total: 24, summary, site_fresh: true, published_at: null, note: null,
  })

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

  it('latestRun throws when the read fails: "couldn\'t read" must not look like "never tested"', async () => {
    const f = fakeClient(() => ({ error: { message: 'permission denied for table seo_test_runs' } }))
    await expect(latestRun(f.client, A)).rejects.toThrow()
    expect(await latestRun(fakeClient(() => ({ data: null })).client, A)).toBeNull()
  })

  it('latestRun keeps only real results', async () => {
    const f = fakeClient(() => ({ data: { ...row('r1', '2026-09-28T03:00:00Z', {}), results: [{ id: 'title', status: 'pass', value: '', sentence: '', evidence: [] }, { id: 'nope', status: 'pass' }, 'junk'] } }))
    const run = await latestRun(f.client, A)
    expect(run?.results.map((r) => r.id)).toEqual(['title'])
  })

  it('a running row older than 5 minutes is abandoned, not "running"', async () => {
    const now = Date.parse('2026-09-28T21:10:00Z')
    const at = (ranAt: string) => currentRun(fakeClient(() => ({ data: { ran_at: ranAt, trigger: 'publish' } })).client, A, now)
    expect(await at('2026-09-28T21:08:00Z')).toEqual({ ranAt: '2026-09-28T21:08:00Z', trigger: 'publish' })
    expect(await at('2026-09-28T21:00:00Z')).toBeNull()
  })
})

describe('`na` (does not apply): kept, shown, and left out of the score on both sides', () => {
  const row = (id: string, ranAt: string, summary: Record<string, string>) => ({
    id, artist_id: A, ran_at: ranAt, finished_at: ranAt, trigger: 'manual', site_url: 'https://x.example', passed: 1, total: 23, summary, site_fresh: true, published_at: null, note: null,
  })

  it('CRITICAL: a test\'s history may mix `na` with the other statuses; `na` is never dropped', async () => {
    const f = fakeClient(() => ({ data: [row('r2', '2026-09-28T03:00:00Z', { genre: 'na', mb: 'na' }), row('r1', '2026-09-27T03:00:00Z', { genre: 'fail', mb: 'unknown' })] }))
    const h = await historyFor(f.client, A, 8)
    expect(h.genre.map((d) => d.status)).toEqual(['fail', 'na'])
    expect(h.mb.map((d) => d.status)).toEqual(['unknown', 'na'])
  })

  it('CRITICAL: latestRun keeps a stored `na` result', async () => {
    const f = fakeClient(() => ({ data: { ...row('r1', '2026-09-28T03:00:00Z', {}), results: [{ id: 'genre', status: 'na', value: 'doesn’t apply', sentence: 's.', evidence: [] }] } }))
    expect((await latestRun(f.client, A))?.results.map((r) => r.status)).toEqual(['na'])
  })

  it('CRITICAL: seoScore counts passes over every status but `na` (the migration\'s rule)', () => {
    const of = (...st: SeoTestStatus[]) => seoScore(st.map((status) => ({ status })))
    expect(of('pass', 'fail', 'unknown', 'na')).toEqual({ passed: 1, total: 3 })
    expect(of(...Array.from({ length: 19 }, () => 'pass' as const), 'fail', 'fail', 'unknown', 'na', 'fail')).toEqual({ passed: 19, total: 23 })
    expect(of('na', 'na')).toEqual({ passed: 0, total: 0 })
    expect(of()).toEqual({ passed: 0, total: 0 })
  })

  it('every status the contract has is one the readers keep (derived, not hand-listed)', async () => {
    const summary = Object.fromEntries(SEO_TEST_STATUSES.map((st, i) => [SEO_TEST_IDS[i], st]))
    const h = await historyFor(fakeClient(() => ({ data: [row('r1', '2026-09-28T03:00:00Z', summary)] })).client, A, 8)
    SEO_TEST_STATUSES.forEach((st, i) => expect(h[SEO_TEST_IDS[i]].map((d) => d.status)).toEqual([st]))
  })
})
