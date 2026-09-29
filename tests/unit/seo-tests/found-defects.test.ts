/**
 * The defects an independent verifier found in the ten "Can be found" tests (2026-09-29,
 * scratchpad verify-found.md), one block per defect id, each turned into a test that was seen
 * RED before its fix. The verifier's repro sites, rebuilt as evidence. STRICT (types.ts
 * honesty rules): each asserts the STATUS and the words a manager reads, not only one of them.
 */
import { describe, expect, it } from 'vitest'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoPageFetch, SeoTestResult } from '@/lib/seo-tests/types'
import { ABOUT, HOME, KNOWN, O, SITEMAP_OK, doc, evidence, type Fixture } from '@tests/unit/seo-tests/found-fixtures'

type Id = keyof typeof FOUND_TESTS
const BOT_TESTS = ['google', 'bing', 'chatgpt', 'claude', 'perplexity', 'others'] as const
const NO_SCRIPT_TESTS = ['chatgpt', 'claude', 'perplexity', 'others'] as const
const run = (id: Id, f?: Fixture): SeoTestResult => FOUND_TESTS[id](evidence(f))
const ev = (r: SeoTestResult) => r.evidence.map((x) => `${x.label}: ${x.value}`).join('\n')
const AI_KEYS = ['oai-searchbot', 'chatgpt-user', 'gptbot', 'claudebot', 'claude-searchbot', 'claude-user', 'perplexitybot', 'perplexity-user', 'ccbot']
const forBots = (keys: string[], over: Record<string, Partial<SeoPageFetch>>) => Object.fromEntries(keys.map((k) => [k, over]))
const pub = KNOWN.published!
const known = (over: Partial<typeof pub> = {}) => ({ ...KNOWN, published: { ...pub, ...over } })

describe('F9: a normal page is not a security wall', () => {
  const CONTACT = doc('Contact Skeen', '<nav><a href="/">Home</a> <a href="/about">About</a></nav><main><h1>Contact Skeen</h1><p>For booking and press, write to us.</p><form><div class="g-recaptcha" data-sitekey="6Lc"></div><button>Send</button></form></main><script src="https://www.google.com/recaptcha/api.js" async defer></script>', `<link rel="canonical" href="${O}/contact">`)
  const imperva = (h: string) => h.replace('</body>', '<script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e&ns=1&cb=1234" async></script></body>')
  const datadome = (h: string) => h.replace('</head>', '<script>window.ddjskey="ABC"</script><script src="https://ct.captcha-delivery.com/c.js" async></script></head>')
  const cases: [string, Fixture][] = [
    ['a short page with a reCAPTCHA form', { pages: { '/': HOME, '/about': ABOUT, '/contact': CONTACT }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`, `${O}/about`, `${O}/contact`], lastmods: ['2026-09-20', '2026-09-20', '2026-09-20'], total: 3 } }],
    ['Imperva\'s script on normal pages', { pages: { '/': imperva(HOME), '/about': imperva(ABOUT) } }],
    ['DataDome\'s tag on normal pages', { pages: { '/': datadome(HOME), '/about': datadome(ABOUT) } }],
  ]
  for (const [name, f] of cases) {
    it(`${name}: every test that reads pages passes`, () => {
      for (const id of [...BOT_TESTS, 'allowed', 'list', 'words'] as Id[]) expect([id, run(id, f).status, run(id, f).sentence]).toEqual([id, 'pass', expect.any(String)])
    })
  }
  it('medium.com: a short home page loading reCAPTCHA, AI bot names 403 → the AI tests FAIL (not "couldn’t check"), Google passes', () => {
    const home = doc('Medium', '<main><h1>Skeen</h1><p>Human stories and ideas. A place to read, write, and deepen your understanding.</p><a href="/signin">Sign in</a></main><script src="https://www.google.com/recaptcha/enterprise.js"></script>')
    const f: Fixture = { pages: { '/': home }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`] }, bots: forBots(AI_KEYS, { '/': { status: 403, html: null, headers: { server: 'cloudflare' } } }) }
    for (const id of ['chatgpt', 'claude', 'perplexity'] as Id[]) expect([id, run(id, f).status]).toEqual([id, 'fail'])
    expect(run('google', f).status).toBe('pass')
    expect(run('allowed', f).status).toBe('pass')
  })
  it('a vendor mark on an ERROR page still names the vendor', () => {
    const blocked = '<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>'
    const r = run('chatgpt', { bots: { 'oai-searchbot': { '/': { status: 403, html: null, headers: { 'content-type': 'text/html' } } } } })
    expect(r.status).toBe('fail')
    void blocked
  })
})

