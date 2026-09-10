/**
 * auditLiveSite — the SEO / GEO page's "Run check". A fake fetch serves a site; every
 * rule is listed pass or fail, the graph is counted, the sitemap and robots are read.
 */
import { describe, expect, it } from 'vitest'
import { AUDIT_RULES, auditLiveSite } from '@/lib/seo-audit'

const HOME = `<html><head>
<meta name="description" content="Meet Skeen, a Chicago DJ, producer and filmmaker making house and techno for dark rooms.">
<link rel="canonical" href="https://www.example.com">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"MusicGroup","name":"Skeen","url":"https://www.example.com/","genre":"House","foundingLocation":{"@type":"Place","name":"Chicago"}},{"@type":"MusicEvent","name":"X","startDate":"2026-09-01"}]}</script>
</head><body><section id="home"><h1>Skeen</h1></section><section id="shows"><h2>Tour</h2><img src="https://cdn/x.jpg" alt="Skeen"></section></body></html>`
const EDIT = `<html><head><meta name="robots" content="noindex"></head></html>`
const SITEMAP = `<urlset><url><loc>https://www.example.com/</loc><lastmod>2026-08-22T00:00:00.000Z</lastmod></url><url><loc>https://www.example.com/about</loc></url></urlset>`
const ROBOTS = `User-agent: *\nAllow: /\nSitemap: https://www.example.com/sitemap.xml`
/** The bio as the MANAGER typed it — with the apostrophe a real bio has. */
const BIO = "My name is Skeen and I've made house music in Chicago since 2014."
/** The same bio as REACT renders it: the apostrophe leaves as an html entity. */
const ABOUT = `<html><body><main><p>My name is Skeen and I&#x27;ve made house music in Chicago since 2014.</p></main></body></html>`

/** A page is html (200), null (404), or a spelled-out response: `{ status, body, location }`. */
type Page = string | null | { status: number; body?: string; location?: string }
type FakeFetch = typeof fetch & { calls: string[] }

function fakeFetch(pages: Record<string, Page>): FakeFetch {
  const calls: string[] = []
  const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const key = String(url)
    calls.push(key)
    const page = pages[key]
    if (page == null || typeof page === 'string') {
      const body = page ?? null
      return { ok: body != null, status: body != null ? 200 : 404, headers: new Headers(), text: async () => body ?? '' } as Response
    }
    // A real client FOLLOWS a redirect unless told not to, and it follows it wherever it
    // points — that is precisely why the caller has to ask for `manual` and walk the
    // chain itself. The fake obeys the option so that dropping it fails a test.
    if (page.status >= 300 && page.status < 400 && page.location && init?.redirect !== 'manual') {
      return impl(new URL(page.location, key).toString(), init)
    }
    return {
      ok: page.status >= 200 && page.status < 300,
      status: page.status,
      headers: new Headers(page.location ? { location: page.location } : {}),
      text: async () => page.body ?? '',
    } as Response
  }
  return Object.assign(impl as unknown as typeof fetch, { calls })
}

