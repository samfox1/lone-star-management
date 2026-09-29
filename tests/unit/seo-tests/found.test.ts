/**
 * The ten "Can be found" tests (STRICT: they decide what a manager is told about the live
 * site; honesty rules in types.ts). Each test: a healthy site passes, and every real way it
 * breaks is caught, with the right STATUS: `fail` only when we saw it, `unknown` when we could
 * not look. Bots come from the registry (AGENTS.md rule 4).
 */
import { describe, expect, it } from 'vitest'
import { SEO_BOTS, botsForTest } from '@/lib/seo-tests/bots'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoTestResult } from '@/lib/seo-tests/types'
import {
  ABOUT, BIO, CF_1020, CF_BLOCK, CF_CHALLENGE, EMPTY_SHELL, HOME, HOME_WITH_CF_SCRIPTS, KNOWN, LOGIN, O, OTHER_PAGE, ROBOTS_OK, SITEMAP_OK, SOFT_404,
  doc, evidence, type Fixture,
} from '@tests/unit/seo-tests/found-fixtures'

type Id = keyof typeof FOUND_TESTS
const BOT_TESTS = ['google', 'bing', 'chatgpt', 'claude', 'perplexity', 'others'] as const
const run = (id: Id, f?: Fixture): SeoTestResult => FOUND_TESTS[id](evidence(f))
const ev = (r: SeoTestResult) => r.evidence.map((x) => `${x.label}: ${x.value}`).join('\n')
/** The words a manager reads, outside "Show the details". */
const shown = (r: SeoTestResult) => [r.value, r.sentence, r.good ?? '', r.todo ?? ''].join(' ')

/** Every bot whose visit a test reads (a token-only bot is read through its visitor). */
const visitorsOf = (test: (typeof BOT_TESTS)[number]) => [...new Set(botsForTest(test).map((b) => (b.fetches ? b.key : b.visitsAs!)))]
/** The first real visitor of a test, and one that is not training-only. */
const mainVisitor = (test: (typeof BOT_TESTS)[number]) => botsForTest(test).find((b) => b.fetches && !b.trainingOnly)!

describe('every test, every fixture: the contract', () => {
  const fixtures: Record<string, Fixture> = {
    healthy: {},
    blocked: { allBots: { '/': { status: 403, html: null } } },
    nothing: { pages: {} },
    'no answer': { plain: { '/': { status: null, html: null, error: 'network' } }, allBots: { '/': { status: null, html: null, error: 'network' } } },
    'junk evidence': { robots: { status: 200, body: '\u0000\uFFFF'.repeat(50) }, sitemap: { status: 200, urls: ['::::'], lastmods: ['not a date'] }, known: { ...KNOWN, published: { ...KNOWN.published!, bio: '', releases: [{ title: '', releasedOn: null }] } } },
  }
  for (const id of Object.keys(FOUND_TESTS) as Id[]) {
    for (const [name, f] of Object.entries(fixtures)) {
      it(`${id} / ${name}: never throws, answers for itself, plain words, a limit`, () => {
        const r = run(id, f)
        expect(r.id).toBe(id)
        expect(['pass', 'fail', 'unknown']).toContain(r.status)
        expect(r.value.length).toBeGreaterThan(0)
        expect(r.value.length).toBeLessThanOrEqual(28)
        expect(r.sentence.length).toBeGreaterThan(0)
        // Honesty rule 2: every test says what it cannot see.
        expect(r.limits?.length ?? 0).toBeGreaterThan(20)
        // No jargon outside the details.
        expect(shown(r)).not.toMatch(/crawler|HTTP|robots\.txt|canonical|user[- ]agent|X-Robots|noindex|sitemap/i)
        // A fail / unknown sentence follows "Not yet:" / "Couldn't check:", so it starts lower-case.
        if (r.status !== 'pass') expect(r.sentence[0]).toBe(r.sentence[0].toLowerCase())
        else expect(r.sentence[0]).toBe(r.sentence[0].toUpperCase())
        for (const row of r.evidence) expect(row.value).not.toMatch(/<[a-z!/]/i)
      })
    }
  }
  it('FOUND_TESTS covers exactly the "found" group of the definitions', () => {
    expect(Object.keys(FOUND_TESTS).sort()).toEqual(SEO_TEST_DEFS.filter((d) => d.group === 'found').map((d) => d.id).sort())
  })
  it('a test that trips over its evidence says "couldn’t check", never throws, never passes', () => {
    const trap = evidence()
    for (const key of ['robots', 'sitemap', 'known', 'plain'] as const) Object.defineProperty(trap, key, { get: () => { throw new Error('boom') } })
    for (const id of Object.keys(FOUND_TESTS) as Id[]) {
      const r = FOUND_TESTS[id](trap)
      expect([id, r.status]).toEqual([id, 'unknown'])
      expect(r.sentence).toMatch(/went wrong/)
    }
  })
  it('a test handed evidence it cannot read says "couldn’t check", it does not throw', () => {
    const broken = { ...evidence(), plain: null, byBot: null, paths: null } as unknown as Parameters<(typeof FOUND_TESTS)['google']>[0]
    for (const id of Object.keys(FOUND_TESTS) as Id[]) expect(FOUND_TESTS[id](broken).status).toBe('unknown')
  })
})