describe('F1: a bot handed a 200 that is not a web page does not pass', () => {
  const variants: [string, Partial<SeoPageFetch>][] = [
    ['text/plain "Access denied"', { status: 200, html: null, headers: { 'content-type': 'text/plain' } }],
    ['application/json', { status: 200, html: null, headers: { 'content-type': 'application/json' } }],
    ['an empty html body', { status: 200, html: '', headers: { 'content-type': 'text/html' } }],
    ['204 No Content', { status: 204, html: null, headers: {} }],
  ]
  for (const [name, visit] of variants) {
    it(`${name} → every bot test fails, saying it isn't a web page`, () => {
      for (const test of BOT_TESTS) {
        const r = run(test, { allBots: { '/': visit } })
        expect([test, r.status]).toEqual([test, 'fail'])
        expect(r.sentence).toMatch(/isn’t a web page|almost no words/)
      }
    })
  }
  it('the same non-page for people and bots (a PDF on the list) is not a bot problem', () => {
    const pdf = { status: 200, html: null, headers: { 'content-type': 'application/pdf' } }
    expect(run('google', { plain: { '/about': pdf }, allBots: { '/about': pdf } }).status).toBe('pass')
  })
})

describe('F2: a page that is not the artist\'s site is not a pass', () => {
  const PAD = 'This request could not be completed because the security policy for this website does not allow automated traffic from your network at this time. If you believe this is a mistake please contact the site owner and include the reference number shown below. '
  const DENIED = doc('Access denied', `<main><h1>Access denied</h1><p>${PAD.repeat(2)}</p><p>Reference 18.4f5e3b17</p></main>`)
  const PARKED = doc('coming soon', `<main><h1>This domain is parked</h1><p>${'Buy this domain today. Great names make great businesses and this one could be yours. '.repeat(6)}</p></main>`)
  it('an unmarked "Access denied" page for everyone → couldn\'t check, everywhere', () => {
    const f = { pages: { '/': DENIED, '/about': DENIED } }
    for (const id of [...BOT_TESTS, 'allowed', 'list', 'words'] as Id[]) expect([id, run(id, f).status]).toEqual([id, 'unknown'])
  })
  it('a parked / coming-soon page without the artist\'s name → couldn\'t check, and says why', () => {
    const r = run('google', { pages: { '/': PARKED, '/about': PARKED } })
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/“Skeen”/)
  })
  it('an unmarked "Verify you are human" page for bots only → fail, read as a security check', () => {
    const HUMAN = doc('Verify you are human', `<main><h1>Verify you are human</h1><p>Press and hold the button to continue.</p><p>${PAD}</p></main>`)
    expect(run('chatgpt', { allBots: { '/': { html: HUMAN } } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/security check/) })
  })
})

describe('F3: a page with almost no words is empty to a reader, whatever the reason', () => {
  const INLINE = doc('Skeen', '<div id="root"></div><script type="module">import("/assets/index-abc.js").then(m=>m.mount(document.getElementById("root")))</script>')
  const BLANK = doc('Skeen', '')
  it('an inline-script app fails the bots that run no scripts, not Google or Bing', () => {
    const f = { pages: { '/': INLINE, '/about': INLINE } }
    for (const t of NO_SCRIPT_TESTS) expect([t, run(t, f).status]).toEqual([t, 'fail'])
    for (const t of ['google', 'bing'] as const) expect([t, run(t, f).status]).toEqual([t, 'pass'])
  })
  it('a blank page with no scripts has nothing for anyone to read → every bot test fails', () => {
    for (const t of BOT_TESTS) expect([t, run(t, { pages: { '/': BLANK, '/about': ABOUT } }).status]).toEqual([t, 'fail'])
  })
})

