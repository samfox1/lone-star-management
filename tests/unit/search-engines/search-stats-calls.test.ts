/**
 * Tapir asks Google and Bing how often a registered site was seen and clicked in search: the
 * exact calls, every answer read defensively, and the Bing key never carried out.
 *
 * Code:     src/lib/search-engines/google.ts (searchAnalytics),
 *           src/lib/search-engines/bing.ts (trafficStats, queryStats, pageStats)
 * Feature:  SEO / GEO page · "How fans find you" search numbers (data side, 2026-10-02)
 * Tier:     STRICT (AGENTS.md "Test depth"): parsers of outside answers (a page address from
 *           them ends up in a link), and calls made with a key that owns every client site.
 * Covers:   • Google: POST searchAnalytics/query on the property (encoded), the body sent as asked
 *             (web only, rowLimit clamped, dataState passed on), the Bearer token; dates and
 *             dimensions checked BEFORE anything is sent
 *           • Google's answer: rows with keys, no `rows` = none, position 0 (no impressions) is
 *             null, junk rows dropped, the first preliminary day from `metadata`
 *           • Google refusing (429, 403) or answering junk: `google_stats` with the status
 *           • Bing: GET GetRankAndTrafficStats / GetQueryStats / GetPageStats with the site, the
 *             key only in the query; the .NET date read as the calendar day in its own offset;
 *             -1 / 0 positions are null; junk rows dropped; no list = `bing_stats`
 *           • Bing refusing: `bing_stats` with Bing's ErrorCode (4/5 = throttled), `bing_auth` for
 *             401/403, and the key in none of it
 * Not here: turning these into the page's numbers (tests/unit/manager-tools/seo/search-stats.test.ts);
 *           sign-in, the 401 retry and timeouts (google.test.ts, shared by every call).
 * Fixtures: tests/fixtures/search-stats.json: REAL Search Console answers for skeenmusic.com and
 *           REAL (empty) Bing answers, fetched 2026-10-02; Bing's with-data shape is Microsoft
 *           Learn's documented sample (labelled so), since Bing has no numbers for the site yet.
 */
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bingClient } from '@/lib/search-engines/bing'
import { googleClient, type GoogleCreds } from '@/lib/search-engines/google'

