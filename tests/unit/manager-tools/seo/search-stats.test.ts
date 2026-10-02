/**
 * Google's and Bing's search numbers become ONE shape for "How fans find you", and an engine
 * Tapir couldn't ask says so instead of showing zeros.
 *
 * Code:     src/lib/manager-tools/seo/search-stats.ts
 * Feature:  SEO / GEO page · "How fans find you" (data side, Sam 2026-10-02)
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads outside answers, decides what the artist is
 *           told about their own audience, and a page address from it ends up in a link.
 * Covers:   • the periods: Google's day (Pacific time), last 28 days / last 3 months, both ends in
 *           • Skeen's REAL Google answers end to end: totals from the TOTAL (the query rows don't
 *             add up to it: Google hides rare searches), the "unlisted" rest, the daily series with
 *             Google's preliminary days marked and its not-yet-counted "today" dropped, queries,
 *             pages, countries, devices
 *           • a day with no row inside the data is a real zero day; nothing outside the period
 *           • only http(s) page addresses (no javascript:, no credentials); country and device
 *             codes from a fixed set; control characters out of a search
 *           • Bing: totals from the daily traffic, top searches and pages merged across Bing's
 *             weekly rows (position weighted by how often each was SEEN), no countries or devices
 *             (Bing doesn't say: null, not empty)
 *           • nothing recorded is `no_data`; a refusal is `quota` (429, Google 403 "quota", Bing
 *             ErrorCode 4/5) or `error`, and carries no numbers at all
 *           • every Google request is derived from the period (the asker sends exactly these)
 * Not here: the calls and their parsing (tests/unit/search-engines/search-stats-calls.test.ts);
 *           asking both engines, the deadline and the cache (search-stats-ask.test.ts).
 * Fixtures: tests/fixtures/search-stats.json (REAL Search Console answers for skeenmusic.com and
 *           REAL empty Bing answers, 2026-10-02), read through the real parsers, so the shapes
 *           here are Google's and Bing's own, not hand-copied.
 */
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bingClient, type BingDay, type BingResult, type BingTopRow } from '@/lib/search-engines/bing'
import { googleClient, type GoogleResult, type GoogleSearchAnswer } from '@/lib/search-engines/google'
import {
  GOOGLE_PARTS,
  SEARCH_PERIODS,
  couldntAsk,
  googleRequests,
  normaliseBing,
  normaliseGoogle,
  searchPeriod,
  type BingAnswers,
  type GoogleAnswers,
  type SearchPeriod,
} from '@/lib/manager-tools/seo/search-stats'