describe('F4 + F5: the bot must get the artist\'s words that a person gets', () => {
  it('an app shell (menu + footer, ~30 words) with none of the artist\'s words fails the no-script bots', () => {
    const SHELL = doc('Skeen', '<nav><a href="/">Home</a> <a>About</a> <a>Music</a> <a>Shows</a> <a>Merch</a> <a>Contact</a></nav><div id="root"></div><footer>Copyright 2026 Skeen. All rights reserved. Site by a friend. Follow us on Instagram, Spotify, Apple Music, Bandcamp and YouTube. Privacy policy. Terms.</footer><script src="/app.js"></script>')
    const f = { pages: { '/': SHELL, '/about': SHELL } }
    for (const t of NO_SCRIPT_TESTS) expect([t, run(t, f).status]).toEqual([t, 'fail'])
    expect(run('google', f).status).toBe('pass')
  })
  it('bots get /about without the bio paragraph → every bot test fails', () => {
    const noBio = ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '')
    for (const t of BOT_TESTS) {
      const r = run(t, { allBots: { '/about': { html: noBio } } })
      expect([t, r.status]).toEqual([t, 'fail'])
      expect(r.sentence).toMatch(/without/)
    }
  })
  it('a bot copy with a third more words than people get (all the artist\'s words there too) is a different page', () => {
    const stuffed = ABOUT.replace('</main>', '<p>house techno dj producer chicago best dj booking club night party festival mix remix edit bootleg release</p></main>')
    const r = run('google', { bots: { googlebot: { '/about': { html: stuffed } } } })
    expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/different page/) })
  })
  it('bots get home with Music and Shows swapped for "Sign in to see music and shows." → fail', () => {
    const gated = HOME.replace(/<section id="music">[\s\S]*<\/section>/, '<p>Sign in to see music and shows.</p>')
    for (const t of BOT_TESTS) expect([t, run(t, { allBots: { '/': { html: gated } } }).status]).toEqual([t, 'fail'])
  })
})

