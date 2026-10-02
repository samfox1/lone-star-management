/**
 * Every one of the ten "Can be found" tests keeps the honesty rules, whatever site we point it at.
 *
 * Code:     src/lib/seo-tests/found.ts (FOUND_TESTS, and the page readings all ten share)
 * Feature:  all ten tests of the Test tab group "Can be found" (google, bing, chatgpt, claude,
 *           perplexity, others, allowed, list, words, bingwm)
 * Tier:     STRICT (AGENTS.md "Test depth"): these results are what a manager is told about the
 *           live site.
 * Covers:   • every test the Test tab lists under "Can be found" has code, and nothing extra does
 *           • on five kinds of site (healthy, blocked, empty, silent, junk) each test answers for
 *             itself, in plain words, with a limit, and never throws
 *           • a test that trips over its evidence says "couldn't check", never "pass"
 *           • a site that didn't answer, or answered only with errors, is said as exactly that
 *           • a page that may not be the artist's site (a block page, a parked domain) is
 *             "couldn't check", not a pass
 *           • a normal page that loads a security vendor's script, and a page named like an
 *             error ("Not Found", "Area 404"), are read as normal pages
 * Not here: each test's own rules: bots.test.ts, allowed.test.ts, list.test.ts, words.test.ts and
 *           bingwm.test.ts in this folder. How the site is fetched: evidence.test.ts. The
 *           "in Tapir:" label rule across all 24 tests: ../honesty.test.ts.
 * Fixtures: ../_found-fixtures.ts builds the evidence: a healthy two-page site (home + /about) with
 *           single visits swapped for real error, firewall and parked pages. No network.
 *
 * Why one file for all ten: the sweeps below read the list of tests from the code (FOUND_TESTS),
 * so an eleventh test is checked the day it is added (AGENTS.md rule 4). Split per file, each
 * file would have to name its own tests by hand.
 */
import { describe, expect, it } from 'vitest'
import { SEO_BOTS } from '@/lib/seo-tests/bots'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import { FOUND_NAMES, FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoEvidence, SeoTestResult } from '@/lib/seo-tests/types'
import {
  ABOUT, HOME, HOME_WITH_CF_SCRIPTS, KNOWN, O, SITEMAP_OK, doc, evidence, run, type Fixture, type FoundId,
} from '@tests/unit/seo-tests/_found-fixtures'

const IDS = Object.keys(FOUND_TESTS) as FoundId[]
/** The six bot tests, read from the bot list (bots.ts). */
const BOT_TESTS = [...new Set(SEO_BOTS.map((b) => b.test))]
/** The words a manager reads, outside "Show the details". */
const shown = (r: SeoTestResult) => [r.value, r.sentence, r.good ?? '', r.todo ?? ''].join(' ')

describe('the group', () => {
  // The code covers exactly the Test tab's list: a test on the page with no code would never run.
  it('every test listed under "Can be found" has code, and no code exists for a test that is not listed', () => {
    expect([...IDS].sort()).toEqual(SEO_TEST_DEFS.filter((d) => d.group === 'found').map((d) => d.id).sort())
  })
})