describe('auditLiveSite', () => {
  it('CRITICAL: lists EVERY rule, pass or fail, and surfaces a fact-sheet field Google requires', async () => {
    const r = await auditLiveSite('https://www.example.com/', fakeFetch({
      'https://www.example.com/': HOME,
      'https://www.example.com/edit': EDIT,
      'https://www.example.com/sitemap.xml': SITEMAP,
      'https://www.example.com/robots.txt': ROBOTS,
    }))
    expect(r.url).toBe('https://www.example.com')
    // Derived from the registry; 'other' shows only when an unknown rule fired.
    expect(r.rules.map((x) => x.rule)).toEqual(AUDIT_RULES.map((x) => x.rule).filter((x) => x !== 'other'))
    expect(r.ok).toBe(false)
    expect(r.rules.find((x) => x.rule === 'facts')!.problems).toEqual(['MusicEvent #2 is missing location'])
    expect(r.rules.filter((x) => x.rule !== 'facts').every((x) => x.problems.length === 0)).toBe(true)
    expect(r.graph).toEqual({ MusicGroup: 1, MusicEvent: 1 })
    expect(r.sitemap).toEqual({ urls: ['https://www.example.com/', 'https://www.example.com/about'], lastmod: '2026-08-22T00:00:00.000Z' })
    expect(r.robots).toEqual({ ok: true, sitemap: true })
  })
  it('CRITICAL (GEO): the bio must be VISIBLE on the homepage or a sitemap page, and the artist node must state genre + location', async () => {
    const pages = {
      'https://www.example.com/': HOME,
      'https://www.example.com/edit': EDIT,
      'https://www.example.com/sitemap.xml': SITEMAP,
      'https://www.example.com/robots.txt': ROBOTS,
      'https://www.example.com/about': ABOUT,
    }
    const seen = await auditLiveSite('https://www.example.com', fakeFetch(pages), { bio: BIO })
    expect(seen.rules.find((x) => x.rule === 'bio-visible')!.problems).toEqual([])
    expect(seen.rules.find((x) => x.rule === 'facts-geo')!.problems).toEqual([])
    const hidden = await auditLiveSite('https://www.example.com', fakeFetch(pages), { bio: 'A completely different bio nobody rendered.' })
    expect(hidden.rules.find((x) => x.rule === 'bio-visible')!.problems.length).toBe(1)
    expect(hidden.ok).toBe(false)
    const noFacts = await auditLiveSite('https://www.example.com', fakeFetch({ ...pages, 'https://www.example.com/': HOME.replace(',"genre":"House","foundingLocation":{"@type":"Place","name":"Chicago"}', '') }))
    expect(noFacts.rules.find((x) => x.rule === 'facts-geo')!.problems.length).toBe(2)
  })

  it('an unreachable site is an error, not a pass', async () => {
    const r = await auditLiveSite('https://down.example.com', fakeFetch({}))
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    expect(r.rules).toEqual([])
  })

  it('CRITICAL (GEO): the bio matches through HTML ENTITIES — an apostrophe is &#x27; on the page', async () => {
    // React escapes `'` to `&#x27;`. Stripping entities to a SPACE while matching the raw
    // bio meant every bio with an apostrophe (most of them) read as invisible on a page
    // rendering it in full — the check told managers to fix a page that was already right.
    const pages: Record<string, Page> = {
      'https://www.example.com/': HOME,
      'https://www.example.com/edit': EDIT,
      'https://www.example.com/sitemap.xml': SITEMAP,
      'https://www.example.com/robots.txt': ROBOTS,
      'https://www.example.com/about': ABOUT,
    }
    const r = await auditLiveSite('https://www.example.com', fakeFetch(pages), { bio: BIO })
    expect(r.rules.find((x) => x.rule === 'bio-visible')!.problems).toEqual([])
    // …and the rule can still FAIL: a bio nobody rendered is still reported.
    const hidden = await auditLiveSite('https://www.example.com', fakeFetch(pages), { bio: "Someone else's bio entirely." })
    expect(hidden.rules.find((x) => x.rule === 'bio-visible')!.problems.length).toBe(1)
  })

  it('CRITICAL: a /edit nobody could LOOK at is reported, not passed; a site with no /edit is fine', async () => {
    const base = {
      'https://www.example.com/': HOME,
      'https://www.example.com/sitemap.xml': SITEMAP,
      'https://www.example.com/robots.txt': ROBOTS,
    }
    const throttled = await auditLiveSite('https://www.example.com', fakeFetch({ ...base, 'https://www.example.com/edit': { status: 429 } }))
    expect(throttled.rules.find((x) => x.rule === 'robots')!.problems).toEqual(['could not check whether /edit is noindex (HTTP 429)'])
    expect(throttled.ok).toBe(false)
    // 404 is an ANSWER: there is no /edit page to be indexed. Not a problem.
    const none = await auditLiveSite('https://www.example.com', fakeFetch({ ...base, 'https://www.example.com/edit': null }))
    expect(none.rules.find((x) => x.rule === 'robots')!.problems).toEqual([])
  })
})

/**
 * SSRF. `custom_site_url` is manager-typed free text and this function is the only place
 * the SERVER fetches it, so the fetch boundary is the door. It is not a blind SSRF either:
 * `tag.slice(0, 80)` and `sitemap.urls` carry fragments of the response back to the browser.
 */