describe('F6: sentence case and the "Almost" sentence', () => {
  it('a name at the start keeps its capital: "ChatGPT", never "chatGPT"', () => {
    const robots = { status: 200, body: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }
    const r = run('chatgpt', { robots })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost' })
    expect(r.sentence).not.toMatch(/\bchatGPT|\bgemini|\bclaude\b/)
    expect(r.sentence).toMatch(/^your site asks ChatGPT not to learn from it/)
  })
  it('"others": no "Gemini, Apple and Common Crawl search", and the value does not contradict "can still open"', () => {
    const robots = { status: 200, body: 'User-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }
    const r = run('others', { robots })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost' })
    expect(r.sentence).not.toMatch(/Crawl search/i)
    expect(r.value).not.toMatch(/^0 of/)
  })
  it('a training-only failure that is NOT a settings-file rule does not claim the rest "can open your pages"', () => {
    const r = run('others', { bots: { ccbot: { '/': { html: doc('Skeen', '<div id="root"></div><script src="/a.js"></script>') } } } })
    expect(r.status).toBe('fail')
    expect(r.sentence).not.toMatch(/search can open/)
  })
})

describe('F7: "search can open your pages" only when the search visitors really opened them', () => {
  it('GPTBot blocked, OAI-SearchBot and ChatGPT-User got no answer → no "search can still open" claim', () => {
    const robots = { status: 200, body: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }
    const silent = { '/': { status: null, html: null, error: 'timeout' }, '/about': { status: null, html: null, error: 'timeout' } }
    const r = run('chatgpt', { robots, bots: { 'oai-searchbot': silent, 'chatgpt-user': silent } })
    expect(r.sentence).not.toMatch(/can (still )?open/)
    expect(r.lead).toBeUndefined()
  })
  it('GPTBot blocked, OAI-SearchBot 403 → a plain fail about search, not "Almost"', () => {
    const robots = { status: 200, body: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }
    const r = run('chatgpt', { robots, bots: { 'oai-searchbot': { '/': { status: 403, html: null } } } })
    expect(r).toMatchObject({ status: 'fail' })
    expect(r.lead).toBeUndefined()
  })
})

describe('F8: a failure every Claude visitor shares is not "only the training bot"', () => {
  it('a soft 404 for all three Claude bots → plain fail', () => {
    const SOFT = doc('Page not found · Skeen', '<main><h1>Page not found</h1><p>Sorry.</p></main>')
    const r = run('claude', { pages: { '/': HOME, '/about': SOFT } })
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
    expect(r.sentence).not.toMatch(/learns/)
  })
})

describe('F10: a healthy page named like an error is not a missing page', () => {
  it('a song called "Not Found", a tour called "Area 404" → pass', () => {
    const SONG = doc('Not Found · Skeen', '<main><h1>Not Found</h1><p>The second single by Skeen. Recorded live in Chicago in the winter of 2023. Out now on every service.</p></main>')
    const TOUR = doc('Area 404 Tour · Skeen', '<main><h1>Area 404 Tour</h1><p>Skeen live. Oct 4 · Hideaway, Chicago. Doors at 7.</p></main>')
    for (const page of [SONG, TOUR]) {
      const f = { pages: { '/': HOME, '/x': page }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`, `${O}/x`] } }
      expect(run('google', f).status).toBe('pass')
      expect(run('list', f).status).toBe('pass')
    }
  })
  it('real not-found pages still fail: "404", "Page not found", Next.js\'s default', () => {
    for (const title of ['404', 'Page not found · Skeen', '404: This page could not be found.']) {
      expect([title, run('google', { pages: { '/': HOME, '/x': doc(title, `<h1>${title}</h1>`) } }).status]).toEqual([title, 'fail'])
    }
  })
})

describe('F11: a home page that redirects to /en is judged where it landed', () => {
  it('canonical /en on the /en page → allowed passes', () => {
    const en = HOME.replace(`<link rel="canonical" href="${O}/">`, `<link rel="canonical" href="${O}/en">`)
    // Everyone was sent on to /en: the person and every bot.
    expect(run('allowed', { pages: { '/': en, '/about': ABOUT }, plain: { '/': { finalUrl: `${O}/en` } }, allBots: { '/': { finalUrl: `${O}/en` } } }).status).toBe('pass')
  })
})

describe('theguardian.com: "/" redirects to "/us", which names "/" as its main address', () => {
  it('is the regional-edition pattern, not "list another page": allowed passes', () => {
    const us = { finalUrl: `${O}/us` }
    expect(run('allowed', { plain: { '/': us }, allBots: { '/': us } }).status).toBe('pass')
  })
})

describe('medium.com: Apple Intelligence blocked by a rule and Common Crawl by a refusal', () => {
  it('the "Almost" sentence does not contradict itself about Apple', () => {
    const robots = { status: 200, body: 'User-agent: Applebot-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }
    const r = run('others', { robots, bots: { ccbot: { '/': { status: 403, html: null }, '/about': { status: 403, html: null } } } })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost' })
    expect(r.sentence).toMatch(/Apple Intelligence/)
    expect(r.sentence).not.toMatch(/the Apple and/)
    // A refusal (403) is "turns away"; only a settings rule is "asks".
    expect(r.sentence).toMatch(/^your site turns away/)
  })
})

describe('F12: a person\'s visit refused on a listed page is "couldn’t check" in list, and noted by the bot tests', () => {
  it('list: plain 403 on a listed page → unknown, not a broken page', () => {
    expect(run('list', { plain: { '/': { status: 403, html: null } } }).status).toBe('unknown')
  })
  it('bot tests say the comparison with a person\'s visit was not made', () => {
    const r = run('google', { plain: { '/': { status: 403, html: null } } })
    expect(ev(r)).toMatch(/couldn’t compare/)
  })
})

describe('F13 + F14 + F22 + F25: list never blames what it could not read', () => {
  it('settings file unread (500, no answer) → no "doesn\'t point to it"', () => {
    for (const robots of [{ status: 500, body: null }, { status: null, body: null }]) {
      const r = run('list', { robots, sitemap: { ...SITEMAP_OK, namedInRobots: false } })
      expect(r.sentence).not.toMatch(/doesn’t point/)
    }
  })
  it('no settings file at all (404) → "Almost", saying there is no settings file', () => {
    expect(run('list', { robots: { status: 404, body: null }, sitemap: { ...SITEMAP_OK, namedInRobots: false } })).toMatchObject({ status: 'fail', lead: 'Almost', sentence: expect.stringMatching(/no settings file/) })
  })
  it('F14: a settings file that sends us to another site says so', () => {
    const r = run('google', { robots: { status: null, body: null, error: 'not-allowed: https://cdn.other-host.net/robots.txt' } })
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/cdn\.other-host\.net/)
  })
  it('F22: a server error on the list → couldn\'t check, not "no list"', () => {
    for (const status of [500, 502]) expect(run('list', { sitemap: { status, urls: [], lastmods: [], url: `${O}/sitemap.xml` } }).status).toBe('unknown')
  })
  it('F25: robots.txt names a list only on another site → couldn\'t check, naming it', () => {
    const r = run('list', { sitemap: { status: 404, urls: [], lastmods: [], url: `${O}/sitemap.xml`, namedElsewhere: ['https://cdn.sitemaps-host.net/sitemap.xml'] } })
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/cdn\.sitemaps-host\.net/)
  })
  it('F25: robots.txt names a list on another site while /sitemap.xml works → a note, not "doesn’t point to it"', () => {
    const r = run('list', { sitemap: { ...SITEMAP_OK, namedInRobots: false, namedElsewhere: ['https://cdn.sitemaps-host.net/s.xml'] } })
    expect(r.status).toBe('pass')
    expect(ev(r)).toMatch(/cdn\.sitemaps-host\.net/)
  })
  it('a listed page that asks not to be listed is noted', () => {
    const about = ABOUT.replace('<head>', '<head><meta name="robots" content="noindex">')
    expect(ev(run('list', { pages: { '/': HOME, '/about': about } }))).toMatch(/\/about on the list asks not to be listed/)
  })
  it('F25: relative entries are "not full addresses", not "other sites"', () => {
    const r = run('list', { sitemap: { ...SITEMAP_OK, urls: [], lastmods: [], total: 0, badLocs: { count: 2, examples: ['/', '/about'] } } })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/full web address/)
    expect(r.sentence).not.toMatch(/other sites/)
  })
  it('F25: http:// or bare-domain spellings are noted', () => {
    expect(ev(run('list', { sitemap: { ...SITEMAP_OK, otherSpelling: 2 } }))).toMatch(/spelled/)
  })
  it('F25: limits count what was really opened', () => {
    const r = run('list')
    expect(r.limits).toMatch(/2 pages/)
  })
})

describe('F15 + F16 + F17 + F18: reading "don\'t list me"', () => {
  it('F15: unavailable_after with a comma in a META tag, in the past → fail', () => {
    const page = HOME.replace('<head>', '<head><meta name="robots" content="unavailable_after: Wed, 01 Jan 2025 00:00:00 GMT">')
    for (const id of ['google', 'bing', 'chatgpt', 'allowed'] as Id[]) expect([id, run(id, { pages: { '/': page, '/about': ABOUT } }).status]).toEqual([id, 'fail'])
  })
  it('F16: "noindex nofollow" with a space → fail', () => {
    const page = HOME.replace('<head>', '<head><meta name="robots" content="noindex nofollow">')
    expect(run('allowed', { pages: { '/': page, '/about': ABOUT } }).status).toBe('fail')
  })
  it('F17: a page cut at the size cap is not claimed clean', () => {
    for (const id of ['google', 'allowed'] as Id[]) {
      expect([id, run(id, { plain: { '/about': { truncated: true } }, allBots: { '/about': { truncated: true } } }).status]).toEqual([id, 'unknown'])
    }
  })
  it('F17: a cut page is not judged on its words (a comment cut open would look blank)', () => {
    const cut = ABOUT.replace('<main>', '<main><!-- ').slice(0, ABOUT.indexOf('<main>') + 12)
    for (const id of ['google', 'chatgpt'] as Id[]) {
      const r = run(id, { plain: { '/about': { html: cut, truncated: true } }, allBots: { '/about': { html: cut, truncated: true } } })
      expect([id, r.status, r.sentence]).toEqual([id, 'unknown', expect.stringMatching(/over 1 MB/)])
    }
  })
  it('F17: a noindex in the part we read still fails a cut page', () => {
    const page = ABOUT.replace('<head>', '<head><meta name="robots" content="noindex">')
    expect(run('google', { allBots: { '/about': { html: page, truncated: true } }, plain: { '/about': { html: page, truncated: true } } }).status).toBe('fail')
  })
  it('F18: noindex on Googlebot\'s copy is blamed on Gemini, not Apple and Common Crawl', () => {
    const page = ABOUT.replace('<head>', '<head><meta name="googlebot" content="noindex">')
    const r = run('others', { bots: { googlebot: { '/about': { html: page } } } })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/Gemini/)
    expect(r.sentence).not.toMatch(/Apple|Common Crawl/)
  })
})

describe('a menu link to a page missing for everyone', () => {
  it('is a note in allowed, not "couldn’t check"', () => {
    const r = run('allowed', { plain: { '/about': { status: 404, html: null } }, allBots: { '/about': { status: 404, html: null } } })
    expect(r).toMatchObject({ status: 'pass', value: '1 page can be listed' })
    expect(ev(r)).toMatch(/\/about doesn’t open for anyone/)
  })
})

describe('F19: the canonical, read the way Google reads it', () => {
  it('a canonical shown only to Googlebot, to another site → fail', () => {
    const page = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '<link rel="canonical" href="https://other.example/about">')
    expect(run('allowed', { bots: { googlebot: { '/about': { html: page } } } }).status).toBe('fail')
  })
  it('a relative canonical resolves against <base href>', () => {
    const page = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '<base href="/en/"><link rel="canonical" href="about">')
    expect(run('allowed', { pages: { '/': HOME, '/about': page } })).toMatchObject({ status: 'fail', sentence: expect.stringContaining('/en/about') })
  })
  it('a canonical in the body is ignored (Google ignores it)', () => {
    const page = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '').replace('<main>', '<main><link rel="canonical" href="https://other.example/">')
    expect(run('allowed', { pages: { '/': HOME, '/about': page } }).status).toBe('pass')
  })
  it('two canonicals that disagree are noted (Google ignores both)', () => {
    const page = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, `<link rel="canonical" href="${O}/about"><link rel="canonical" href="https://other.example/about">`)
    const r = run('allowed', { pages: { '/': HOME, '/about': page } })
    expect(ev(r)).toMatch(/two different|ignores both/)
  })
  it('an http:// canonical on an https page is noted', () => {
    const page = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '<link rel="canonical" href="http://www.example.com/about">')
    expect(ev(run('allowed', { pages: { '/': HOME, '/about': page } }))).toMatch(/http:\/\//)
  })
  it('a home page that sends everyone to another site → allowed fails, naming it', () => {
    const away = { status: null, html: null, finalUrl: null, error: 'not-allowed: https://linktr.ee/skeen' }
    expect(run('allowed', { plain: { '/': away }, allBots: { '/': away } })).toMatchObject({ status: 'fail', sentence: expect.stringContaining('linktr.ee') })
  })
})

describe('F23 + F24: list says what it opened, and reads dates by the W3C rule', () => {
  it('the pass sentence says how many listed pages were opened', () => {
    const r = run('list', { sitemap: { ...SITEMAP_OK, urls: [...SITEMAP_OK.urls, `${O}/p3`], lastmods: ['2026-09-20', '2026-09-20', '2026-09-20'], total: 10 } })
    expect(r.sentence).toMatch(/opened 2 of the 10/)
  })
  it('a sitemap index read in part says so', () => {
    const r = run('list', { sitemap: { ...SITEMAP_OK, children: [{ url: `${O}/a.xml`, status: 200 }, { url: `${O}/b.xml`, status: 200 }, { url: `${O}/c.xml`, status: 200 }], childTotal: 5 } })
    expect(r.sentence).toMatch(/3 of its 5 lists/)
  })
  it('"2026-09" and "2026" are real dates; "2026-02-31" is not', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, lastmods: ['2026-09', '2026'] } }).status).toBe('pass')
    expect(run('list', { sitemap: { ...SITEMAP_OK, lastmods: ['2026-02-31', '2026-09-20'] } }).status).toBe('fail')
  })
  it('a text list (no dates possible) is not asked for dates', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, format: 'text', lastmods: [null, null] } }).status).toBe('pass')
  })
})

describe('F26: words never speaks for pages it did not open', () => {
  const noBio = ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '')
  it('no sitemap, the home page links to a page we did not open → couldn\'t check', () => {
    const home = HOME.replace('<a href="#music">Music</a>', '<a href="#music">Music</a> <a href="/bio">Bio</a>')
    const r = run('words', { pages: { '/': home }, sitemap: { status: 404, urls: [], lastmods: [] } })
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/pages we opened/)
  })
  it('the list has more pages than we opened → couldn\'t check', () => {
    expect(run('words', { pages: { '/': HOME, '/about': noBio }, sitemap: { ...SITEMAP_OK, total: 7 } }).status).toBe('unknown')
  })
  it('every page opened and still missing → fail', () => {
    const home = HOME.replace(/<nav>[\s\S]*?<\/nav>/, '<nav><a href="/">Home</a> <a href="/about">About</a></nav>')
    expect(run('words', { pages: { '/': home, '/about': noBio.replace(/<nav>[\s\S]*?<\/nav>/, '') } }).status).toBe('fail')
  })
})

describe('F27: names too short or too common to prove anything', () => {
  // The menu links stay on this page (#live), so no page of the site is left unopened.
  const only = (body: string): Fixture => ({ pages: { '/': doc('Skeen', `<nav><a href="/">Home</a> <a href="#live">Live</a></nav><main><h1>Skeen</h1>${body}</main>`) }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`], total: 1 } })
  it('"Home" and a venue "Live" that appear only in the menu are not found', () => {
    const r = FOUND_TESTS.words({ ...evidence(only('<p>Chicago house DJ and producer, playing all over the city every weekend of the year.</p>')), known: known({ bio: null, releases: [{ title: 'Home', releasedOn: null }], tourDates: [{ date: '2026-11-02', venue: 'Live', city: 'Chicago', isPast: false }] }) })
    expect(r.status).toBe('fail')
  })
  it('titles with no letters or under 3 characters are left out and said so; nothing left → not applicable', () => {
    const r = FOUND_TESTS.words({ ...evidence(only('<p>Mixed in Dolby x Atmos. Nov 22 2026.</p>')), known: known({ bio: null, tourDates: [], releases: [{ title: 'X', releasedOn: null }, { title: '22', releasedOn: null }, { title: '!!!', releasedOn: null }] }) })
    expect(r.status).toBe('na')
    expect(ev(r)).toMatch(/too short/)
  })
  it('"Therein" is not found in "out there in the cold"', () => {
    const r = FOUND_TESTS.words({ ...evidence(only('<p>We left it out there in the cold for a whole winter, and nobody came back.</p>')), known: known({ bio: null, tourDates: [], releases: [{ title: 'Therein', releasedOn: null }] }) })
    expect(r.status).toBe('fail')
  })
  it('a show is found only with its city or date near the venue, and a show without a venue is not "found" by the city alone', () => {
    const body = '<p>Skeen is from Chicago. Hideaway is a bar he likes a lot and has written about many many times in his notes over the years since he was young.</p>'
    const r = FOUND_TESTS.words({ ...evidence(only(body)), known: known({ bio: null, releases: [], tourDates: [{ date: '2026-10-04', venue: 'Hideaway', city: 'Milwaukee', isPast: false }, { date: '2026-11-02', venue: null, city: 'Chicago', isPast: false }] }) })
    expect(r.status).toBe('fail')
    expect(r.sentence).toContain('Hideaway')
    // The venue IS on the page: the sentence says what is missing, not that the name is.
    expect(r.sentence).toMatch(/name “Hideaway” but not the show’s date or city/)
  })
})

describe('F28: small false fails in words', () => {
  const only = (body: string): Fixture => ({ pages: { '/': doc('Skeen', `<main><h1>Skeen</h1>${body}</main>`) }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`], total: 1 } })
  it('a bare web address in the bio matches the site showing it without https://', () => {
    const r = FOUND_TESTS.words({ ...evidence(only('<p>Skeen is a Chicago DJ.</p><p>Read more at <a href="https://skeen.com/press">skeen.com/press</a>.</p>')), known: known({ bio: 'Skeen is a Chicago DJ. Read more at https://skeen.com/press.', releases: [], tourDates: [] }) })
    expect(r.status).toBe('pass')
  })
  it('a bio of short fragments is still looked for', () => {
    const r = FOUND_TESTS.words({ ...evidence(only('<p>A song.</p>')), known: known({ bio: 'DJ. NYC. Yes.', releases: [], tourDates: [] }) })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/bio/)
  })
  it('one release: "is", not "are"', () => {
    const r = FOUND_TESTS.words({ ...evidence(only('<p>OutWest is out now on every service.</p>')), known: known({ bio: null, tourDates: [], releases: [{ title: 'OutWest', releasedOn: null }] }) })
    expect(r).toMatchObject({ status: 'pass' })
    expect(r.sentence).toMatch(/is right in the page/)
  })
  it('text inside <noscript> counts: a reader that runs no scripts reads it', () => {
    const r = FOUND_TESTS.words({ ...evidence(only('<noscript><p>OutWest is out now on every service.</p></noscript>')), known: known({ bio: null, tourDates: [], releases: [{ title: 'OutWest', releasedOn: null }] }) })
    expect(r.status).toBe('pass')
  })
})

describe('F29 + bingwm wording', () => {
  it('a placeholder code is not a Bing code', () => {
    const home = HOME.replace('<head>', '<head><meta name="msvalidate.01" content="YOUR_CODE_HERE">')
    expect(run('bingwm', { pages: { '/': home, '/about': ABOUT } }).status).toBe('unknown')
  })
  it('a refused Bing file is "refused", not "no Bing file"', () => {
    expect(ev(run('bingwm', { bing: { siteAuth: { status: 401, hasUser: false } } }))).toMatch(/refused/)
  })
})

describe('dead sites and malformed evidence', () => {
  it('a site that answers nothing at all says so', () => {
    const dead = { status: null, html: null, finalUrl: null, error: 'network' }
    const r = run('google', { plain: { '/': dead, '/about': dead }, allBots: { '/': dead, '/about': dead }, robots: { status: null, body: null, error: 'network' } })
    expect(r).toMatchObject({ status: 'unknown', value: 'site didn’t answer', sentence: expect.stringMatching(/^your site didn’t answer when we visited/) })
    expect(r.sentence).not.toMatch(/settings/)
  })
  it('a site answering every visit with a server error says so once, not as a settings problem', () => {
    const err = { status: 500, html: null }
    for (const id of ['google', 'allowed', 'words'] as Id[]) {
      const r = run(id, { plain: { '/': err, '/about': err }, allBots: { '/': err, '/about': err }, robots: { status: 500, body: null } })
      expect([id, r.status, r.value]).toEqual([id, 'unknown', 'site error'])
      expect(r.sentence).toMatch(/answered with an error when we visited/)
    }
  })
  it('no person\'s visits at all → the bot tests can\'t compare → couldn\'t check', () => {
    for (const t of BOT_TESTS) expect([t, FOUND_TESTS[t]({ ...evidence(), plain: [] }).status]).toEqual([t, 'unknown'])
  })
  it('robots.txt answered 200 with no body → couldn\'t check, not "no rules"', () => {
    for (const t of BOT_TESTS) expect([t, run(t, { robots: { status: 200, body: null } }).status]).toEqual([t, 'unknown'])
  })
  it('no paths → list and words can\'t speak for the site', () => {
    for (const id of ['list', 'words'] as Id[]) expect([id, FOUND_TESTS[id]({ ...evidence(), paths: [] }).status]).toEqual([id, 'unknown'])
  })
  it('a page with no Google visit → allowed can\'t check it', () => {
    const e = evidence()
    e.byBot.googlebot = e.byBot.googlebot.filter((p) => p.path !== '/about')
    expect(FOUND_TESTS.allowed(e).status).toBe('unknown')
  })
  it('an html answer with no html (for everyone) is not a pass', () => {
    const nohtml = { status: 200, html: null, headers: { 'content-type': 'text/html' } }
    expect(run('google', { plain: { '/about': nohtml }, allBots: { '/about': nohtml } }).status).toBe('unknown')
  })
  it('bingwm: a home page we couldn\'t read is said, not "no sign"', () => {
    const r = run('bingwm', { plain: { '/': { status: 403, html: null } } })
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/couldn’t read your home page/)
  })
  it('no Google or Bing visits → allowed can\'t check', () => {
    expect(FOUND_TESTS.allowed({ ...evidence(), byBot: {} }).status).toBe('unknown')
  })
})
