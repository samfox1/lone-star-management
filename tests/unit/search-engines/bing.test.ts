// Tapir's Bing account adds and verifies a site: the exact calls, and the key never leaks.
/**
 * Code:     src/lib/search-engines/bing.ts (bingClient)
 * Feature:  Add website · registering a site with Bing (ADD_WEBSITE_PLAN.md step 4)
 * Tier:     STRICT (AGENTS.md "Test depth"): Bing's API key rides in every request URL
 *           (`?apikey=`) and belongs to Sam's Bing account, which will hold every client site. It
 *           must never reach a return value, a reason, or Bing's message passed on to the
 *           operator. The calls are Bing's JSON API (SOAP/POX were retired 2026-08-31).
 * Covers:   • AddSite, VerifySite, SubmitFeed: POST, JSON body, the key only in the query
 *           • this site's msvalidate.01 code from GetUserSites, matched whatever the case or
 *             trailing slash, refused unless it is 32 hex
 *           • a refused key is `bing_auth`, each step's failure its own reason, no answer
 *             `bing_network`; the key is never in any of them
 * Not here: the order of the steps and what is stored (register.test.ts).
 * Fixtures: a fake fetch that records every request; a made-up key.
 */
import { describe, expect, it } from 'vitest'
import { bingClient } from '@/lib/search-engines/bing'

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const SITE = 'https://www.skeenmusic.com/'
const CODE = 'DFA80FE427DDB6FD866F4B6A6564E412'
const API = 'https://ssl.bing.com/webmaster/api.svc/json/'

type Call = { url: URL; method: string; contentType: string | null; body: unknown }

function fakeBing(answer: (c: Call) => Response) {
  const calls: Call[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const call = { url, method: (init?.method ?? 'GET').toUpperCase(), contentType: new Headers(init?.headers).get('content-type'), body }
    calls.push(call)
    return answer(call)
  }) as typeof fetch
  return { fetcher, calls }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** Nothing a caller can see may contain the key. */
const noKey = (x: unknown) => expect(JSON.stringify(x)).not.toContain(KEY)

describe('the calls', () => {
  // AddSite: POST with the site in a JSON body; the key only in the query string.
  it('adds the site', async () => {
    const b = fakeBing(() => json({ d: null }))
    const r = await bingClient(KEY, { fetcher: b.fetcher }).addSite(SITE)
    expect(r).toEqual({ ok: true, value: true })
    const c = b.calls[0]
    expect(`${c.url.origin}${c.url.pathname}`).toBe(`${API}AddSite`)
    expect(c.url.searchParams.get('apikey')).toBe(KEY)
    expect(c.method).toBe('POST')
    expect(c.contentType).toMatch(/^application\/json/)
    expect(c.body).toEqual({ siteUrl: SITE })
  })

  // VerifySite answers { d: true } when Bing found the tag.
  it('verifies the site', async () => {
    const b = fakeBing(() => json({ d: true }))
    expect(await bingClient(KEY, { fetcher: b.fetcher }).verify(SITE)).toEqual({ ok: true, value: true })
    expect(b.calls[0].url.pathname.endsWith('/VerifySite')).toBe(true)
    expect(b.calls[0].body).toEqual({ siteUrl: SITE })
  })

  // { d: false } is Bing saying "not yet", not a success.
  it('says bing_verify when Bing couldn’t verify', async () => {
    const b = fakeBing(() => json({ d: false }))
    expect(await bingClient(KEY, { fetcher: b.fetcher }).verify(SITE)).toMatchObject({ ok: false, reason: 'bing_verify' })
  })

  // SubmitFeed is how a sitemap reaches Bing (there is no SubmitSitemap).
  it('sends the sitemap as a feed', async () => {
    const b = fakeBing(() => json({ d: null }))
    expect(await bingClient(KEY, { fetcher: b.fetcher }).submitFeed(SITE, `${SITE}sitemap.xml`)).toEqual({ ok: true, value: true })
    expect(b.calls[0].url.pathname.endsWith('/SubmitFeed')).toBe(true)
    expect(b.calls[0].body).toEqual({ siteUrl: SITE, feedUrl: `${SITE}sitemap.xml` })
  })
})