describe('the six bot tests', () => {
  for (const test of BOT_TESTS) {
    const main = mainVisitor(test)
    describe(test, () => {
      it('a healthy site passes, names who we visited as, and states the look-alike limit', () => {
        const r = run(test)
        expect(r.status).toBe('pass')
        expect(r.value).toBe('2 of 2 pages')
        for (const bot of botsForTest(test)) expect(ev(r)).toContain(bot.robotsToken)
        expect(r.limits).toMatch(/our own server/)
        expect(r.limits).toMatch(/differently/)
      })
      it('403 as the bot (a person gets the page) → fail, with the status in plain words', () => {
        const r = run(test, { bots: { [main.key]: { '/about': { status: 403, html: null } } } })
        expect(r.status).toBe('fail')
        expect(r.sentence).toMatch(/blocked/)
        expect(r.sentence).toMatch(/403/)
        expect(r.sentence).toContain('/about')
        expect(r.value).toBe('1 of 2 pages')
      })
      it('429 and 503 as the bot → fail, each in plain words', () => {
        expect(run(test, { bots: { [main.key]: { '/': { status: 429, html: null } } } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/too many visits/) })
        expect(run(test, { bots: { [main.key]: { '/': { status: 503, html: null } } } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/not available/) })
      })
      it('the same 403 for a person too → unknown: the site turned US away, not the bot', () => {
        const r = run(test, { plain: { '/about': { status: 403, html: null } }, allBots: { '/about': { status: 403, html: null } } })
        expect(r.status).toBe('unknown')
        expect(r.sentence).toMatch(/even without a bot’s name/)
      })
      it('a page missing for everyone (404) is a fail, not an unknown', () => {
        const r = run(test, { plain: { '/about': { status: 404, html: null } }, allBots: { '/about': { status: 404, html: null } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/not found/) })
      })
      it('no answer → unknown, never pass', () => {
        const r = run(test, { bots: { [main.key]: { '/': { status: null, html: null, error: 'timeout' } } } })
        expect(r.status).toBe('unknown')
        expect(r.sentence).toMatch(/didn’t answer/)
      })
      it('ran out of time → unknown', () => {
        expect(run(test, { bots: { [main.key]: { '/about': { status: null, html: null, error: 'out-of-time' } } } })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/ran out of time/) })
      })
      it('Cloudflare challenge served with 200 → fail naming the check', () => {
        const r = run(test, { bots: { [main.key]: { '/': { html: CF_CHALLENGE } } } })
        expect(r.status).toBe('fail')
        expect(r.sentence).toMatch(/security check/)
        expect(ev(r)).toMatch(/Cloudflare/)
      })
      it('Cloudflare challenge served with 403 (cf-mitigated) → fail naming the check', () => {
        const r = run(test, { bots: { [main.key]: { '/': { status: 403, html: null, headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' } } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/security check/) })
      })
      // Asserting the SENTENCE, not just the fail: an undetected wall would still fail as
      // "a different page", for the wrong reason.
      it('Cloudflare block page → fail, read as a security check', () => {
        expect(run(test, { bots: { [main.key]: { '/about': { html: CF_BLOCK } } } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/security check/) })
      })
      it('Cloudflare "Access denied" (error 1020) page served with 200 → fail, read as a security check', () => {
        expect(run(test, { bots: { [main.key]: { '/about': { html: CF_1020 } } } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/security check/) })
      })
      it('Vercel challenge (x-vercel-mitigated: challenge) → fail', () => {
        const r = run(test, { bots: { [main.key]: { '/': { status: 429, html: null, headers: { 'x-vercel-mitigated': 'challenge', server: 'Vercel' } } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/security check/) })
        expect(ev(r)).toMatch(/Vercel/)
      })
      it('a challenge for EVERYONE (people too) → unknown', () => {
        const r = run(test, { plain: { '/': { html: CF_CHALLENGE } }, allBots: { '/': { html: CF_CHALLENGE } } })
        expect(r.status).toBe('unknown')
      })
      it('a normal page that loads Cloudflare\'s scripts and a form widget is NOT a wall', () => {
        expect(run(test, { pages: { '/': HOME_WITH_CF_SCRIPTS, '/about': ABOUT } }).status).toBe('pass')
      })
      it('a password page → fail, even when people get it too', () => {
        expect(run(test, { pages: { '/': LOGIN, '/about': ABOUT } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/password/) })
      })
      it('a soft 404 (a "not found" page served as 200) → fail', () => {
        expect(run(test, { pages: { '/': HOME, '/about': SOFT_404 } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/page not found/) })
      })
      it('a different page for the bot than for people → fail', () => {
        const r = run(test, { bots: { [main.key]: { '/': { html: OTHER_PAGE } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/different page/) })
      })
      it('the site sends the bot to another site → fail naming it', () => {
        const r = run(test, { bots: { [main.key]: { '/': { status: null, html: null, finalUrl: null, error: 'not-allowed: https://linktr.ee/someone' } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringContaining('linktr.ee') })
      })
      it('a redirect to a private address → fail, and the address is never shown as a link', () => {
        const r = run(test, { bots: { [main.key]: { '/': { status: null, html: null, finalUrl: null, error: 'not-public: http://169.254.169.254/latest/meta-data/' } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/private address/) })
      })
      it('too many redirects → unknown (we stop at 3; the bot may follow more)', () => {
        expect(run(test, { bots: { [main.key]: { '/': { status: null, html: null, error: 'too-many-redirects' } } } }).status).toBe('unknown')
      })
      it('the settings file blocks the bot by name → fail naming the rule in the details', () => {
        const robots = `User-agent: *\nAllow: /\n\nUser-agent: ${main.robotsToken}\nDisallow: /about\n`
        const r = run(test, { robots: { status: 200, body: robots } })
        expect(r.status).toBe('fail')
        expect(r.sentence).toMatch(/settings file/)
        expect(ev(r)).toContain('Disallow: /about')
        expect(r.value).toBe('1 of 2 pages')
      })
      it('the settings file blocks everyone → fail', () => {
        expect(run(test, { robots: { status: 200, body: 'User-agent: *\nDisallow: /\n' } })).toMatchObject({ status: 'fail', value: '0 of 2 pages' })
      })
      it('the settings file answers with a server error → fail (Google stops visiting)', () => {
        expect(run(test, { robots: { status: 503, body: null } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/settings file is broken/) })
      })
      it('the settings file refused to us (403) or no answer → unknown', () => {
        expect(run(test, { robots: { status: 403, body: null } }).status).toBe('unknown')
        expect(run(test, { robots: { status: null, body: null } }).status).toBe('unknown')
      })
      it('no settings file at all (404) is fine', () => {
        expect(run(test, { robots: { status: 404, body: null } }).status).toBe('pass')
      })
      it('noindex for everyone in the page → fail', () => {
        const page = HOME.replace('<head>', '<head><meta name="robots" content="noindex, follow">')
        expect(run(test, { pages: { '/': page, '/about': ABOUT } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/not to list it/) })
      })
      it('"none" in the X-Robots-Tag header → fail', () => {
        expect(run(test, { allBots: { '/about': { headers: { 'content-type': 'text/html', 'x-robots-tag': 'none' } } } }).status).toBe('fail')
      })
      it('noindex for THIS bot only (header and meta) → fail; for another bot only → pass', () => {
        const token = main.robotsToken.toLowerCase()
        expect(run(test, { allBots: { '/': { headers: { 'content-type': 'text/html', 'x-robots-tag': `${token}: noindex` } } } }).status).toBe('fail')
        const page = HOME.replace('<head>', `<head><meta name="${token}" content="noindex">`)
        expect(run(test, { pages: { '/': page, '/about': ABOUT } }).status).toBe('fail')
        expect(run(test, { allBots: { '/': { headers: { 'content-type': 'text/html', 'x-robots-tag': 'someotherbot: noindex, nofollow' } } } }).status).toBe('pass')
      })
      it('unavailable_after in the past → fail; in the future → pass', () => {
        const past = { 'content-type': 'text/html', 'x-robots-tag': 'unavailable_after: Wed, 01 Jan 2025 00:00:00 GMT' }
        const future = { 'content-type': 'text/html', 'x-robots-tag': 'unavailable_after: 2030-01-01' }
        expect(run(test, { allBots: { '/': { headers: past } } }).status).toBe('fail')
        expect(run(test, { allBots: { '/': { headers: future } } }).status).toBe('pass')
      })
      it('nofollow, nosnippet, max-snippet do not block the page', () => {
        const headers = { 'content-type': 'text/html', 'x-robots-tag': 'nofollow, max-snippet: 50, nosnippet' }
        expect(run(test, { allBots: { '/': { headers } } }).status).toBe('pass')
      })
      it('every visitor of the test is read: a problem for any of them fails it', () => {
        for (const key of visitorsOf(test)) {
          expect([key, run(test, { bots: { [key]: { '/about': { status: 403, html: null } } } }).status]).toEqual([key, 'fail'])
        }
      })
      it('a bot that visits is missing from the evidence → unknown', () => {
        const e = evidence()
        delete e.byBot[main.key]
        expect(FOUND_TESTS[test](e).status).toBe('unknown')
      })
    })
  }

  it('an empty-until-scripts page fails the AI bots that run no scripts, not Google, Bing or Apple', () => {
    const f = { pages: { '/': EMPTY_SHELL, '/about': ABOUT } }
    for (const t of ['chatgpt', 'claude', 'perplexity'] as const) expect([t, run(t, f).status, run(t, f).sentence]).toEqual([t, 'fail', expect.stringMatching(/almost no words/)])
    for (const t of ['google', 'bing'] as const) expect([t, run(t, f).status]).toEqual([t, 'pass'])
    // Common Crawl runs no scripts, so "others" still fails, on CCBot's account only.
    expect(run('others', f)).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/Common Crawl/) })
  })
  it('googlebot-only noindex fails Google, and Gemini (it reads what Googlebot fetched), not Bing', () => {
    const page = HOME.replace('<head>', '<head><meta name="googlebot" content="noindex">')
    const f = { pages: { '/': page, '/about': ABOUT } }
    expect(run('google', f).status).toBe('fail')
    expect(run('others', f).status).toBe('fail')
    expect(run('bing', f).status).toBe('pass')
    expect(run('chatgpt', f).status).toBe('pass')
  })
  it('Google-Extended is judged from the settings file only: blocking it fails "others", not "google"', () => {
    const robots = { status: 200, body: `${ROBOTS_OK}\nUser-agent: Google-Extended\nDisallow: /\n` }
    expect(run('others', { robots })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/Gemini/) })
    expect(run('google', { robots }).status).toBe('pass')
  })
  it('Gemini reads what GOOGLEBOT fetched: blocking Googlebot fails "others" even when Apple is let in', () => {
    const robots = { status: 200, body: 'User-agent: Googlebot\nDisallow: /about\n\nUser-agent: Applebot\nAllow: /\n' }
    expect(run('others', { robots })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/Gemini/) })
  })
  it('Applebot follows Googlebot\'s rules when it has none of its own (Apple\'s doc)', () => {
    const robots = { status: 200, body: 'User-agent: Googlebot\nDisallow: /about\n' }
    expect(run('others', { robots })).toMatchObject({ status: 'fail' })
    expect(ev(run('others', { robots }))).toMatch(/Applebot/)
  })
  it('blocking only the training visitor is an "Almost" fail that says search still works', () => {
    const robots = { status: 200, body: `${ROBOTS_OK}\nUser-agent: GPTBot\nDisallow: /\n` }
    const r = run('chatgpt', { robots })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost' })
    expect(r.sentence).toMatch(/learn/)
    // …while blocking the search visitor is a plain fail.
    expect(run('chatgpt', { robots: { status: 200, body: `${ROBOTS_OK}\nUser-agent: OAI-SearchBot\nDisallow: /\n` } }).lead).toBeUndefined()
  })
  it('a fail beats an unknown: one page blocked, another silent → fail', () => {
    const r = run('google', { bots: { googlebot: { '/': { status: 403, html: null }, '/about': { status: null, html: null, error: 'timeout' } } } })
    expect(r.status).toBe('fail')
  })
  it('the training-only flags are the vendors\' own (GPTBot, ClaudeBot, Applebot-Extended, CCBot)', () => {
    expect(SEO_BOTS.filter((b) => b.trainingOnly).map((b) => b.robotsToken).sort()).toEqual(['Applebot-Extended', 'CCBot', 'ClaudeBot', 'GPTBot'])
  })
})

describe('allowed: search engines are allowed to list you', () => {
  it('a healthy site passes and shows what it read', () => {
    const r = run('allowed')
    expect(r.status).toBe('pass')
    expect(ev(r)).toMatch(/canonical: /)
    expect(ev(r)).toMatch(/robots\.txt: /)
  })
  it('meta robots noindex on any page → fail naming the page', () => {
    const about = ABOUT.replace('<head>', '<head><meta name="robots" content="noindex">')
    expect(run('allowed', { pages: { '/': HOME, '/about': about } })).toMatchObject({ status: 'fail', sentence: expect.stringContaining('/about') })
  })
  it('X-Robots-Tag noindex for a person\'s visit → fail', () => {
    expect(run('allowed', { plain: { '/': { headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } } } }).status).toBe('fail')
  })
  it('bingbot-only noindex → fail (Bing is a search engine)', () => {
    const page = HOME.replace('<head>', '<head><meta name="bingbot" content="noindex">')
    expect(run('allowed', { pages: { '/': page, '/about': ABOUT } }).status).toBe('fail')
  })
  it('the settings file blocks Googlebot or Bing from a page → fail', () => {
    expect(run('allowed', { robots: { status: 200, body: 'User-agent: *\nDisallow: /about\n' } }).status).toBe('fail')
    expect(run('allowed', { robots: { status: 200, body: `${ROBOTS_OK}\nUser-agent: bingbot\nDisallow: /\n` } }).status).toBe('fail')
  })
  it('the canonical points to another site → fail naming it', () => {
    const page = HOME.replace(`<link rel="canonical" href="${O}/">`, '<link rel="canonical" href="https://someone-else.com/">')
    expect(run('allowed', { pages: { '/': page, '/about': ABOUT } })).toMatchObject({ status: 'fail', sentence: expect.stringContaining('someone-else.com') })
  })
  it('the canonical points to another page of the site → fail naming it', () => {
    const about = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, `<link rel="canonical" href="${O}/">`)
    expect(run('allowed', { pages: { '/': HOME, '/about': about } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/\/about.*home page/) })
  })
  it('a canonical in the Link header counts too', () => {
    expect(run('allowed', { plain: { '/about': { headers: { 'content-type': 'text/html', link: '<https://other.example.org/x>; rel="canonical"' } } } }).status).toBe('fail')
  })
  it('the same page by another spelling is fine: bare domain, http, trailing slash, relative', () => {
    for (const href of ['https://example.com/about', 'http://www.example.com/about/', '/about', 'about']) {
      const about = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, `<link rel="canonical" href="${href}">`)
      expect([href, run('allowed', { pages: { '/': HOME, '/about': about } }).status]).toEqual([href, 'pass'])
    }
  })
  it('no canonical at all is fine', () => {
    const about = ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '')
    expect(run('allowed', { pages: { '/': HOME, '/about': about } }).status).toBe('pass')
  })
  it('a page we could not read → unknown; the settings file refused to us → unknown', () => {
    expect(run('allowed', { plain: { '/about': { status: null, html: null, error: 'timeout' } } }).status).toBe('unknown')
    expect(run('allowed', { robots: { status: 403, body: null } }).status).toBe('unknown')
  })
  it('the settings file is broken (5xx) → fail', () => {
    expect(run('allowed', { robots: { status: 500, body: null } }).status).toBe('fail')
  })
})