describe('what every test promises, on any site', () => {
  const SITES: [string, Fixture][] = [
    ['a healthy site', {}],
    ['a site that blocks every bot', { allBots: { '/': { status: 403, html: null } } }],
    ['a site with no pages at all', { pages: {} }],
    ['a site that doesn’t answer', { plain: { '/': { status: null, html: null, error: 'network' } }, allBots: { '/': { status: null, html: null, error: 'network' } } }],
    ['junk evidence', { robots: { status: 200, body: '\u0000\uFFFF'.repeat(50) }, sitemap: { status: 200, urls: ['::::'], lastmods: ['not a date'] }, known: { ...KNOWN, published: { ...KNOWN.published!, bio: '', releases: [{ title: '', releasedOn: null }] } } }],
  ]
  // Each of the ten tests, read from the code, meets every site below.
  describe.each(IDS)('%s', (id) => {
    // The honesty rules (types.ts): a known status, a short value, one plain sentence with the
    // right capital, a limit, and no code words or html outside the details. A test that breaks
    // one of these shows the manager something wrong or unreadable.
    it.each(SITES)('on %s: never throws, answers for itself in plain words, and states a limit', (_site, f) => {
      const r = run(id, f)
      expect(r.id).toBe(id)
      expect(['pass', 'fail', 'unknown', 'na']).toContain(r.status)
      expect(r.value.length).toBeGreaterThan(0)
      expect(r.value.length).toBeLessThanOrEqual(28)
      expect(r.sentence.length).toBeGreaterThan(0)
      expect(r.sentence.length).toBeLessThanOrEqual(180)
      // Honesty rule 2: every test says what it cannot see.
      expect(r.limits?.length ?? 0).toBeGreaterThan(20)
      expect(shown(r)).not.toMatch(/crawler|HTTP|robots\.txt|canonical|user[- ]agent|X-Robots|noindex|sitemap|\berror \d|\bstatus\b|firewall|script/i)
      // A sentence that isn't a pass follows "Not yet:" or "Couldn't check:", so it starts
      // lower-case, unless it starts with a name ("ChatGPT search is shown…").
      const startsWithName = FOUND_NAMES.some((n) => r.sentence.startsWith(n))
      if (r.status !== 'pass' && !startsWithName) expect(r.sentence[0]).toBe(r.sentence[0].toLowerCase())
      if (r.status === 'pass') expect(r.sentence[0]).toBe(r.sentence[0].toUpperCase())
      for (const row of r.evidence) expect(row.value).not.toMatch(/<[a-z!/]/i)
    })
  })

  // A bug inside a test must never read as a pass: the code wraps every test so a throw becomes
  // "couldn't check" with its own sentence.
  it('a test that trips over its evidence says “something went wrong”, as couldn’t check', () => {
    const trap = evidence()
    for (const key of ['robots', 'sitemap', 'known', 'plain'] as const) Object.defineProperty(trap, key, { get: () => { throw new Error('boom') } })
    for (const id of IDS) {
      const r = FOUND_TESTS[id](trap)
      expect([id, r.status, r.sentence]).toEqual([id, 'unknown', expect.stringMatching(/went wrong/)])
    }
  })

  // Evidence with its lists missing is handled by each test itself (its own "couldn't check"
  // sentence), not by the safety net above: the net hides which test is broken.
  it('evidence with no pages, no visits and no paths is couldn’t check, each test saying why itself', () => {
    const broken = { ...evidence(), plain: null, byBot: null, paths: null } as unknown as SeoEvidence
    for (const id of IDS) {
      const r = FOUND_TESTS[id](broken)
      expect([id, r.status]).toEqual([id, 'unknown'])
      expect([id, r.sentence]).not.toEqual([id, expect.stringMatching(/went wrong/)])
    }
  })
})

describe('a site that is down is said once, as that', () => {
  const dead = { status: null, html: null, finalUrl: null, error: 'network' }
  const err = { status: 500, html: null }
  // Every test reads the same "is the site up" fact first, so a dead site is one clear message
  // on every row, not ten different guesses (and never a blame on the settings file).
  it('a site that answers nothing: every test says the site didn’t answer', () => {
    const f: Fixture = {
      plain: { '/': dead, '/about': dead }, allBots: { '/': dead, '/about': dead },
      robots: { status: null, body: null, error: 'network' }, sitemap: { status: null, urls: [], lastmods: [], error: 'network' }, bing: { siteAuth: { status: null, hasUser: false } },
    }
    for (const id of IDS) {
      const r = run(id, f)
      expect([id, r.status, r.value]).toEqual([id, 'unknown', 'site didn’t answer'])
      expect([id, r.sentence]).toEqual([id, expect.stringMatching(/^your site didn’t answer when we visited/)])
    }
  })
  // Same for a site whose every answer is a server error: "it may be down", not a settings problem.
  it('a site that answers every visit with a server error: every test says so', () => {
    const f: Fixture = {
      plain: { '/': err, '/about': err }, allBots: { '/': err, '/about': err },
      robots: { status: 500, body: null }, sitemap: { status: 500, urls: [], lastmods: [] }, bing: { siteAuth: { status: 500, hasUser: false } },
    }
    for (const id of IDS) {
      const r = run(id, f)
      expect([id, r.status, r.value]).toEqual([id, 'unknown', 'site error'])
      expect([id, r.sentence]).toEqual([id, expect.stringMatching(/answered with an error when we visited/)])
    }
  })
})

describe('a page that may not be the artist’s site', () => {
  const PAD = 'This request could not be completed because the security policy for this website does not allow automated traffic from your network at this time. If you believe this is a mistake please contact the site owner and include the reference number shown below. '
  // An "Access denied" page with no vendor's mark, served to everyone with a 200: we were shown
  // a wall, not the site, so nothing can be said about it. (verify-found F2)
  it('an unmarked “Access denied” page for everyone: every test is couldn’t check', () => {
    const DENIED = doc('Access denied', `<main><h1>Access denied</h1><p>${PAD.repeat(2)}</p><p>Reference 18.4f5e3b17</p></main>`)
    for (const id of IDS) expect([id, run(id, { pages: { '/': DENIED, '/about': DENIED } }).status]).toEqual([id, 'unknown'])
  })
  // A parked or "coming soon" page without the artist's name is not the artist's site: every test
  // that reads pages says so and names the artist. The list and Bing tests don't read the name.
  it('a parked page without the artist’s name: couldn’t check, naming the artist', () => {
    const PARKED = doc('coming soon', `<main><h1>This domain is parked</h1><p>${'Buy this domain today. Great names make great businesses and this one could be yours. '.repeat(6)}</p></main>`)
    for (const id of IDS.filter((x) => x !== 'list' && x !== 'bingwm')) {
      const r = run(id, { pages: { '/': PARKED, '/about': PARKED } })
      expect([id, r.status, r.sentence]).toEqual([id, 'unknown', expect.stringContaining('“Skeen”')])
    }
  })
})