describe('this site’s code', () => {
  // GetUserSites lists every site on the account; ours is matched however Bing spells it.
  it('finds the site whatever the case or trailing slash', async () => {
    for (const listed of ['https://www.skeenmusic.com/', 'https://www.skeenmusic.com', 'https://WWW.SkeenMusic.com/']) {
      const b = fakeBing(() => json({ d: [{ Url: 'https://other.example/', AuthenticationCode: '0'.repeat(32) }, { Url: listed, AuthenticationCode: CODE, IsVerified: true }] }))
      expect(await bingClient(KEY, { fetcher: b.fetcher }).siteCode(SITE), listed).toEqual({ ok: true, value: CODE })
      expect(b.calls[0].method).toBe('GET')
      expect(b.calls[0].url.pathname.endsWith('/GetUserSites')).toBe(true)
    }
  })

  // Bing's spellings of the same site: a trailing dot on the host, extra slashes; junk entries skipped.
  it('matches through a trailing dot and extra slashes, and skips junk entries', async () => {
    const b = fakeBing(() => json({ d: [null, { AuthenticationCode: '0'.repeat(32) }, { Url: 42 }, { Url: 'not a url' }, { Url: 'https://www.skeenmusic.com.//', AuthenticationCode: CODE }] }))
    expect(await bingClient(KEY, { fetcher: b.fetcher }).siteCode(SITE)).toEqual({ ok: true, value: CODE })
  })

  // A different path on the same host is a different Bing site.
  it('doesn’t match a different path or another host', async () => {
    for (const Url of ['https://www.skeenmusic.com/music/', 'https://skeenmusic.com/', 'NOT A URL']) {
      const b = fakeBing(() => json({ d: [{ Url, AuthenticationCode: CODE }] }))
      expect(await bingClient(KEY, { fetcher: b.fetcher }).siteCode(SITE), Url).toMatchObject({ ok: false, reason: 'bing_code', detail: 'the site is not on the account' })
    }
  })

  // A site Bing doesn't list, or a code that isn't 32 hex, is refused: it would never render.
  it('says bing_code when the site isn’t listed or its code is malformed', async () => {
    for (const d of [[], [{ Url: 'https://other.example/', AuthenticationCode: CODE }], [{ Url: SITE, AuthenticationCode: '"><script>' }], [{ Url: SITE }], null]) {
      const b = fakeBing(() => json({ d }))
      expect(await bingClient(KEY, { fetcher: b.fetcher }).siteCode(SITE), JSON.stringify(d)).toMatchObject({ ok: false, reason: 'bing_code' })
    }
  })
})

describe('failures never carry the key', () => {
  // A wrong or revoked key.
  it('says bing_auth for a refused key', async () => {
    const b = fakeBing(() => json({ ErrorCode: 3, Message: `Invalid API key ${KEY}` }, 401))
    const r = await bingClient(KEY, { fetcher: b.fetcher }).addSite(SITE)
    expect(r).toMatchObject({ ok: false, reason: 'bing_auth', status: 401 })
    noKey(r)
    const forbidden = fakeBing(() => json({ Message: 'no' }, 403))
    expect(await bingClient(KEY, { fetcher: forbidden.fetcher }).verify(SITE)).toMatchObject({ ok: false, reason: 'bing_auth', status: 403 })
  })

  // Bing's message: the key replaced by <key>, cut to 200; an answer that isn't JSON has none.
  it('marks where the key was and cuts the message; no JSON, no message', async () => {
    const long = fakeBing(() => json({ Message: `${KEY} ${'y'.repeat(400)}` }, 400))
    const r = await bingClient(KEY, { fetcher: long.fetcher }).addSite(SITE)
    const detail = r.ok ? '' : (r.detail ?? '')
    expect(detail.startsWith('<key> y')).toBe(true)
    expect(detail).toHaveLength(200)
    const html = fakeBing(() => new Response('<html>500</html>', { status: 500 }))
    expect(await bingClient(KEY, { fetcher: html.fetcher }).addSite(SITE)).toEqual({ ok: false, reason: 'bing_add', status: 500, detail: undefined })
  })

  // A 200 with an empty body is still Bing saying yes (AddSite and SubmitFeed answer { d: null }).
  it('accepts a success with an empty body', async () => {
    const b = fakeBing(() => new Response('', { status: 200 }))
    expect(await bingClient(KEY, { fetcher: b.fetcher }).addSite(SITE)).toEqual({ ok: true, value: true })
  })

  // Each step's own reason, and Bing's message passed on with the key blanked out.
  it('gives each step its own reason and scrubs the key from Bing’s message', async () => {
    const b = fakeBing(() => json({ ErrorCode: 14, Message: `Something failed for request ${API}X?apikey=${KEY}` }, 400))
    const client = bingClient(KEY, { fetcher: b.fetcher })
    const results = [await client.addSite(SITE), await client.verify(SITE), await client.submitFeed(SITE, `${SITE}sitemap.xml`), await client.siteCode(SITE)]
    expect(results.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['bing_add', 'bing_verify', 'bing_feed', 'bing_code'])
    for (const r of results) {
      noKey(r)
      if (!r.ok) expect(r.detail).toContain('Something failed')
    }
  })

  // No answer at all is not Bing refusing; and a thrown error's text never leaks the URL.
  it('says bing_network when Bing can’t be reached', async () => {
    const b = fakeBing(() => {
      throw new TypeError(`fetch failed for ${API}AddSite?apikey=${KEY}`)
    })
    const r = await bingClient(KEY, { fetcher: b.fetcher }).addSite(SITE)
    expect(r).toMatchObject({ ok: false, reason: 'bing_network' })
    noKey(r)
  })
})