describe('list: your site offers Google a list of your pages', () => {
  it('a healthy list passes', () => {
    const r = run('list')
    expect(r).toMatchObject({ status: 'pass', value: '2 pages' })
    expect(ev(r)).toContain('sitemap.xml')
  })
  it('no list → fail', () => {
    expect(run('list', { sitemap: { status: 404, urls: [], lastmods: [], url: `${O}/sitemap.xml`, parsed: false, namedInRobots: false, total: 0 } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/no list/) })
  })
  it('an html page where the list should be → fail', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, parsed: false, urls: [], lastmods: [], total: 0 } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/isn’t a real list/) })
  })
  it('an empty list → fail', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, urls: [], lastmods: [], total: 0 } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/empty/) })
  })
  it('pages on other sites or private addresses in the list → fail with the count', () => {
    const r = run('list', { sitemap: { ...SITEMAP_OK, total: 4, offSite: { count: 2, examples: ['https://evil.test/x', 'http://10.0.0.1/'] } } })
    expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/2 pages on other sites/) })
  })
  it('a page on the list that does not open → fail naming it', () => {
    expect(run('list', { plain: { '/about': { status: 404, html: null } } })).toMatchObject({ status: 'fail', sentence: expect.stringContaining('/about') })
    expect(run('list', { pages: { '/': HOME, '/about': SOFT_404 } }).status).toBe('fail')
  })
  it('a page on the list we could not reach → unknown', () => {
    expect(run('list', { plain: { '/about': { status: null, html: null, error: 'timeout' } } }).status).toBe('unknown')
  })
  it('a date in the future → fail', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, lastmods: ['2026-09-28', '2027-01-01'] } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/future/) })
  })
  it('a date that is not a date → fail', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, lastmods: ['2026-09-28', 'last tuesday'] } }).status).toBe('fail')
  })
  it('today\'s date in any timezone is not "the future"', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, lastmods: ['2026-09-28T23:30:00-05:00', '2026-09-28'] } }).status).toBe('pass')
  })
  it('every page on one date is noted in the details, not judged', () => {
    const r = run('list', { sitemap: { ...SITEMAP_OK, urls: [`${O}/`, `${O}/about`, `${O}/x`], lastmods: ['2026-09-28', '2026-09-28', '2026-09-28'], total: 3 } })
    expect(r.status).toBe('pass')
    expect(ev(r)).toMatch(/same date/)
  })
  it('no dates at all → "Almost"', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, lastmods: [null, null] } })).toMatchObject({ status: 'fail', lead: 'Almost' })
  })
  it('not named in the settings file → "Almost"', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, namedInRobots: false } })).toMatchObject({ status: 'fail', lead: 'Almost' })
  })
  it('a list we could not open, or that was refused to us → unknown', () => {
    expect(run('list', { sitemap: { status: null, urls: [], lastmods: [], error: 'timeout' } }).status).toBe('unknown')
    expect(run('list', { sitemap: { status: 403, urls: [], lastmods: [] } }).status).toBe('unknown')
    expect(run('list', { sitemap: null }).status).toBe('unknown')
  })
  it('a list of 10,000 pages: the count comes from the whole list, and only the opened pages are judged', () => {
    const r = run('list', { sitemap: { ...SITEMAP_OK, total: 10_000, truncated: true } })
    expect(r.status).toBe('pass')
    expect(r.value).toBe('10,000 pages')
    expect(ev(r)).toMatch(/only the start/)
  })
  it('a child list of an index that does not open → fail', () => {
    expect(run('list', { sitemap: { ...SITEMAP_OK, children: [{ url: `${O}/a.xml`, status: 200 }, { url: `${O}/b.xml`, status: 404 }] } }).status).toBe('fail')
  })
})