const FX = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/search-stats.json'), 'utf8')) as Record<string, unknown>
const SITE = 'https://www.skeenmusic.com/'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fixture through the REAL Google parser. */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const creds = { client_email: 'x@y.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
async function viaGoogle(body: unknown, dims: ('date' | 'query' | 'page' | 'country' | 'device')[] = []): Promise<GoogleResult<GoogleSearchAnswer>> {
  const fetcher = (async (u: string) => (u.includes('oauth2') ? json({ access_token: 't' }) : json(body))) as unknown as typeof fetch
  return googleClient(creds, { fetcher }).searchAnalytics(SITE, { startDate: '2026-07-02', endDate: '2026-10-02', dimensions: dims })
}
const skeenGoogle = async (): Promise<GoogleAnswers> => ({
  total: await viaGoogle(FX.google_total_all),
  date: await viaGoogle(FX.google_date_all, ['date']),
  query: await viaGoogle(FX.google_query_all, ['query']),
  page: await viaGoogle(FX.google_page_all, ['page']),
  country: await viaGoogle(FX.google_country_all, ['country']),
  device: await viaGoogle(FX.google_device_all, ['device']),
})
/** A fixture through the REAL Bing parsers: days (GetRankAndTrafficStats) or top rows. */
const bingWith = (body: unknown) => bingClient('k'.repeat(32), { fetcher: (async () => json(body)) as unknown as typeof fetch })
const bingDays = (body: unknown) => bingWith(body).trafficStats(SITE)
const bingRows = (body: unknown) => bingWith(body).queryStats(SITE)
const ok = <T>(value: T) => ({ ok: true as const, value })

/** 2026-10-02 12:00 in Los Angeles (PDT, UTC-7). */
const NOON_OCT_2 = Date.UTC(2026, 9, 2, 19)
const P3M = searchPeriod('3m', NOON_OCT_2)
const P28 = searchPeriod('28d', NOON_OCT_2)

describe('the periods', () => {
  // Search Console's days are Pacific time; both ends are included.
  it('ends today in Pacific time and counts both ends', () => {
    expect(P28).toEqual({ key: '28d', days: 28, start: '2026-09-05', end: '2026-10-02' })
    expect(P3M).toEqual({ key: '3m', days: 90, start: '2026-07-05', end: '2026-10-02' })
    // 05:00 UTC on Oct 2 is still Oct 1 in Los Angeles.
    expect(searchPeriod('28d', Date.UTC(2026, 9, 2, 5)).end).toBe('2026-10-01')
    // Winter (PST, UTC-8): 07:30 UTC on Jan 15 is still Jan 14.
    expect(searchPeriod('28d', Date.UTC(2027, 0, 15, 7, 30)).end).toBe('2027-01-14')
    expect(Object.keys(SEARCH_PERIODS)).toEqual(['28d', '3m'])
  })

  // What the asker sends Google, per part, all from the period: one total, fresh days included.
  it('derives every Google request from the period', () => {
    const reqs = googleRequests(P28)
    expect(Object.keys(reqs)).toEqual([...GOOGLE_PARTS])
    for (const part of GOOGLE_PARTS) {
      expect(reqs[part], part).toMatchObject({ startDate: '2026-09-05', endDate: '2026-10-02', dataState: 'all' })
      expect(reqs[part].dimensions ?? [], part).toEqual(part === 'total' ? [] : [part])
    }
  })
})

describe('Google: Skeen’s real numbers', () => {
  // The headline numbers are Google's TOTAL, never the sum of the query rows: Skeen's three named
  // searches add up to 12 clicks / 42 impressions, the total is 15 / 56.
  it('takes the totals from the total, and says how much the query list leaves out', async () => {
    const r = normaliseGoogle(P3M, await skeenGoogle())
    expect(r.state).toBe('ok')
    if (r.state !== 'ok') return
    expect(r.stats.totals).toEqual({ clicks: 15, impressions: 56, ctr: 15 / 56, position: 2.357142857142857 })
    expect(r.stats.unlisted).toEqual({ clicks: 3, impressions: 14 })
    expect(r.stats.engine).toBe('google')
    expect(r.stats.period).toEqual(P3M)
  })

  // Google's last days are preliminary (metadata.firstIncompleteDate 2026-09-30) and its "today"
  // row is 0 / 0 because it hasn't counted it yet, not because nobody searched: dropped.
  it('marks the preliminary days and drops the not-yet-counted today', async () => {
    const r = normaliseGoogle(P3M, await skeenGoogle())
    if (r.state !== 'ok') throw new Error(r.state)
    expect(r.stats.series).toEqual([
      { date: '2026-09-29', clicks: 6, impressions: 23, final: true },
      { date: '2026-09-30', clicks: 5, impressions: 14, final: false },
      { date: '2026-10-01', clicks: 4, impressions: 19, final: false },
    ])
    expect(r.stats.preliminaryFrom).toBe('2026-09-30')
    expect(r.stats.coverage).toEqual({ from: '2026-09-29', to: '2026-10-01' })
  })

  // Queries, pages, countries (ISO alpha-3, upper case) and devices, busiest first.
  it('lists queries, pages, countries and devices', async () => {
    const r = normaliseGoogle(P3M, await skeenGoogle())
    if (r.state !== 'ok') throw new Error(r.state)
    expect(r.stats.queries).toEqual([
      { key: 'skeen dj', clicks: 9, impressions: 35, ctr: 9 / 35, position: 2.5428571428571427 },
      { key: 'skeen music', clicks: 2, impressions: 4, ctr: 0.5, position: 2.25 },
      { key: 'dj skeen', clicks: 1, impressions: 3, ctr: 1 / 3, position: 2.666666666666667 },
    ])
    expect(r.stats.pages).toEqual([{ key: 'https://www.skeenmusic.com/', clicks: 15, impressions: 56, ctr: 15 / 56, position: 2.357142857142857 }])
    expect(r.stats.countries?.map((c) => c.key)).toEqual(['USA', 'NLD', 'BMU', 'GBR', 'IND', 'AUS', 'DEU', 'AUT', 'CHE', 'ITA', 'KOR', 'NOR', 'SWE'])
    expect(r.stats.countries?.[0]).toEqual({ key: 'USA', clicks: 11, impressions: 36, ctr: 11 / 36, position: 2.6944444444444446 })
    expect(r.stats.devices).toEqual([
      { key: 'desktop', clicks: 13, impressions: 38, ctr: 13 / 38, position: 2.3421052631578947 },
      { key: 'mobile', clicks: 2, impressions: 18, ctr: 2 / 18, position: 2.388888888888889 },
    ])
  })
})

describe('Google: the edges', () => {
  const row = (keys: string[], clicks: number, impressions: number, position: number | null = 2) => ({ keys, clicks, impressions, position })
  const answers = (over: Partial<Record<keyof GoogleAnswers, GoogleSearchAnswer>>): GoogleAnswers => ({
    total: ok(over.total ?? { rows: [row([], 10, 100)], firstIncompleteDate: null }),
    date: ok(over.date ?? { rows: [], firstIncompleteDate: null }),
    query: ok(over.query ?? { rows: [], firstIncompleteDate: null }),
    page: ok(over.page ?? { rows: [], firstIncompleteDate: null }),
    country: ok(over.country ?? { rows: [], firstIncompleteDate: null }),
    device: ok(over.device ?? { rows: [], firstIncompleteDate: null }),
  })
  const stats = (a: GoogleAnswers, p: SearchPeriod = P28) => {
    const r = normaliseGoogle(p, a)
    if (r.state !== 'ok') throw new Error(r.state)
    return r.stats
  }

  // Google leaves out days with nothing: inside the data such a day is a real zero. Days outside
  // the period, or not a day at all, are not shown. A final zero day at the end stays (it's real).
  it('fills a missing day inside the data with zero, keeps a real zero at the end, drops days outside', () => {
    const s = stats(answers({ date: { rows: [row(['2026-09-01'], 9, 9), row(['2026-09-10'], 1, 5), row(['2026-09-13'], 2, 6), row(['2026-09-14'], 0, 0, null), row(['nope'], 1, 1), row(['2026-10-03'], 1, 1)], firstIncompleteDate: null } }))
    expect(s.series).toEqual([
      { date: '2026-09-10', clicks: 1, impressions: 5, final: true },
      { date: '2026-09-11', clicks: 0, impressions: 0, final: true },
      { date: '2026-09-12', clicks: 0, impressions: 0, final: true },
      { date: '2026-09-13', clicks: 2, impressions: 6, final: true },
      { date: '2026-09-14', clicks: 0, impressions: 0, final: true },
    ])
    expect(s.coverage).toEqual({ from: '2026-09-10', to: '2026-09-14' })
  })

  // Only trailing preliminary EMPTY days go; a preliminary day with numbers stays, and so does an
  // empty preliminary day followed by one with numbers.
  it('drops only trailing empty preliminary days', () => {
    const s = stats(answers({ date: { rows: [row(['2026-09-28'], 1, 2), row(['2026-09-29'], 0, 0), row(['2026-09-30'], 3, 4), row(['2026-10-01'], 0, 0), row(['2026-10-02'], 0, 0)], firstIncompleteDate: '2026-09-29' } }))
    expect(s.series.map((d) => [d.date, d.final])).toEqual([
      ['2026-09-28', true],
      ['2026-09-29', false],
      ['2026-09-30', false],
    ])
  })

  // No impressions: no ctr and no position, never 0% or rank 0 (Google's position 0 included).
  it('has no ctr or position without impressions', () => {
    const s = stats(answers({ total: { rows: [row([], 1, 0, 0)], firstIncompleteDate: null }, query: { rows: [row(['skeen'], 1, 0, 3)], firstIncompleteDate: null } }))
    expect(s.totals).toEqual({ clicks: 1, impressions: 0, ctr: null, position: null })
    expect(s.queries[0]).toMatchObject({ ctr: null, position: null })
  })

  // A page address ends up in a link: http(s) only, no credentials, no junk. Two spellings Google
  // treats as one page are one row.
  it('keeps only http(s) page addresses', () => {
    const bad = ['javascript:alert(1)', 'data:text/html,x', '/about', 'https://user:pw@www.skeenmusic.com/', 'ftp://www.skeenmusic.com/', `https://www.skeenmusic.com/${'a'.repeat(2100)}`, '']
    const s = stats(answers({ page: { rows: [...bad.map((u) => row([u], 5, 5)), row(['https://www.skeenmusic.com/music'], 1, 2), row(['http://www.skeenmusic.com/'], 1, 1)], firstIncompleteDate: null } }))
    expect(s.pages.map((p) => p.key)).toEqual(['https://www.skeenmusic.com/music', 'http://www.skeenmusic.com/'])
  })

  // Countries are three letters (Google's ISO alpha-3), devices one of three; a search keeps no
  // control characters and is cut to 200.
  it('keeps country and device codes from a fixed set and cleans searches', () => {
    const s = stats(
      answers({
        country: { rows: [row(['usa'], 1, 1), row(['zzz'], 1, 1), row(['us'], 1, 1), row(['usa1'], 1, 1), row(['<b>'], 1, 1)], firstIncompleteDate: null },
        device: { rows: [row(['TABLET'], 1, 1), row(['SMART_TV'], 1, 1), row(['mobile'], 1, 1)], firstIncompleteDate: null },
        query: { rows: [row(['skeen\u0000 dj\u001b'], 1, 1), row(['\u0007'], 1, 1), row(['x'.repeat(300)], 0, 1)], firstIncompleteDate: null },
      }),
    )
    expect(s.countries?.map((c) => c.key)).toEqual(['USA', 'ZZZ'])
    expect(s.devices?.map((d) => d.key)).toEqual(['mobile', 'tablet'])
    expect(s.queries.map((q) => q.key)).toEqual(['skeen dj', 'x'.repeat(200)])
  })

  // The list is the top 50; "unlisted" is the total minus what the list shows, never below zero.
  it('keeps the top 50 and counts the rest as unlisted', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row([`q${String(i).padStart(2, '0')}`], 60 - i, 100))
    const s = stats(answers({ total: { rows: [row([], 2000, 9000)], firstIncompleteDate: null }, query: { rows, firstIncompleteDate: null } }))
    expect(s.queries).toHaveLength(50)
    expect(s.queries[0].key).toBe('q00')
    const shown = s.queries.reduce((n, q) => n + q.clicks, 0)
    expect(s.unlisted).toEqual({ clicks: 2000 - shown, impressions: 9000 - 5000 })
    const over = stats(answers({ total: { rows: [row([], 1, 1)], firstIncompleteDate: null }, query: { rows: [row(['a'], 5, 5)], firstIncompleteDate: null } }))
    expect(over.unlisted).toEqual({ clicks: 0, impressions: 0 })
  })

  // Nothing seen in search in the period is its own state, not a page of zeros.
  it('is no_data when Google has nothing for the period', () => {
    expect(normaliseGoogle(P28, answers({ total: { rows: [], firstIncompleteDate: null } }))).toEqual({ engine: 'google', state: 'no_data', period: P28 })
    expect(normaliseGoogle(P28, answers({ total: { rows: [row([], 0, 0, null)], firstIncompleteDate: null } })).state).toBe('no_data')
  })

  // A refusal anywhere means Tapir couldn't ask: no numbers at all (never zeros), the reason code
  // and status kept for the operator. A quota refusal anywhere wins (it means "later").
  it('says quota or error, with no numbers, when Google refuses', () => {
    const fail = (status: number, detail?: string) => ({ ok: false as const, reason: 'google_stats' as const, status, detail })
    const base = answers({})
    for (const part of GOOGLE_PARTS) {
      const r = normaliseGoogle(P28, { ...base, [part]: fail(500) })
      expect(r, part).toEqual({ engine: 'google', state: 'error', period: P28, reason: 'google_stats', status: 500 })
    }
    expect(normaliseGoogle(P28, { ...base, query: fail(429) }).state).toBe('quota')
    expect(normaliseGoogle(P28, { ...base, total: fail(403, 'Quota exceeded for quota metric'), date: fail(500) }).state).toBe('quota')
    expect(normaliseGoogle(P28, { ...base, page: fail(403, 'User does not have sufficient permission') }).state).toBe('error')
    expect(normaliseGoogle(P28, { ...base, total: fail(500), device: fail(429) }).state).toBe('quota')
    expect(normaliseGoogle(P28, { ...base, total: { ok: false, reason: 'google_network' } })).toEqual({ engine: 'google', state: 'error', period: P28, reason: 'google_network' })
  })
})

