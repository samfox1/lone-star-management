// After a Publish, tell IndexNow which pages changed: once, only for a real site that serves its key.
/**
 * The IndexNow ping (AI_VISIBILITY_AUDIT finding 1.4): `pingIndexNow` in src/lib/indexnow.ts.
 *
 * STRICT (AGENTS.md "Test depth"): it is an OUTBOUND call on a manager's say-so, to a
 * third party that can flag a host that pings badly (429 = "potential spam"), and it
 * fetches a manager-typed address from this server first. Every "don't ping" condition
 * below asserts that NOTHING reached api.indexnow.org, not just that a flag came back.
 *
 * No real network: `fetch` is a stub that answers from a table, and records every call.
 */
import { describe, expect, it } from 'vitest'
import { INDEXNOW_KEY_PATH, INDEXNOW_VERSION_HEADER, isIndexNowKey } from '@samfox1/site-bridge/indexnow'
import { INDEXNOW_ENDPOINT, MAX_PING_URLS, indexNowOrigin, newIndexNowKey, pingIndexNow } from '@/lib/indexnow'
import { bridgeSupportsIndexNow } from '@/lib/site-editor/manifest'

const KEY = '0123456789abcdef0123456789abcdef'
const ORIGIN = 'https://www.skeenmusic.com'
const SITE = { site_kind: 'custom', custom_site_url: `${ORIGIN}/` }

type Answer = Response | (() => Response) | 'throw'
type Seen = { url: string; init?: RequestInit }

/** A fetch that answers from `table` (by exact url) and records every request. Anything not
 *  in the table is a 404, so a test only lists what the site actually has. */
function stubFetch(table: Record<string, Answer>) {
  const seen: Seen[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, init })
    const a = table[url]
    if (a === 'throw') throw new TypeError('fetch failed')
    if (a) return typeof a === 'function' ? a() : a.clone()
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  const pings = () => seen.filter((s) => s.url === INDEXNOW_ENDPOINT)
  return { fetcher, seen, pings }
}

// The key file as a text file usually is: ending in a newline, which still matches the key.
const keyFile = (body = `${KEY}\n`, version: string | null = '0.42.0', status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...(version ? { [INDEXNOW_VERSION_HEADER]: version } : {}) },
  })
const sitemap = (...locs: string[]) =>
  new Response(`<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`, { status: 200 })
const redirect = (to: string) => new Response(null, { status: 308, headers: { location: to } })