describe('words: your words are in the page itself', () => {
  it('bio, releases and upcoming shows as text → pass', () => {
    const r = run('words')
    expect(r.status).toBe('pass')
    expect(ev(r)).toMatch(/bio: 2 of 2 sentences/)
    expect(ev(r)).toMatch(/releases: 2 of 2/)
    expect(ev(r)).toMatch(/shows: 1 of 1/)
  })
  it('the bio only in the fact card (JSON-LD), not as words → fail that says so', () => {
    const about = ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '<p>More soon.</p>')
    const r = run('words', { pages: { '/': HOME, '/about': about } })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/bio/)
    expect(r.sentence).toMatch(/hidden/)
  })
  it('the bio only in a meta description → fail', () => {
    const home = HOME.replace('Skeen is a Chicago house DJ and producer.', BIO)
    const about = ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '')
    expect(run('words', { pages: { '/': home.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, ''), '/about': about } }).status).toBe('fail')
  })
  it('half the bio → fail with the count', () => {
    const about = ABOUT.replace(' He&rsquo;s played ZHU at Navy Pier and remixed Flume for the OutWest EP.', '')
    expect(run('words', { pages: { '/': HOME, '/about': about } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/1 of 2/) })
  })
  it('a release missing → fail naming it', () => {
    const home = HOME.replace('<li>OutWest</li>', '').replace(/OutWest EP/g, 'EP')
    const about = ABOUT.replace(/OutWest EP/g, 'EP')
    const r = run('words', { pages: { '/': home, '/about': about }, known: { ...KNOWN, published: { ...KNOWN.published!, bio: 'Skeen is a Chicago DJ and producer.' } } })
    expect(r).toMatchObject({ status: 'fail', sentence: expect.stringContaining('OutWest') })
  })
  it('an upcoming show missing → fail; a past show is not looked for', () => {
    const home = HOME.replace('Oct 4 · Hideaway, Chicago', 'Oct 4 · TBA')
    expect(run('words', { pages: { '/': home, '/about': ABOUT } })).toMatchObject({ status: 'fail', sentence: expect.stringContaining('Hideaway') })
    // Navy Pier is past AND only in the bio; removing the bio sentence would be a bio miss, not a show miss.
    expect(ev(run('words'))).not.toMatch(/Navy Pier/)
  })
  it('entities, curly quotes, line breaks and tags inside words all still match', () => {
    const about = ABOUT.replace('He&rsquo;s played', 'He&#x27;s\n   <em>played</em>').replace('Navy Pier', 'Navy&nbsp;Pier')
    expect(run('words', { pages: { '/': HOME, '/about': about } }).status).toBe('pass')
  })
  it('a word split by a tag in the middle still matches ("Out<b>West</b>")', () => {
    const home = HOME.replace('<li>OutWest</li>', '<li>Out<b>West</b></li>')
    const about = ABOUT.replace('OutWest EP', 'EP')
    const known = { ...KNOWN, published: { ...KNOWN.published!, bio: 'Skeen is a Chicago DJ and producer.' } }
    expect(run('words', { pages: { '/': home, '/about': about }, known }).status).toBe('pass')
  })
  it('text in the <title>, an attribute or a script does not count', () => {
    const home = doc('You Were There · OutWest · Hideaway', `<main><h1 title="OutWest">Skeen</h1><img alt="Hideaway"><script>var t = "You Were There OutWest Hideaway"</script></main>`)
    const r = run('words', { pages: { '/': home }, known: { ...KNOWN, published: { ...KNOWN.published!, bio: null } } })
    expect(r.status).toBe('fail')
  })
  it('a short title does not match inside another word ("Up" is not in "update")', () => {
    const r = run('words', { pages: { '/': doc('x', '<main><p>Tour update coming soon for everyone who asked.</p></main>') }, known: { ...KNOWN, published: { ...KNOWN.published!, bio: null, tourDates: [], releases: [{ title: 'Up', releasedOn: null }] } } })
    expect(r.status).toBe('fail')
  })
  it('nothing published → unknown; nothing to look for → unknown', () => {
    expect(run('words', { known: { ...KNOWN, published: null } }).status).toBe('unknown')
    expect(run('words', { known: { ...KNOWN, published: { ...KNOWN.published!, bio: null, releases: [], tourDates: [] } } }).status).toBe('unknown')
  })
  it('a word missing while a page could not be read → unknown (it may be on that page)', () => {
    const about = ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '')
    expect(run('words', { pages: { '/': HOME, '/about': about, '/music': '' }, plain: { '/music': { status: null, html: null, error: 'timeout' } } }).status).toBe('unknown')
  })
  it('no page could be read → unknown', () => {
    expect(run('words', { plain: { '/': { status: 503, html: null }, '/about': { status: 503, html: null } } }).status).toBe('unknown')
  })
})