const FX = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/search-stats.json'), 'utf8')) as Record<string, unknown>

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const CREDS: GoogleCreds = { client_email: 'tapir-search@digital-tapir.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }

const SITE = 'https://www.skeenmusic.com/'
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const QUERY_URL = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`
const BING_API = 'https://ssl.bing.com/webmaster/api.svc/json/'

type Call = { url: string; method: string; headers: Record<string, string>; body: string }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fake(answer: (c: Call) => Response) {
  const calls: Call[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : ''
    const c = { url, method: (init?.method ?? 'GET').toUpperCase(), headers, body }
    calls.push(c)
    return answer(c)
  }) as typeof fetch
  return { fetcher, calls }
}
/** A Google that signs in and answers the query with `rest`. */
const google = (rest: (c: Call) => Response) => {
  const f = fake((c) => (c.url === TOKEN_URL ? json({ access_token: 'ya29.test', expires_in: 3600 }) : rest(c)))
  return { ...f, client: googleClient(CREDS, { fetcher: f.fetcher }), asked: () => f.calls.filter((c) => c.url !== TOKEN_URL) }
}
const bing = (rest: (c: Call) => Response) => {
  const f = fake(rest)
  return { ...f, client: bingClient(KEY, { fetcher: f.fetcher }) }
}
const noKey = (x: unknown) => expect(JSON.stringify(x).includes(KEY)).toBe(false)

const RANGE = { startDate: '2026-07-02', endDate: '2026-10-02' }

describe('Google: searchAnalytics', () => {
  // The exact request: Search Console API v3 on the property, the body as asked, web results only.
  it('asks searchAnalytics/query on the property with the body it was given', async () => {
    const g = google(() => json(FX.google_date_all))
    await g.client.searchAnalytics(SITE, { ...RANGE, dimensions: ['date'], rowLimit: 500, dataState: 'all' })
    const [c] = g.asked()
    expect(c.url).toBe(QUERY_URL)
    expect(c.method).toBe('POST')
    expect(c.headers.authorization).toBe('Bearer ya29.test')
    expect(c.headers['content-type']).toMatch(/^application\/json/)
    expect(JSON.parse(c.body)).toEqual({ startDate: '2026-07-02', endDate: '2026-10-02', dimensions: ['date'], type: 'web', rowLimit: 500, dataState: 'all' })
  })

  // No dimensions is the property's total (one row, no keys); rowLimit outside 1..25000 is clamped;
  // no dataState sends none (Google's own default, final data only).
  it('sends no dimensions for a total, clamps rowLimit and leaves dataState out unless asked', async () => {
    const g = google(() => json(FX.google_total_all))
    await g.client.searchAnalytics(SITE, { ...RANGE, rowLimit: 99_999 })
    await g.client.searchAnalytics(SITE, { ...RANGE, rowLimit: 0 })
    await g.client.searchAnalytics(SITE, RANGE)
    const bodies = g.asked().map((c) => JSON.parse(c.body))
    expect(bodies[0]).toEqual({ ...RANGE, dimensions: [], type: 'web', rowLimit: 25_000 })
    expect(bodies[1].rowLimit).toBe(1)
    expect(bodies[2].rowLimit).toBe(1000)
    expect('dataState' in bodies[2]).toBe(false)
  })

  // Bad dates or a dimension Tapir doesn't read never reach Google.
  it('refuses bad dates and unknown dimensions without asking', async () => {
    const g = google(() => json(FX.google_total_all))
    for (const req of [
      { startDate: '2026-7-2', endDate: RANGE.endDate },
      { startDate: RANGE.startDate, endDate: '2026-10-02T00:00:00Z' },
      { ...RANGE, dimensions: ['hour'] },
      { ...RANGE, dimensions: ['searchAppearance'] },
    ]) {
      const r = await g.client.searchAnalytics(SITE, req as never)
      expect(r, JSON.stringify(req)).toMatchObject({ ok: false, reason: 'google_stats' })
    }
    expect(g.calls).toHaveLength(0)
  })

  // Skeen's real answer by date: keys kept, numbers kept, Google's "today" row (0 impressions,
  // position 0) has no position, and the first preliminary day comes from metadata.
  it('reads Skeen’s real answer by date', async () => {
    const g = google(() => json(FX.google_date_all))
    const r = await g.client.searchAnalytics(SITE, { ...RANGE, dimensions: ['date'], dataState: 'all' })
    expect(r).toEqual({
      ok: true,
      value: {
        firstIncompleteDate: '2026-09-30',
        rows: [
          { keys: ['2026-09-29'], clicks: 6, impressions: 23, position: 2.2608695652173916 },
          { keys: ['2026-09-30'], clicks: 5, impressions: 14, position: 2.2857142857142856 },
          { keys: ['2026-10-01'], clicks: 4, impressions: 19, position: 2.526315789473684 },
          { keys: ['2026-10-02'], clicks: 0, impressions: 0, position: null },
        ],
      },
    })
  })

  // The total: one row, no keys; no metadata = no preliminary day.
  it('reads the real total (no keys) and its missing metadata', async () => {
    const g = google(() => json(FX.google_total_all))
    expect(await g.client.searchAnalytics(SITE, RANGE)).toEqual({ ok: true, value: { firstIncompleteDate: null, rows: [{ keys: [], clicks: 15, impressions: 56, position: 2.357142857142857 }] } })
  })

  // Google leaves `rows` out when there is nothing: that is "no rows", not a failure.
  it('treats a missing rows list as no rows', async () => {
    const g = google(() => json({ responseAggregationType: 'byProperty' }))
    expect(await g.client.searchAnalytics(SITE, { ...RANGE, dimensions: ['query'] })).toEqual({ ok: true, value: { rows: [], firstIncompleteDate: null } })
  })

  // A row that isn't in Google's shape is dropped, never guessed at.
  it('drops rows that are not in Google’s shape', async () => {
    const good = { keys: ['skeen dj'], clicks: 9, impressions: 35, ctr: 0.25, position: 2.5 }
    const rows = [
      good,
      { ...good, keys: ['a', 'b'] },
      { ...good, keys: [7] },
      { ...good, keys: 'skeen' },
      { ...good, clicks: -1 },
      { ...good, impressions: Number.NaN },
      { ...good, clicks: '9' },
      { ...good, impressions: null },
      null,
      'row',
    ]
    const g = google(() => json({ rows, metadata: { firstIncompleteDate: 'soon' } }))
    const r = await g.client.searchAnalytics(SITE, { ...RANGE, dimensions: ['query'] })
    expect(r).toEqual({ ok: true, value: { rows: [{ keys: ['skeen dj'], clicks: 9, impressions: 35, position: 2.5 }], firstIncompleteDate: null } })
  })

  // A position that isn't a real rank (0, negative, junk) is null, not a rank.
  it('keeps only a real position', async () => {
    const g = google(() => json({ rows: [0, -3, 'x', null, 1].map((position) => ({ keys: ['q'], clicks: 1, impressions: 2, position })) }))
    const r = await g.client.searchAnalytics(SITE, { ...RANGE, dimensions: ['query'] })
    expect(r.ok && r.value.rows.map((x) => x.position)).toEqual([null, null, null, null, 1])
  })

  // Google saying no: the step's own reason and the status. A 200 that isn't JSON is no answer.
  it('says google_stats with the status when Google refuses or answers junk', async () => {
    for (const [res, status] of [
      [json({ error: { message: 'Quota exceeded for quota metric' } }, 429), 429],
      [json({ error: { message: 'User does not have sufficient permission for site' } }, 403), 403],
      [new Response('<html>', { status: 200 }), 200],
      [json('a string'), 200],
    ] as const) {
      const g = google(() => res.clone())
      expect(await g.client.searchAnalytics(SITE, RANGE)).toMatchObject({ ok: false, reason: 'google_stats', status })
    }
  })
})

describe('Bing: the three stats calls', () => {
  // GETs with the site in the query and the key beside it, no body.
  it('asks each method with a GET on the site', async () => {
    const b = bing(() => json({ d: [] }))
    await b.client.trafficStats(SITE)
    await b.client.queryStats(SITE)
    await b.client.pageStats(SITE)
    expect(b.calls.map((c) => new URL(c.url).pathname.split('/').pop())).toEqual(['GetRankAndTrafficStats', 'GetQueryStats', 'GetPageStats'])
    for (const c of b.calls) {
      const u = new URL(c.url)
      expect(`${u.origin}${u.pathname}`.startsWith(BING_API)).toBe(true)
      expect(c.method).toBe('GET')
      expect(c.body).toBe('')
      expect(u.searchParams.get('siteUrl')).toBe(SITE)
      expect(u.searchParams.get('apikey') === KEY).toBe(true)
    }
  })

  // Skeen's real answers today: Bing answered, and has nothing yet. That is an empty list.
  it('reads Bing’s real empty answers as empty lists', async () => {
    for (const [name, call] of [['bing_traffic_skeen', 'trafficStats'], ['bing_query_skeen', 'queryStats'], ['bing_page_skeen', 'pageStats']] as const) {
      const b = bing(() => json(FX[name]))
      expect(await b.client[call](SITE), name).toEqual({ ok: true, value: [] })
    }
  })

  // Microsoft's documented rows. Bing's date `/Date(1316156400000-0700)/` is midnight on
  // 2011-09-16 in its own offset (the XML form says 2011-09-16T00:00:00-07:00): a calendar day.
  it('reads the documented rows', async () => {
    const t = bing(() => json(FX.bing_documented_traffic))
    expect(await t.client.trafficStats(SITE)).toEqual({ ok: true, value: [{ date: '2011-09-16', clicks: 15, impressions: 100 }] })
    const q = bing(() => json(FX.bing_documented_query))
    expect(await q.client.queryStats(SITE)).toEqual({ ok: true, value: [{ key: 'query', date: '2011-09-16', clicks: 15, impressions: 100, position: 17 }] })
    expect(await q.client.pageStats(SITE)).toEqual({ ok: true, value: [{ key: 'query', date: '2011-09-16', clicks: 15, impressions: 100, position: 17 }] })
  })

  // The day is the wall-clock day in Bing's offset: UTC midnight at -0700 is still the 15th there.
  // No offset is UTC. A year-1 or junk date is no day.
  it('reads the calendar day in Bing’s own offset', async () => {
    const day = async (Date: unknown) => {
      const b = bing(() => json({ d: [{ Date, Clicks: 1, Impressions: 2 }] }))
      const r = await b.client.trafficStats(SITE)
      return r.ok ? (r.value[0]?.date ?? null) : 'failed'
    }
    expect(await day('/Date(1316131200000-0700)/')).toBe('2011-09-15')
    expect(await day('/Date(1316131200000)/')).toBe('2011-09-16')
    expect(await day('/Date(1316131200000+0000)/')).toBe('2011-09-16')
    expect(await day('/Date(1316174400000+1200)/')).toBe('2011-09-17')
    expect(await day('/Date(1316174400000+0530)/')).toBe('2011-09-16')
    for (const bad of ['/Date(-62135596800000)/', '2011-09-16', '/Date(x)/', null, 1316156400000]) expect(await day(bad), String(bad)).toBe(null)
  })

  // A traffic row needs a day and real counts; a query/page row needs a name. -1 or 0 is "no
  // position" (Bing has no rank to give), never a rank.
  it('drops junk rows and keeps only real positions', async () => {
    const D = '/Date(1316156400000-0700)/'
    const t = bing(() => json({ d: [{ Date: D, Clicks: 1, Impressions: 2 }, { Clicks: 1, Impressions: 2 }, { Date: D, Clicks: -1, Impressions: 2 }, { Date: D, Clicks: 1, Impressions: 'x' }, null] }))
    expect(await t.client.trafficStats(SITE)).toEqual({ ok: true, value: [{ date: '2011-09-16', clicks: 1, impressions: 2 }] })
    const rows = [
      { Query: 'a', Date: D, Clicks: 1, Impressions: 2, AvgImpressionPosition: -1 },
      { Query: 'b', Date: D, Clicks: 1, Impressions: 2, AvgImpressionPosition: 0 },
      { Query: 'c', Clicks: 1, Impressions: 2, AvgImpressionPosition: 3.5 },
      { Query: '', Date: D, Clicks: 1, Impressions: 2 },
      { Query: 7, Date: D, Clicks: 1, Impressions: 2 },
      { Query: 'd', Date: D, Clicks: Number.NaN, Impressions: 2 },
    ]
    const q = bing(() => json({ d: rows }))
    expect(await q.client.queryStats(SITE)).toEqual({
      ok: true,
      value: [
        { key: 'a', date: '2011-09-16', clicks: 1, impressions: 2, position: null },
        { key: 'b', date: '2011-09-16', clicks: 1, impressions: 2, position: null },
        { key: 'c', date: null, clicks: 1, impressions: 2, position: 3.5 },
      ],
    })
  })

  // No list at all is a failure, not "nothing yet".
  it('says bing_stats when the answer has no list', async () => {
    for (const body of [{ d: null }, { d: {} }, {}, { d: 'x' }]) {
      const b = bing(() => json(body))
      expect(await b.client.trafficStats(SITE), JSON.stringify(body)).toMatchObject({ ok: false, reason: 'bing_stats' })
    }
  })

  // Bing refusing: its ErrorCode rides along (4 ThrottleUser, 5 ThrottleHost are the quota), a
  // refused key is bing_auth, and the key is in none of it.
  it('passes on Bing’s error code, says bing_auth for a refused key, and never carries the key', async () => {
    const throttled = bing(() => json({ ErrorCode: 4, Message: `ThrottleUser for ${BING_API}GetQueryStats?apikey=${KEY}` }, 400))
    const r = await throttled.client.queryStats(SITE)
    expect(r).toMatchObject({ ok: false, reason: 'bing_stats', status: 400, code: 4 })
    noKey(r)
    const auth = bing(() => json({ ErrorCode: 3, Message: `InvalidApiKey ${KEY}` }, 401))
    const a = await auth.client.pageStats(SITE)
    expect(a).toMatchObject({ ok: false, reason: 'bing_auth', status: 401 })
    noKey(a)
    const net = bing(() => {
      throw new TypeError(`fetch failed ${BING_API}GetRankAndTrafficStats?apikey=${KEY}`)
    })
    const n = await net.client.trafficStats(SITE)
    expect(n).toMatchObject({ ok: false, reason: 'bing_network' })
    noKey(n)
    // No ErrorCode (or a junk one) is no code.
    const plain = bing(() => json({ ErrorCode: 'x', Message: 'no' }, 500))
    const p = await plain.client.trafficStats(SITE)
    expect(!p.ok && 'code' in p).toBe(false)
  })
})