/** The live-site world: key file served, a three-page sitemap, IndexNow says 200. */
function happy(overrides: Record<string, Answer> = {}) {
  return stubFetch({
    [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: keyFile(),
    [`${ORIGIN}/sitemap.xml`]: sitemap(ORIGIN, `${ORIGIN}/about`, `${ORIGIN}/music`),
    [INDEXNOW_ENDPOINT]: new Response(null, { status: 200 }),
    ...overrides,
  })
}

describe('newIndexNowKey', () => {
  it('makes a valid IndexNow key: 32 lowercase hex', () => {
    const k = newIndexNowKey()
    expect(isIndexNowKey(k)).toBe(true)
    expect(k).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is random: two keys differ', () => {
    expect(newIndexNowKey()).not.toBe(newIndexNowKey())
  })
})

describe('bridgeSupportsIndexNow: the key-file route arrived in 0.42.0', () => {
  it('yes from 0.42.0 up', () => {
    for (const v of ['0.42.0', '0.42.1', '0.43.0', '1.0.0']) expect(bridgeSupportsIndexNow(v), v).toBe(true)
  })

  it('no below it, and no when the site says nothing or garbage', () => {
    for (const v of ['0.41.9', '0.32.0', undefined, '', 'latest', 'v0.42.0', '0.42.0-beta']) {
      expect(bridgeSupportsIndexNow(v as string | undefined), String(v)).toBe(false)
    }
  })
})

describe('indexNowOrigin: only a real, public, production custom site', () => {
  it('the custom site origin, path dropped', () => {
    expect(indexNowOrigin(SITE)).toBe(ORIGIN)
    expect(indexNowOrigin({ site_kind: 'custom', custom_site_url: `${ORIGIN}/some/page?x=1` })).toBe(ORIGIN)
  })

  it('CRITICAL: never a template site, a missing URL, a private host, a preview, or plain http', () => {
    const cases: [string, { site_kind?: string | null; custom_site_url?: string | null } | null][] = [
      ['no row', null],
      ['template site', { site_kind: 'template', custom_site_url: `${ORIGIN}/` }],
      ['no url', { site_kind: 'custom', custom_site_url: null }],
      ['blank url', { site_kind: 'custom', custom_site_url: '  ' }],
      // The dev hatch (allowLoopback) must not apply here: FTBK's live value is this.
      ['localhost', { site_kind: 'custom', custom_site_url: 'http://localhost:3004' }],
      ['https localhost', { site_kind: 'custom', custom_site_url: 'https://localhost' }],
      ['loopback ip', { site_kind: 'custom', custom_site_url: 'https://127.0.0.1' }],
      ['private ip', { site_kind: 'custom', custom_site_url: 'https://10.0.0.5' }],
      ['metadata ip', { site_kind: 'custom', custom_site_url: 'https://169.254.169.254' }],
      ['vercel preview', { site_kind: 'custom', custom_site_url: 'https://wren-site-theta.vercel.app' }],
      ['vercel branch preview', { site_kind: 'custom', custom_site_url: 'https://skeen-website-git-dev-sam.vercel.app/' }],
      ['plain http', { site_kind: 'custom', custom_site_url: 'http://www.skeenmusic.com' }],
      ['not a url', { site_kind: 'custom', custom_site_url: 'skeenmusic.com' }],
      ['javascript', { site_kind: 'custom', custom_site_url: 'javascript:alert(1)' }],
    ]
    for (const [name, row] of cases) expect(indexNowOrigin(row), name).toBeNull()
  })
})

describe('pingIndexNow: the ping', () => {
  it('CRITICAL: posts the host, key, keyLocation and the sitemap pages to api.indexnow.org, once', async () => {
    const w = happy()
    const out = await pingIndexNow(SITE, KEY, w.fetcher)
    expect(out).toEqual({ sent: true, status: 200, urlList: [ORIGIN, `${ORIGIN}/about`, `${ORIGIN}/music`] })
    expect(w.pings()).toHaveLength(1)
    const { init } = w.pings()[0]
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json; charset=utf-8')
    expect(JSON.parse(String(init?.body))).toEqual({
      host: 'www.skeenmusic.com',
      key: KEY,
      keyLocation: `${ORIGIN}${INDEXNOW_KEY_PATH}`,
      urlList: [ORIGIN, `${ORIGIN}/about`, `${ORIGIN}/music`],
    })
  })

  it('does not wait forever on IndexNow: the POST carries a timeout signal', async () => {
    const w = happy()
    await pingIndexNow(SITE, KEY, w.fetcher)
    expect(w.pings()[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('202 (key validation pending) is a success too', async () => {
    const w = happy({ [INDEXNOW_ENDPOINT]: new Response(null, { status: 202 }) })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toMatchObject({ sent: true, status: 202 })
  })

  it('names only this site\'s own pages: another host in the sitemap is dropped, entities decoded, repeats once', async () => {
    const w = happy({
      [`${ORIGIN}/sitemap.xml`]: sitemap(
        ORIGIN,
        'https://evil.example/phish',
        'http://www.skeenmusic.com/insecure', // other scheme = other origin
        `${ORIGIN}/music?a=1&amp;b=2`,
        `${ORIGIN}/about`,
        `${ORIGIN}/about`,
        'not a url',
      ),
    })
    const out = await pingIndexNow(SITE, KEY, w.fetcher)
    expect(out).toMatchObject({ sent: true, urlList: [ORIGIN, `${ORIGIN}/music?a=1&b=2`, `${ORIGIN}/about`] })
    // The sitemap's <loc>s are named, never fetched: only the key file, the sitemap and the POST left.
    expect(w.seen.map((s) => s.url).sort()).toEqual([INDEXNOW_ENDPOINT, `${ORIGIN}${INDEXNOW_KEY_PATH}`, `${ORIGIN}/sitemap.xml`].sort())
  })

  it(`caps the list at ${MAX_PING_URLS} pages`, async () => {
    const many = Array.from({ length: MAX_PING_URLS + 50 }, (_, i) => `${ORIGIN}/p${i}`)
    const w = happy({ [`${ORIGIN}/sitemap.xml`]: sitemap(...many) })
    const out = await pingIndexNow(SITE, KEY, w.fetcher)
    expect(out.sent && out.urlList).toEqual(many.slice(0, MAX_PING_URLS))
  })

  it('no sitemap: the homepage alone', async () => {
    const w = happy({ [`${ORIGIN}/sitemap.xml`]: new Response('nope', { status: 404 }) })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toMatchObject({ sent: true, urlList: [`${ORIGIN}/`] })
  })

  it('follows the site to its real host (apex → www) and pings for THAT host', async () => {
    const APEX = 'https://skeenmusic.com'
    const w = happy({ [`${APEX}${INDEXNOW_KEY_PATH}`]: redirect(`${ORIGIN}${INDEXNOW_KEY_PATH}`) })
    const out = await pingIndexNow({ site_kind: 'custom', custom_site_url: APEX }, KEY, w.fetcher)
    expect(out).toMatchObject({ sent: true })
    const body = JSON.parse(String(w.pings()[0].init?.body))
    expect(body.host).toBe('www.skeenmusic.com')
    expect(body.keyLocation).toBe(`${ORIGIN}${INDEXNOW_KEY_PATH}`)
  })
})

describe("pingIndexNow: every reason NOT to ping (nothing reaches IndexNow)", () => {
  it('CRITICAL: not a real production site: no request of any kind leaves', async () => {
    for (const custom_site_url of ['http://localhost:3004', 'https://169.254.169.254', 'https://wren-site-theta.vercel.app', 'http://www.skeenmusic.com']) {
      const w = happy()
      expect(await pingIndexNow({ site_kind: 'custom', custom_site_url }, KEY, w.fetcher), custom_site_url).toEqual({ sent: false, reason: 'no-site' })
      expect(w.seen, custom_site_url).toEqual([])
    }
    const w = happy()
    expect(await pingIndexNow({ ...SITE, site_kind: 'template' }, KEY, w.fetcher)).toEqual({ sent: false, reason: 'no-site' })
    expect(w.seen).toEqual([])
  })

  it('CRITICAL: no key, or not a valid one: no request of any kind leaves', async () => {
    for (const key of [null, undefined, '', 'short', `${KEY}\n`, 'has space in it']) {
      const w = happy()
      expect(await pingIndexNow(SITE, key, w.fetcher), String(key)).toEqual({ sent: false, reason: 'no-key' })
      expect(w.seen).toEqual([])
    }
  })

  it('CRITICAL: the site does not serve the key file (no route yet, or not deployed)', async () => {
    const w = happy({ [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: new Response('not found', { status: 404 }) })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toEqual({ sent: false, reason: 'key-not-served' })
    expect(w.pings()).toEqual([])
  })

  it('CRITICAL: the site serves a DIFFERENT key (the new one is not live yet): IndexNow would answer 403', async () => {
    const w = happy({ [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: keyFile('ffffffffffffffffffffffffffffffff') })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toEqual({ sent: false, reason: 'key-not-served' })
    expect(w.pings()).toEqual([])
  })

  it('the key file cannot be reached at all', async () => {
    const w = happy({ [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: 'throw' })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toEqual({ sent: false, reason: 'key-not-served' })
    expect(w.pings()).toEqual([])
  })

  it('CRITICAL: the site does not report bridge 0.42.0 or later', async () => {
    for (const version of [null, '0.41.9', 'garbage']) {
      const w = happy({ [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: keyFile(KEY, version) })
      expect(await pingIndexNow(SITE, KEY, w.fetcher), String(version)).toEqual({ sent: false, reason: 'old-bridge' })
      expect(w.pings()).toEqual([])
    }
  })

  it('the key file redirects to another path: a key file vouches only for its own directory', async () => {
    const w = happy({ [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: redirect(`${ORIGIN}/keys/indexnow.txt`), [`${ORIGIN}/keys/indexnow.txt`]: keyFile() })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toEqual({ sent: false, reason: 'key-not-served' })
    expect(w.pings()).toEqual([])
  })

  it('the key file redirects to a preview host or a private address: refused, and the private one is never fetched', async () => {
    const PREVIEW = 'https://skeen-website.vercel.app'
    const w1 = happy({ [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: redirect(`${PREVIEW}${INDEXNOW_KEY_PATH}`), [`${PREVIEW}${INDEXNOW_KEY_PATH}`]: keyFile() })
    expect((await pingIndexNow(SITE, KEY, w1.fetcher)).sent).toBe(false)
    expect(w1.pings()).toEqual([])

    const w2 = happy({ [`${ORIGIN}${INDEXNOW_KEY_PATH}`]: redirect('http://169.254.169.254/indexnow.txt') })
    expect((await pingIndexNow(SITE, KEY, w2.fetcher)).sent).toBe(false)
    expect(w2.seen.map((s) => s.url)).not.toContain('http://169.254.169.254/indexnow.txt')
    expect(w2.pings()).toEqual([])
  })
})

describe('pingIndexNow: a failed ping is reported, never thrown', () => {
  it.each([400, 403, 422, 429, 500])('IndexNow answers %i: not sent, status kept, no throw', async (status) => {
    const w = happy({ [INDEXNOW_ENDPOINT]: new Response(null, { status }) })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toEqual({ sent: false, reason: 'rejected', status })
    expect(w.pings()).toHaveLength(1) // tried once, never retried
  })

  it('the POST itself throws (network, timeout): not sent, no throw', async () => {
    const w = happy({ [INDEXNOW_ENDPOINT]: 'throw' })
    expect(await pingIndexNow(SITE, KEY, w.fetcher)).toEqual({ sent: false, reason: 'network' })
  })

  it('a fetch that throws on every call still resolves', async () => {
    const fetcher = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    await expect(pingIndexNow(SITE, KEY, fetcher)).resolves.toMatchObject({ sent: false })
  })
})