describe('a normal page is read as a normal page', () => {
  const CONTACT = doc('Contact Skeen', '<nav><a href="/">Home</a> <a href="/about">About</a></nav><main><h1>Contact Skeen</h1><p>For booking and press, write to us.</p><form><div class="g-recaptcha" data-sitekey="6Lc"></div><button>Send</button></form></main><script src="https://www.google.com/recaptcha/api.js" async defer></script>', `<link rel="canonical" href="${O}/contact">`)
  const imperva = (h: string) => h.replace('</body>', '<script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e&ns=1&cb=1234" async></script></body>')
  const datadome = (h: string) => h.replace('</head>', '<script>window.ddjskey="ABC"</script><script src="https://ct.captcha-delivery.com/c.js" async></script></head>')
  // Security vendors' scripts also sit on ordinary pages (a form's reCAPTCHA, Cloudflare's bot
  // script, Imperva, DataDome). A page carrying one is not a wall: every test that reads pages
  // passes. Bing's test is left out: it never passes without Bing's code. (verify-found F9)
  it.each<[string, Fixture]>([
    ['a short contact page with a reCAPTCHA form', { pages: { '/': HOME, '/about': ABOUT, '/contact': CONTACT }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`, `${O}/about`, `${O}/contact`], lastmods: ['2026-09-20', '2026-09-20', '2026-09-20'], total: 3 } }],
    ['Cloudflare’s bot script and a Turnstile form widget', { pages: { '/': HOME_WITH_CF_SCRIPTS, '/about': ABOUT } }],
    ['Imperva’s script on every page', { pages: { '/': imperva(HOME), '/about': imperva(ABOUT) } }],
    ['DataDome’s tag on every page', { pages: { '/': datadome(HOME), '/about': datadome(ABOUT) } }],
  ])('%s: every test that reads pages passes', (_name, f) => {
    for (const id of IDS.filter((x) => x !== 'bingwm')) expect([id, run(id, f).status, run(id, f).sentence]).toEqual([id, 'pass', expect.any(String)])
  })
  // medium.com, as seen: a short home page loading reCAPTCHA, and a 403 for the AI bots' names.
  // The person's page is not a wall, so the 403 is the bots being turned away: a fail, not
  // "couldn't check". Google still gets in. (verify-found F9, a real site)
  it('a person gets a short page with reCAPTCHA and the AI bots get 403: the AI tests fail, Google passes', () => {
    const AI_KEYS = ['oai-searchbot', 'chatgpt-user', 'gptbot', 'claudebot', 'claude-searchbot', 'claude-user', 'perplexitybot', 'perplexity-user', 'ccbot']
    const home = doc('Medium', '<main><h1>Skeen</h1><p>Human stories and ideas. A place to read, write, and deepen your understanding.</p><a href="/signin">Sign in</a></main><script src="https://www.google.com/recaptcha/enterprise.js"></script>')
    const f: Fixture = { pages: { '/': home }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`] }, bots: Object.fromEntries(AI_KEYS.map((k) => [k, { '/': { status: 403, html: null, headers: { server: 'cloudflare' } } }])) }
    for (const id of ['chatgpt', 'claude', 'perplexity'] as const) expect([id, run(id, f).status]).toEqual([id, 'fail'])
    expect(run('google', f).status).toBe('pass')
    expect(run('allowed', f).status).toBe('pass')
  })
  // A song called "Not Found" or a tour called "Area 404" is a real page, not a missing one: only
  // a title or heading that IS a not-found message counts. (verify-found F10)
  it.each([
    ['a song called “Not Found”', doc('Not Found · Skeen', '<main><h1>Not Found</h1><p>The second single by Skeen. Recorded live in Chicago in the winter of 2023. Out now on every service.</p></main>')],
    ['a tour called “Area 404”', doc('Area 404 Tour · Skeen', '<main><h1>Area 404 Tour</h1><p>Skeen live. Oct 4 · Hideaway, Chicago. Doors at 7.</p></main>')],
  ])('%s passes the bot tests, allowed and the list', (_name, page) => {
    const f: Fixture = { pages: { '/': HOME, '/x': page }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`, `${O}/x`] } }
    for (const id of [...BOT_TESTS, 'allowed', 'list'] as FoundId[]) expect([id, run(id, f).status]).toEqual([id, 'pass'])
  })
})