describe('when Bing last crawled a page (GetUrlInfo)', () => {
  const PAGE = 'https://www.skeenmusic.com/about'
  /** 2011-09-16T07:00:00Z: Bing's own documented example value. */
  const MS = 1316156400000

  // A GET with the site and the page in the query, the key beside them, no body.
  it('asks GetUrlInfo for one page of the site', async () => {
    const b = fakeBing(() => json({ d: { __type: 'UrlInfo:#Microsoft.Bing.Webmaster.Api', Url: PAGE, HttpStatus: 200, LastCrawledDate: `/Date(${MS}-0700)/` } }))
    const r = await bingClient(KEY, { fetcher: b.fetcher }).urlInfo(SITE, PAGE)
    expect(r).toEqual({ ok: true, value: { lastCrawled: '2011-09-16T07:00:00.000Z', status: 200 } })
    const c = b.calls[0]
    expect(`${c.url.origin}${c.url.pathname}`).toBe(`${API}GetUrlInfo`)
    expect(c.method).toBe('GET')
    expect(c.body).toBeUndefined()
    expect(c.url.searchParams.get('apikey')).toBe(KEY)
    expect(c.url.searchParams.get('siteUrl')).toBe(SITE)
    expect(c.url.searchParams.get('url')).toBe(PAGE)
  })

  // The .NET date form: the number is milliseconds since 1970 in UTC, and the "+hhmm" after it
  // only says which zone the value was local to (Microsoft's DataContractJsonSerializer docs). So
  // the same number is the same moment whatever the offset: applying the offset again would
  // move the date by hours.
  it('reads /Date(ms±hhmm)/ as the UTC moment the number names, whatever the offset', async () => {
    for (const offset of ['', '+0000', '-0700', '+0530', '-1200']) {
      const b = fakeBing(() => json({ d: { HttpStatus: 200, LastCrawledDate: `/Date(${MS}${offset})/` } }))
      const r = await bingClient(KEY, { fetcher: b.fetcher }).urlInfo(SITE, PAGE)
      expect(r, offset).toEqual({ ok: true, value: { lastCrawled: new Date(MS).toISOString(), status: 200 } })
    }
  })

  // "Never crawled" comes back as .NET's DateTime.MinValue (year 1) or no date; a status of 0 is
  // "no answer recorded". Both are null, never a date or a status nobody saw.
  it('is null for a page Bing never crawled, or a date that isn’t one', async () => {
    for (const LastCrawledDate of ['/Date(-62135596800000)/', '/Date(-62135568000000-0800)/', '/Date(0)/', 'yesterday', '/Date(abc)/', null, 1316156400000, `/Date(${MS})/ trailing`]) {
      for (const HttpStatus of [0, null, 'x', 1000, 200.5]) {
        const b = fakeBing(() => json({ d: { HttpStatus, LastCrawledDate } }))
        expect(await bingClient(KEY, { fetcher: b.fetcher }).urlInfo(SITE, PAGE), `${String(LastCrawledDate)} ${String(HttpStatus)}`).toEqual({ ok: true, value: { lastCrawled: null, status: null } })
      }
    }
  })

  // No url info at all is a failure, not "never crawled".
  it('says bing_urlinfo when Bing sends no url info', async () => {
    for (const body of [{ d: null }, { d: 'x' }, {}]) {
      const b = fakeBing(() => json(body))
      expect(await bingClient(KEY, { fetcher: b.fetcher }).urlInfo(SITE, PAGE), JSON.stringify(body)).toMatchObject({ ok: false, reason: 'bing_urlinfo' })
    }
  })

  // Refusals: a page not on the site is bing_urlinfo, a refused key bing_auth; the key never rides along.
  it('says bing_urlinfo or bing_auth when Bing refuses, and never carries the key', async () => {
    const bad = fakeBing(() => json({ ErrorCode: 7, Message: `InvalidUrl for ${API}GetUrlInfo?apikey=${KEY}` }, 400))
    const r = await bingClient(KEY, { fetcher: bad.fetcher }).urlInfo(SITE, PAGE)
    expect(r).toMatchObject({ ok: false, reason: 'bing_urlinfo', status: 400 })
    noKey(r)
    const auth = fakeBing(() => json({ Message: `bad key ${KEY}` }, 401))
    const a = await bingClient(KEY, { fetcher: auth.fetcher }).urlInfo(SITE, PAGE)
    expect(a).toMatchObject({ ok: false, reason: 'bing_auth' })
    noKey(a)
  })
})