describe('auditLiveSite — what the server is allowed to fetch', () => {
  const PRIVATE = [
    'http://169.254.169.254/', // AWS/GCP metadata — the reason this test exists
    'http://2852039166/', // the same address in decimal; WHATWG normalises it
    'http://127.0.0.1/',
    'http://localhost:3000/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.9/',
    'http://[::1]/',
    'http://[fd00::1]/', // unique-local
    'http://[fe80::1]/', // link-local
    'http://metadata.google.internal/',
    'http://intranet/', // single label: never a public site
    'https://www.example.com:8080/', // a public host on a non-standard port
  ]

  it('CRITICAL: a private / loopback / link-local target is refused BEFORE any request', async () => {
    for (const origin of PRIVATE) {
      // WITNESS: the target ANSWERS. Every one of these serves a full, valid site, so the
      // audit would sail through and hand the body back if the guard were not there.
      const f = fakeFetch({
        [origin]: HOME,
        [`${origin.replace(/\/$/, '')}/`]: HOME,
        [`${origin.replace(/\/$/, '')}/edit`]: EDIT,
        [`${origin.replace(/\/$/, '')}/sitemap.xml`]: SITEMAP,
        [`${origin.replace(/\/$/, '')}/robots.txt`]: ROBOTS,
      })
      const r = await auditLiveSite(origin, f)
      expect(r.error, origin).toBe('That address is not a public website.')
      expect(r.ok, origin).toBe(false)
      expect(r.rules, origin).toEqual([])
      expect(f.calls, origin).toEqual([]) // not "it failed" — the request was never MADE
    }
  })

  it('CRITICAL: sitemap <loc> URLs are fetched only when SAME-ORIGIN', async () => {
    const INTERNAL = 'http://169.254.169.254/latest/meta-data/iam/'
    const OFF = 'https://evil.example/collect'
    const sitemap = `<urlset><url><loc>https://www.example.com/</loc></url><url><loc>${INTERNAL}</loc></url><url><loc>${OFF}</loc></url><url><loc>https://www.example.com/about</loc></url></urlset>`
    // WITNESS: the bio lives ONLY on the two off-origin pages. If either is fetched the
    // bio-visible rule passes — which is exactly how their contents reach the browser.
    const f = fakeFetch({
      'https://www.example.com/': HOME,
      'https://www.example.com/edit': EDIT,
      'https://www.example.com/sitemap.xml': sitemap,
      'https://www.example.com/robots.txt': ROBOTS,
      'https://www.example.com/about': '<html><body><p>Shows and photos.</p></body></html>',
      [INTERNAL]: ABOUT,
      [OFF]: ABOUT,
    })
    const r = await auditLiveSite('https://www.example.com', f, { bio: BIO })
    expect(f.calls).not.toContain(INTERNAL)
    expect(f.calls).not.toContain(OFF)
    expect(f.calls).toContain('https://www.example.com/about') // same-origin pages still are
    expect(r.rules.find((x) => x.rule === 'bio-visible')!.problems.length).toBe(1)
  })

  it('CRITICAL: a redirect from a public host into a private one is not followed', async () => {
    const INTERNAL = 'http://169.254.169.254/'
    const f = fakeFetch({
      'https://www.example.com/': { status: 302, location: INTERNAL },
      'https://www.example.com/edit': EDIT,
      'https://www.example.com/sitemap.xml': SITEMAP,
      'https://www.example.com/robots.txt': ROBOTS,
      [INTERNAL]: HOME,
    })
    const r = await auditLiveSite('https://www.example.com', f)
    expect(f.calls).not.toContain(INTERNAL)
    expect(r.error).toBe('Could not fetch the site.')
  })

  it('an ordinary redirect between PUBLIC hosts is still followed (apex → www)', async () => {
    const f = fakeFetch({
      'https://example.com/': { status: 308, location: 'https://www.example.com/' },
      'https://www.example.com/': HOME,
      'https://example.com/edit': EDIT,
      'https://example.com/sitemap.xml': SITEMAP,
      'https://example.com/robots.txt': ROBOTS,
    })
    const r = await auditLiveSite('https://example.com', f)
    expect(r.error).toBeUndefined()
    expect(f.calls).toContain('https://www.example.com/')
  })
})