describe('bingwm: your site is linked to Bing Webmaster Tools', () => {
  it('the msvalidate.01 tag on the home page → pass', () => {
    const home = HOME.replace('<head>', '<head><meta name="msvalidate.01" content="0123456789ABCDEF0123456789ABCDEF">')
    expect(run('bingwm', { pages: { '/': home, '/about': ABOUT } }).status).toBe('pass')
  })
  it('a BingSiteAuth.xml naming a user → pass', () => {
    expect(run('bingwm', { bing: { siteAuth: { status: 200, hasUser: true } } }).status).toBe('pass')
  })
  it('no sign → unknown, never fail (it can be linked in ways we can\'t see), with the way to do it', () => {
    const r = run('bingwm')
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/can’t see/)
    expect(r.action).toEqual({ kind: 'outside', href: 'https://www.bing.com/webmasters', label: expect.any(String) })
  })
  it('an empty msvalidate tag is not a sign', () => {
    const home = HOME.replace('<head>', '<head><meta name="msvalidate.01" content=" ">')
    expect(run('bingwm', { pages: { '/': home, '/about': ABOUT } }).status).toBe('unknown')
  })
})

describe('evidence is what was observed', () => {
  it('shows the status and header actually seen, not what was expected', () => {
    const r = run('google', { bots: { googlebot: { '/about': { status: 403, html: null, headers: { server: 'cloudflare' } } } } })
    expect(ev(r)).toMatch(/\/about: .*403/)
    expect(ev(r)).toMatch(/cloudflare/)
  })
})