describe('Bing', () => {
  const D = (iso: string) => `/Date(${Date.parse(`${iso}T07:00:00Z`)}-0700)/`
  const answers = (traffic: BingResult<BingDay[]>, queries: BingResult<BingTopRow[]> = ok([]), pages: BingResult<BingTopRow[]> = ok([])): BingAnswers => ({ traffic, queries, pages })

  // Skeen today: Bing answered every call, with nothing. That is no_data, not zeros.
  it('is no_data for Skeen’s real empty answers', async () => {
    const r = normaliseBing(P3M, answers(await bingDays(FX.bing_traffic_skeen), await bingRows(FX.bing_query_skeen), await bingRows(FX.bing_page_skeen)))
    expect(r).toEqual({ engine: 'bing', state: 'no_data', period: P3M })
  })

  // Microsoft's documented rows (2011) are outside any recent period: nothing counts.
  it('counts nothing outside the period', async () => {
    const r = normaliseBing(P3M, answers(await bingDays(FX.bing_documented_traffic), await bingRows(FX.bing_documented_query)))
    expect(r.state).toBe('no_data')
  })

  // Totals are the daily traffic's sums; Bing's weekly query rows are merged per search; position
  // is weighted by impressions (how often each was SEEN); Bing names no countries or devices.
  it('sums the days, merges the weekly rows and weights position by impressions', async () => {
    const traffic = await bingDays({ d: [{ Date: D('2026-09-20'), Clicks: 2, Impressions: 10 }, { Date: D('2026-09-22'), Clicks: 1, Impressions: 30 }, { Date: D('2026-08-01'), Clicks: 50, Impressions: 50 }] })
    const queries = await bingRows({
      d: [
        { Query: 'skeen', Date: D('2026-09-14'), Clicks: 1, Impressions: 10, AvgImpressionPosition: 2 },
        { Query: 'skeen', Date: D('2026-09-21'), Clicks: 1, Impressions: 30, AvgImpressionPosition: 4 },
        { Query: 'skeen dj', Date: D('2026-09-21'), Clicks: 0, Impressions: 5, AvgImpressionPosition: -1 },
        { Query: 'old', Date: D('2026-07-01'), Clicks: 9, Impressions: 9, AvgImpressionPosition: 1 },
        { Query: 'undated', Clicks: 9, Impressions: 9, AvgImpressionPosition: 1 },
      ],
    })
    const pages = await bingRows({ d: [{ Query: 'javascript:alert(1)', Date: D('2026-09-21'), Clicks: 3, Impressions: 3 }, { Query: 'https://www.skeenmusic.com/', Date: D('2026-09-21'), Clicks: 2, Impressions: 40, AvgImpressionPosition: 3 }] })
    const r = normaliseBing(P28, answers(traffic, queries, pages))
    if (r.state !== 'ok') throw new Error(r.state)
    expect(r.stats.totals).toEqual({ clicks: 3, impressions: 40, ctr: 3 / 40, position: (10 * 2 + 30 * 4) / 40 })
    expect(r.stats.series).toEqual([
      { date: '2026-09-20', clicks: 2, impressions: 10, final: true },
      { date: '2026-09-21', clicks: 0, impressions: 0, final: true },
      { date: '2026-09-22', clicks: 1, impressions: 30, final: true },
    ])
    expect(r.stats.queries).toEqual([
      { key: 'skeen', clicks: 2, impressions: 40, ctr: 2 / 40, position: 3.5 },
      { key: 'skeen dj', clicks: 0, impressions: 5, ctr: 0, position: null },
    ])
    expect(r.stats.pages).toEqual([{ key: 'https://www.skeenmusic.com/', clicks: 2, impressions: 40, ctr: 2 / 40, position: 3 }])
    expect(r.stats.countries).toBeNull()
    expect(r.stats.devices).toBeNull()
    expect(r.stats.preliminaryFrom).toBeNull()
    expect(r.stats.unlisted).toEqual({ clicks: 1, impressions: 0 })
  })

  // Bing refusing: ErrorCode 4/5 or a 429 is quota, anything else an error; no numbers either way.
  it('says quota or error when Bing refuses', () => {
    const fail = (status: number, code?: number) => ({ ok: false as const, reason: 'bing_stats' as const, status, ...(code === undefined ? {} : { code }) })
    expect(normaliseBing(P28, answers(fail(400, 4)))).toEqual({ engine: 'bing', state: 'quota', period: P28, reason: 'bing_stats', status: 400 })
    expect(normaliseBing(P28, answers(ok([]), fail(400, 5))).state).toBe('quota')
    expect(normaliseBing(P28, answers(ok([]), ok([]), fail(429))).state).toBe('quota')
    expect(normaliseBing(P28, answers(fail(400, 14))).state).toBe('error')
    expect(normaliseBing(P28, answers({ ok: false, reason: 'bing_auth', status: 401 }))).toEqual({ engine: 'bing', state: 'error', period: P28, reason: 'bing_auth', status: 401 })
  })
})

describe('couldn’t ask', () => {
  // The states that are not an answer carry the period and nothing else.
  it('is the state and the period, nothing more', () => {
    for (const state of ['not_registered', 'no_key', 'timeout'] as const) expect(couldntAsk('bing', P28, state)).toEqual({ engine: 'bing', state, period: P28 })
  })
})
