/**
 * The six "Your site is open to …" tests say a bot is let in only when every page we opened
 * really opened for it, as the same page a person gets, and nothing asks it to stay away.
 *
 * Code:     src/lib/seo-tests/found.ts (botTest), src/lib/seo-tests/bots.ts (who we visit as)
 * Feature:  google, bing, chatgpt, claude, perplexity, others (Test tab group "Can be found")
 * Tier:     STRICT (AGENTS.md "Test depth"): these results are what a manager is told about the
 *           live site; `fail` only for what we saw, `unknown` for what we could not look at.
 * Covers:   • a bot turned away (a status, a security check, a password page, a "not found" page,
 *             an answer that isn't a web page, a redirect elsewhere) is a fail, in plain words
 *           • a wall that turned away our PERSON's visit too is "couldn't check", not the bot's fault
 *           • the bot must get the page a person gets: the artist's own words, and 80% the same words
 *           • a page built by its scripts fails only the bots that don't run scripts (from bots.ts)
 *           • the settings file (robots.txt) and "don't list me" tags, for everyone or one bot
 *           • a page cut at the size cap is not judged on its words
 *           • per bot: the one exact sentence, and the rules only that test has (ChatGPT's and
 *             Claude's training visitors, Gemini reading Google's visit, Apple following Google,
 *             Bing's Copilot tags: noarchive fails, nocache / nosnippet are said in the pass)
 * Not here: what all ten tests share (contract.test.ts); how robots.txt is read line by line
 *           (robots-txt.test.ts); how the visits are fetched (evidence.test.ts).
 * Fixtures: ../found-fixtures.ts: a healthy two-page site; each case swaps ONE visit (a bot's, a
 *           person's, or every bot's) for a real firewall or error answer. No network.
 */
import { describe, expect, it } from 'vitest'
import { SEO_BOTS, botsForTest } from '@/lib/seo-tests/bots'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoBot, SeoPageFetch } from '@/lib/seo-tests/types'
import {
  ABOUT, CF_1020, CF_BLOCK, CF_CHALLENGE, EMPTY_SHELL, HOME, LOGIN, ROBOTS_OK, SOFT_404,
  details, doc, evidence, run, type Fixture,
} from '@tests/unit/seo-tests/found-fixtures'

type BotTest = SeoBot['test']
/** The six bot tests, read from the bot list (bots.ts), not typed out by hand. */
const BOT_TESTS = [...new Set(SEO_BOTS.map((b) => b.test))]
/** The bot whose visit a test reads: itself, or for a settings-only name (Gemini), who visits for it. */
const visitorOf = (b: SeoBot) => (b.fetches ? b : SEO_BOTS.find((x) => x.key === b.visitsAs)!)
/** Every bot whose visit a test reads. */
const visitorsOf = (test: BotTest) => [...new Set(botsForTest(test).map((b) => visitorOf(b).key))]
/** The first real visitor of a test that is not training-only: the one a case turns away. */
const mainVisitor = (test: BotTest) => botsForTest(test).find((b) => b.fetches && !b.trainingOnly)!
/** Does any visitor of this test read pages without running their scripts? (bots.ts `runsScripts`) */
const readsWithoutScripts = (test: BotTest) => botsForTest(test).some((b) => !visitorOf(b).runsScripts)

const html = { 'content-type': 'text/html' }
const noindexMeta = (name: string, content = 'noindex') => HOME.replace('<head>', `<head><meta name="${name}" content="${content}">`)

describe('what all six bot tests share', () => {
  // The "training only" marks decide when a block is "Almost" (only AI training blocked): they
  // must be the vendors' own list, not a guess.
  it('the training-only visitors are the ones the vendors say only gather pages to train AI', () => {
    expect(SEO_BOTS.filter((b) => b.trainingOnly).map((b) => b.robotsToken).sort()).toEqual(['Applebot-Extended', 'CCBot', 'ClaudeBot', 'GPTBot'])
  })

  // Every rule below runs once for each of the six tests, turning away that test's own visitor.
  describe.each(BOT_TESTS)('%s', (test) => {
    const main = mainVisitor(test)
    const token = main.robotsToken

    describe('a healthy site', () => {
      // The pass, with every name we visited as in the details and the look-alike limit: we visit
      // from our own server using the bot's name, so a firewall may treat the real bot differently.
      it('passes, lists every name we visited as, and states the look-alike limit', () => {
        const r = run(test)
        expect(r).toMatchObject({ status: 'pass', value: '2 of 2 pages' })
        for (const bot of botsForTest(test)) expect(details(r)).toContain(bot.robotsToken)
        expect(r.limits).toMatch(/our own server/)
        expect(r.limits).toMatch(/differently/)
      })
    })

    describe('a visit that is turned away', () => {
      // A refusal the bot got and a person didn't is a fail: the status in plain words in the
      // sentence (the number stays in the details, UI review 2026-09-29), with the server we saw.
      it.each([
        [403, 'blocked'],
        [429, 'too many visits'],
        [503, 'not available'],
      ])('%i for the bot only: fail, said as “%s”, the number only in the details', (status, words) => {
        const r = run(test, { bots: { [main.key]: { '/about': { status, html: null, headers: { server: 'cloudflare' } } } } })
        expect(r).toMatchObject({ status: 'fail', value: '1 of 2 pages' })
        expect(r.sentence).toContain(`/about turned away our visit using ${main.who}’s name (${words})`)
        expect(r.sentence).not.toMatch(/\d{3}/)
        expect(details(r)).toMatch(new RegExp(`/about: .*${token} ${status} · cloudflare`))
      })
      // The same refusal for a person too means the site turned US away, not the bot: we can't
      // say what the real bot gets.
      it('the same 403 for a person too: couldn’t check, not the bot’s fault', () => {
        const r = run(test, { plain: { '/about': { status: 403, html: null } }, allBots: { '/about': { status: 403, html: null } } })
        expect(r).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/even without a bot’s name/) })
      })
      // What we saw outranks what we couldn't see: one page refused and another silent is a fail.
      it('one page refused and another silent: fail, not couldn’t check', () => {
        expect(run(test, { bots: { [main.key]: { '/': { status: 403, html: null }, '/about': { status: null, html: null, error: 'timeout' } } } }).status).toBe('fail')
      })
      // A test reads every visitor it names (ChatGPT has three): any one of them turned away fails it.
      it('each visitor the test names is read: any one turned away fails it', () => {
        for (const key of visitorsOf(test)) {
          expect([key, run(test, { bots: { [key]: { '/about': { status: 403, html: null } } } }).status]).toEqual([key, 'fail'])
        }
      })
    })

    describe('a page missing for everyone', () => {
      // A menu link that 404s for everyone is a broken link, not the bot being turned away: it is
      // noted and leaves the count (the list test judges broken pages).
      it('an inner page missing for everyone is noted and left out of the count', () => {
        const r = run(test, { plain: { '/about': { status: 404, html: null } }, allBots: { '/about': { status: 404, html: null } } })
        expect(r).toMatchObject({ status: 'pass', value: '1 of 1 page' })
        expect(details(r)).toMatch(/\/about doesn’t open for anyone \(404\)/)
      })
      // The home page is never left out: missing for everyone is a fail.
      it('the home page missing for everyone is a fail', () => {
        const r = run(test, { plain: { '/': { status: 404, html: null } }, allBots: { '/': { status: 404, html: null } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/doesn’t open for anyone \(not found\)/) })
      })
    })

    describe('a visit with no answer', () => {
      // No answer is never a pass: "couldn't check", saying why in plain words (we stop after 3
      // redirects; the real bot may follow more).
      it.each([
        ['timeout', /didn’t answer our visit using/],
        ['out-of-time', /ran out of time before we reached your page \/about/],
        ['too-many-redirects', /sent our visit on more than 3 times/],
      ])('%s: couldn’t check, saying why', (error, why) => {
        expect(run(test, { bots: { [main.key]: { '/about': { status: null, html: null, error } } } })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(why) })
      })
      // A visitor missing from the evidence was never sent: we can't say what it gets.
      it('a visitor we never sent: couldn’t check', () => {
        const e = evidence()
        delete e.byBot[main.key]
        expect(FOUND_TESTS[test](e).status).toBe('unknown')
      })
      // With no person's visits there is nothing to compare the bot's page with.
      it('no person’s visits at all: couldn’t check', () => {
        expect(FOUND_TESTS[test]({ ...evidence(), plain: [] }).status).toBe('unknown')
      })
      // A person's visit refused while the bot got the page: the comparison was not made, and the
      // details say so. (verify-found F12)
      it('a person’s visit refused: the details say the comparison wasn’t made', () => {
        expect(details(run(test, { plain: { '/': { status: 403, html: null } } }))).toMatch(/couldn’t compare \/ with a person’s visit \(403\)/)
      })
    })

    describe('a visit sent somewhere else', () => {
      // A redirect we refused to follow is the site sending the bot away: a fail, naming the other
      // site, but never a private address (it could be an internal machine).
      it.each<[string, Partial<SeoPageFetch>, RegExp]>([
        ['to another site', { status: null, finalUrl: null, error: 'not-allowed: https://linktr.ee/someone' }, /sends .+ to another site \(linktr\.ee\)/],
        ['to a private address', { status: null, finalUrl: null, error: 'not-public: http://169.254.169.254/latest/meta-data/' }, /sends visitors to a private address\.$/],
        ['to an address that doesn’t work', { status: 301 }, /sends visitors to a broken address/],
      ])('%s: fail, saying where', (_name, visit, said) => {
        const r = run(test, { bots: { [main.key]: { '/': { html: null, ...visit } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(said) })
        expect(`${r.sentence} ${details(r)}`).not.toContain('169.254')
      })
    })

    describe('a security check', () => {
      const HUMAN = doc('Verify you are human', '<main><h1>Verify you are human</h1><p>Press and hold the button to continue.</p></main>')
      const DATADOME = '<html><head><title>example.com</title></head><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>'
      // A security check that stops only the bot is a fail with the vendor in the details. The
      // sentence is asserted too: an undetected wall would still fail, but as "a different page",
      // for the wrong reason. The vendors' own marks, as served.
      it.each<[string, Partial<SeoPageFetch>, string]>([
        ['Cloudflare’s challenge, served 200', { html: CF_CHALLENGE }, 'Cloudflare'],
        ['Cloudflare’s challenge, served 403 with its header', { status: 403, html: null, headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' } }, 'Cloudflare'],
        ['Cloudflare’s block page', { html: CF_BLOCK }, 'Cloudflare'],
        ['Cloudflare’s “Access denied” page (error 1020)', { html: CF_1020 }, 'Cloudflare'],
        ['Vercel’s challenge, by its header', { status: 429, html: null, headers: { 'x-vercel-mitigated': 'challenge', server: 'Vercel' } }, 'Vercel'],
        ['Amazon’s firewall, by its header', { status: 405, html: null, headers: { 'x-amzn-waf-action': 'captcha' } }, 'Amazon'],
        ['an unmarked “Verify you are human” page (verify-found F2)', { html: HUMAN }, 'a security check'],
        ['DataDome’s page on a 403 (verify-found F9)', { status: 403, html: DATADOME, headers: html }, 'DataDome'],
      ])('%s: fail, naming the check', (_name, visit, vendor) => {
        const r = run(test, { bots: { [main.key]: { '/about': visit } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/a security check stopped our visit using .+ on your page \/about/) })
        expect(details(r)).toContain(`/about: a security check (${vendor}) for ${token}`)
      })
      // A challenge for people too is our server being stopped, not the bot: couldn't check.
      it('a challenge for everyone, people too: couldn’t check', () => {
        const r = run(test, { plain: { '/': { html: CF_CHALLENGE } }, allBots: { '/': { html: CF_CHALLENGE } } })
        expect(r).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/even without a bot’s name/) })
      })
    })

    describe('a page a reader can’t use', () => {
      // A password page keeps every reader out, even when people get it too.
      it('a password page: fail, even when people get it too', () => {
        expect(run(test, { pages: { '/': LOGIN, '/about': ABOUT } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/asks for a password/) })
      })
      // A "not found" page served with a 200 is still a missing page. (verify-found F10)
      it.each([
        ['Next.js’s default 404 page', SOFT_404],
        ['a page titled “404”', doc('404', '<h1>404</h1>')],
        ['a page titled “Page not found”', doc('Page not found · Skeen', '<h1>Page not found · Skeen</h1>')],
      ])('%s served as 200: fail', (_name, page) => {
        expect(run(test, { pages: { '/': HOME, '/about': page } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/says “page not found”/) })
      })
      // A 200 that isn't a web page, when a person gets one, is the bot turned away quietly (a
      // text "Access denied", JSON, an empty body). (verify-found F1)
      it.each<[string, Partial<SeoPageFetch>]>([
        ['plain text', { status: 200, html: null, headers: { 'content-type': 'text/plain' } }],
        ['JSON', { status: 200, html: null, headers: { 'content-type': 'application/json' } }],
        ['an empty web page', { status: 200, html: '', headers: html }],
        ['204 No Content', { status: 204, html: null, headers: {} }],
      ])('%s for the bots while a person gets the page: fail', (_name, visit) => {
        expect(run(test, { allBots: { '/': visit } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/is sent something that isn’t a web page/) })
      })
      // The same file for everyone (a PDF on the list) is not a bot problem: noted, not judged.
      it('the same file for people and bots (a PDF): noted, not a fail', () => {
        const pdf = { status: 200, html: null, headers: { 'content-type': 'application/pdf' } }
        const r = run(test, { plain: { '/about': pdf }, allBots: { '/about': pdf } })
        expect(r.status).toBe('pass')
        expect(details(r)).toContain('/about is a file (application/pdf) for everyone')
      })
      // A web page answer with no page in it, for everyone, can't be read: couldn't check, never a pass.
      it('a web page answer with no page in it, for everyone: couldn’t check', () => {
        const nohtml = { status: 200, html: null, headers: html }
        expect(run(test, { plain: { '/about': nohtml }, allBots: { '/about': nohtml } })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/we got no web page/) })
      })
    })

    describe('the bot gets the page a person gets', () => {
      const noBio = ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '')
      const gated = HOME.replace(/<section id="music">[\s\S]*<\/section>/, '<p>Sign in to see music and shows.</p>')
      // Each of the artist's published words a person's copy shows must be in the bot's copy too,
      // however alike the rest of the page is: fail, naming what is missing. (verify-found F4, F5)
      it.each([
        ['/about without the bio paragraph', '/about', noBio, '(your bio)'],
        ['home with the music and shows swapped for “Sign in”', '/', gated, '(“You Were There”)'],
      ])('%s: fail, naming what is missing', (_name, path, page, what) => {
        const r = run(test, { bots: { [main.key]: { [path]: { html: page } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringContaining(`without some of your words ${what}`) })
      })
      // A copy with every artist word but a third more words besides is a different page: under 80%
      // the same words fails, with the share in the details. (verify-found F5)
      it('a copy with a third more words than people get: fail, as a different page', () => {
        const stuffed = ABOUT.replace('</main>', '<p>house techno dj producer chicago best dj booking club night party festival mix remix edit bootleg release</p></main>')
        const r = run(test, { bots: { [main.key]: { '/about': { html: stuffed } } } })
        expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/shown a different page than people see on your page \/about/) })
        expect(details(r)).toMatch(new RegExp(`/about: ${token} got \\d+% the same words`))
      })
    })

    describe('a page built by its scripts', () => {
      const INLINE = doc('Skeen', '<div id="root"></div><script type="module">import("/assets/index-abc.js").then(m=>m.mount(document.getElementById("root")))</script>')
      const SHELL = doc('Skeen', '<nav><a href="/">Home</a> <a>About</a> <a>Music</a> <a>Shows</a> <a>Merch</a> <a>Contact</a></nav><div id="root"></div><footer>Copyright 2026 Skeen. All rights reserved. Site by a friend. Follow us on Instagram, Spotify, Apple Music, Bandcamp and YouTube. Privacy policy. Terms.</footer><script src="/app.js"></script>')
      // A page with no words until its scripts run fails a test whose visitors include one that
      // runs no scripts, and passes one whose visitors all run them (Google, Bing, Apple). Which is
      // which comes from bots.ts. (verify-found F3, F4)
      it.each<[string, Fixture, RegExp]>([
        ['an empty page that loads its app', { pages: { '/': EMPTY_SHELL, '/about': ABOUT } }, /shows almost no words until it finishes loading/],
        ['an empty page whose app is written inline', { pages: { '/': INLINE, '/about': INLINE } }, /shows almost no words until it finishes loading/],
        ['a menu and footer (about 30 words) around an empty app', { pages: { '/': SHELL, '/about': SHELL } }, /none of your bio, releases or shows are on your pages until they finish loading/],
      ])('%s: fails only where a visitor runs no scripts', (_name, f, said) => {
        const r = run(test, f)
        if (readsWithoutScripts(test)) expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(said) })
        else expect(r.status).toBe('pass')
      })
      // A page with almost no words and no scripts has nothing for anyone to read. (verify-found F3)
      it('a blank page with no scripts: fail for every bot', () => {
        expect(run(test, { pages: { '/': doc('Skeen', ''), '/about': ABOUT } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/almost no words for anyone to read/) })
      })
    })

    describe('the settings file (robots.txt)', () => {
      // A rule for this bot by name is a fail, with the rule itself in the details.
      it('a rule that keeps this bot off a page: fail, the rule in the details', () => {
        const r = run(test, { robots: { status: 200, body: `User-agent: *\nAllow: /\n\nUser-agent: ${token}\nDisallow: /about\n` } })
        expect(r).toMatchObject({ status: 'fail', value: '1 of 2 pages', sentence: expect.stringMatching(/settings for search engines ask .+ to stay away from your page \/about/) })
        expect(details(r)).toContain(`Disallow: /about (for ${token}, on /about)`)
      })
      // A rule for everyone keeps every page out.
      it('a rule that keeps everyone off every page: fail, 0 pages', () => {
        const r = run(test, { robots: { status: 200, body: 'User-agent: *\nDisallow: /\n' } })
        expect(r).toMatchObject({ status: 'fail', value: '0 of 2 pages' })
        expect(details(r)).toContain('Disallow: / (for everyone, on /)')
      })
      // A server error on the settings file makes Google (and the standard) stay away from the
      // whole site: a fail we saw.
      it('the settings file answers with a server error: fail', () => {
        expect(run(test, { robots: { status: 503, body: null } })).toMatchObject({ status: 'fail', value: '0 of 2 pages', sentence: expect.stringMatching(/gives an error when search engines ask for its settings/) })
      })
      // No settings file at all means "no rules": fine.
      it('no settings file at all (404): pass', () => {
        expect(run(test, { robots: { status: 404, body: null } }).status).toBe('pass')
      })
      // A settings file we could not read may hold rules we didn't see: couldn't check, saying why.
      // (verify-found F14 for the redirect)
      it.each<[string, { status: number | null; body: string | null; error?: string }, RegExp]>([
        ['refused to us (403)', { status: 403, body: null }, /wouldn’t show us its settings/],
        ['too many visits (429)', { status: 429, body: null }, /wouldn’t show us its settings/],
        ['no answer', { status: null, body: null }, /settings for search engines didn’t answer/],
        ['a 200 with no body we could read', { status: 200, body: null }, /settings for search engines didn’t answer/],
        ['a redirect to another site', { status: null, body: null, error: 'not-allowed: https://cdn.other-host.net/robots.txt' }, /send visitors to another site \(cdn\.other-host\.net\)/],
      ])('%s: couldn’t check, saying why', (_name, robots, said) => {
        expect(run(test, { robots })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(said) })
      })
    })

    describe('a page that asks not to be listed', () => {
      const lower = token.toLowerCase()
      // Any "don't list me" the bot is sent, in the page or in the X-Robots-Tag header, for
      // everyone or for this bot by name, is a fail. (verify-found F15 comma date, F16 spaces)
      it.each<[string, Fixture]>([
        ['a robots meta tag with noindex', { pages: { '/': noindexMeta('robots', 'noindex, follow'), '/about': ABOUT } }],
        ['“none” in the header', { allBots: { '/about': { headers: { ...html, 'x-robots-tag': 'none' } } } }],
        ['noindex in the header, for this bot by name', { allBots: { '/': { headers: { ...html, 'x-robots-tag': `${lower}: noindex` } } } }],
        ['a meta tag for this bot by name', { pages: { '/': noindexMeta(lower), '/about': ABOUT } }],
        ['a past unavailable_after in the header', { allBots: { '/': { headers: { ...html, 'x-robots-tag': 'unavailable_after: Wed, 01 Jan 2025 00:00:00 GMT' } } } }],
        ['a past unavailable_after in a meta tag, its date holding a comma', { pages: { '/': noindexMeta('robots', 'unavailable_after: Wed, 01 Jan 2025 00:00:00 GMT'), '/about': ABOUT } }],
        ['“noindex nofollow” split by a space', { pages: { '/': noindexMeta('robots', 'noindex nofollow'), '/about': ABOUT } }],
      ])('%s: fail', (_name, f) => {
        expect(run(test, f)).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/asks .+ not to list it/) })
      })
      // Rules that don't hide the page, or hide it only from another bot, or only later, pass.
      it.each([
        ['noindex for another bot only', 'someotherbot: noindex, nofollow'],
        ['an unavailable_after still to come', 'unavailable_after: 2030-01-01'],
        ['nofollow, nosnippet and max-snippet', 'nofollow, max-snippet: 50, nosnippet'],
      ])('%s: pass', (_name, value) => {
        expect(run(test, { allBots: { '/': { headers: { ...html, 'x-robots-tag': value } } } }).status).toBe('pass')
      })
    })

    describe('a page cut at the size cap', () => {
      const cut = ABOUT.replace('<main>', '<main><!-- ').slice(0, ABOUT.indexOf('<main>') + 12)
      // A page over 1 MB is read only in part, and a comment cut open can hide the rest: it is
      // never judged on its words (it would look blank). (verify-found F17)
      it('a page read only in part: couldn’t check, not judged on its words', () => {
        const r = run(test, { plain: { '/about': { html: cut, truncated: true } }, allBots: { '/about': { html: cut, truncated: true } } })
        expect(r).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/over 1 MB/) })
      })
      // …but a "don't list me" in the part we did read is still seen. (verify-found F17)
      it('a noindex in the part we read: still a fail', () => {
        const page = ABOUT.replace('<head>', '<head><meta name="robots" content="noindex">')
        expect(run(test, { plain: { '/about': { html: page, truncated: true } }, allBots: { '/about': { html: page, truncated: true } } }).status).toBe('fail')
      })
    })
  })
})

describe('google', () => {
  // The exact words a manager reads when Google is turned away from one page.
  it('the sentence for a page that turned Google away, word for word', () => {
    expect(run('google', { bots: { googlebot: { '/about': { status: 403, html: null } } } }).sentence).toBe('your page /about turned away our visit using Google’s name (blocked).')
  })
  // A noindex for Googlebot only hides the page from Google, and from Gemini (it uses what
  // Googlebot fetched), but not from Bing or ChatGPT.
  it('a noindex for Googlebot only fails Google and Gemini, not Bing or ChatGPT', () => {
    const f = { pages: { '/': noindexMeta('googlebot'), '/about': ABOUT } }
    expect(run('google', f).status).toBe('fail')
    expect(run('others', f)).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/Gemini/) })
    expect(run('bing', f).status).toBe('pass')
    expect(run('chatgpt', f).status).toBe('pass')
  })
})

describe('bing', () => {
  // The exact words a manager reads when Bing is let in.
  it('the pass sentence, word for word', () => {
    expect(run('bing').sentence).toBe('Our visits using Bing’s name opened all 2 of your pages, and nothing asks Bing to stay away.')
  })
  // Copilot. Bing's robots tag list: noarchive = "Do not link in Chat and Copilot", in the page
  // or the header, for everyone or for Bing by name. It fails Bing only: the page is still listed
  // ("will still appear in our search results"), so Google's test doesn't move.
  it.each<[string, Fixture]>([
    ['a robots meta tag', { pages: { '/': noindexMeta('robots', 'noarchive'), '/about': ABOUT } }],
    ['a bingbot meta tag', { pages: { '/': noindexMeta('bingbot', 'noarchive'), '/about': ABOUT } }],
    ['the header', { allBots: { '/': { headers: { ...html, 'x-robots-tag': 'noarchive' } } } }],
  ])('noarchive in %s: fail, word for word, and only for Bing', (_name, f) => {
    const r = run('bing', f)
    expect(r).toMatchObject({ status: 'fail', value: '1 of 2 pages', sentence: 'your home page asks Copilot to leave it out of its answers.' })
    expect(details(r)).toMatch(/noarchive \(on \/\)/)
    expect(run('google', f).status).toBe('pass')
  })
  // What limits Copilot without keeping the page out is not a fail (there is no "warning"): the
  // pass says it. nocache = "Display only URL/Snippet/Title"; noarchive WITH nocache, Bing's own
  // example, = "we will treat it as NOCACHE"; nosnippet = no description. A noarchive for another
  // bot is not Bing's.
  const SHORT = 'A setting on your home page lets Copilot show only its title and a short line.'
  it.each<[string, Fixture, string]>([
    ['nocache in the header', { allBots: { '/': { headers: { ...html, 'x-robots-tag': 'nocache' } } } }, SHORT],
    ['noarchive for everyone with nocache for Bing', { pages: { '/': noindexMeta('robots', 'noarchive').replace('<head>', '<head><meta name="bingbot" content="nocache">'), '/about': ABOUT } }, SHORT],
    ['nosnippet in the header', { allBots: { '/': { headers: { ...html, 'x-robots-tag': 'nosnippet' } } } }, 'A setting on your home page asks Bing to show no description for it.'],
    ['noarchive for Google only', { allBots: { '/': { headers: { ...html, 'x-robots-tag': 'googlebot: noarchive' } } } }, ''],
  ])('%s: pass, saying what it limits', (_name, f, said) => {
    const r = run('bing', f)
    expect(r.status).toBe('pass')
    expect(r.sentence).toBe(`Our visits using Bing’s name opened all 2 of your pages, and nothing asks Bing to stay away.${said ? ` ${said}` : ''}`)
  })
})

describe('chatgpt', () => {
  const GPTBOT_OUT = { status: 200, body: `${ROBOTS_OK}\nUser-agent: GPTBot\nDisallow: /\n` }
  // Turning away only ChatGPT's training visitor is the site's choice, and search still works:
  // an "Almost", worded exactly, with the name kept capitalised. (verify-found F6)
  it('only the training visitor asked to stay away: “Almost”, word for word', () => {
    const r = run('chatgpt', { robots: GPTBOT_OUT })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost', value: 'only learning blocked' })
    expect(r.sentence).toBe('your site asks ChatGPT not to learn from it. That’s your choice: nothing we saw turns ChatGPT search away.')
  })
  // Asking the SEARCH visitor to stay away is a plain fail: it hides the artist from ChatGPT search.
  it('the search visitor asked to stay away: a plain fail', () => {
    const r = run('chatgpt', { robots: { status: 200, body: `${ROBOTS_OK}\nUser-agent: OAI-SearchBot\nDisallow: /\n` } })
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
  })
  // "Only learning is blocked" is said only when the search visitors really got in: silent or
  // refused, it is a plain fail. (verify-found F7)
  it.each<[string, Record<string, Partial<SeoPageFetch>>]>([
    ['got no answer', { '/': { status: null, html: null, error: 'timeout' }, '/about': { status: null, html: null, error: 'timeout' } }],
    ['was refused', { '/': { status: 403, html: null } }],
  ])('training visitor asked to stay away while the search visitor %s: a plain fail, never “Almost”', (_name, visit) => {
    const r = run('chatgpt', { robots: GPTBOT_OUT, bots: { 'oai-searchbot': visit, 'chatgpt-user': visit } })
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
    expect(r.sentence).not.toMatch(/nothing we saw/)
  })
})

describe('claude', () => {
  // A failure every Claude visitor shares is a plain fail, not "only the training visitor", in
  // these exact words. (verify-found F8)
  it('a “page not found” for all three Claude visitors: a plain fail, word for word', () => {
    const r = run('claude', { pages: { '/': HOME, '/about': doc('Page not found · Skeen', '<main><h1>Page not found</h1><p>Sorry.</p></main>') } })
    expect(r).toMatchObject({ status: 'fail', value: '1 of 2 pages' })
    expect(r.lead).toBeUndefined()
    expect(r.sentence).toBe('your page /about says “page not found”.')
  })
})

describe('perplexity', () => {
  // The exact words a manager reads when Perplexity can't read a page built by its scripts.
  it('the sentence for a page empty until its scripts run, word for word', () => {
    expect(run('perplexity', { pages: { '/': EMPTY_SHELL, '/about': ABOUT } }).sentence).toBe('your home page shows almost no words until it finishes loading, and Perplexity search doesn’t wait for that.')
  })
})

describe('others (Gemini, Apple and Common Crawl)', () => {
  // medium.com, as seen: Apple Intelligence asked to stay away by a rule and Common Crawl refused
  // by the server. Both only train AI: "Almost", in these exact words ("turns away", since one was
  // a refusal, not a request).
  it('Apple Intelligence asked and Common Crawl refused: “Almost”, word for word', () => {
    const robots = { status: 200, body: 'User-agent: Applebot-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /\n' }
    const r = run('others', { robots, bots: { ccbot: { '/': { status: 403, html: null }, '/about': { status: 403, html: null } } } })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost' })
    expect(r.sentence).toBe('your site turns away Apple Intelligence and Common Crawl (they only gather pages to train AI). Nothing we saw turns Gemini, Apple, Meta AI, Alexa or DuckDuckGo away.')
  })
  // Gemini's name (Google-Extended) is a settings-only name: asking it to stay away fails
  // "others", naming Gemini, and does not touch Google's own test.
  it('Google-Extended asked to stay away: fails “others” (Gemini), not Google', () => {
    const robots = { status: 200, body: `${ROBOTS_OK}\nUser-agent: Google-Extended\nDisallow: /\n` }
    expect(run('others', { robots })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/Gemini/) })
    expect(run('google', { robots }).status).toBe('pass')
  })
  // Gemini reads what Googlebot fetched, so a Googlebot rule always reaches it. Apple follows
  // Googlebot's rules only when it has none of its own (Apple's doc): the details show whether
  // the rule was read for Applebot.
  it('a Googlebot rule fails Gemini always, and Apple only when Apple has no rules of its own', () => {
    const withApple = run('others', { robots: { status: 200, body: 'User-agent: Googlebot\nDisallow: /about\n\nUser-agent: Applebot\nAllow: /\n' } })
    expect(withApple).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/Gemini/) })
    expect(details(withApple)).not.toContain('for Applebot')
    const withoutApple = run('others', { robots: { status: 200, body: 'User-agent: Googlebot\nDisallow: /about\n' } })
    expect(details(withoutApple)).toContain('Disallow: /about (for Applebot, on /about)')
  })
  // A noindex seen only on Googlebot's copy is blamed on Gemini, the one that reads that copy,
  // never on Apple or Common Crawl. (verify-found F18)
  it('a noindex on Googlebot’s copy only: blamed on Gemini, not Apple or Common Crawl', () => {
    const r = run('others', { bots: { googlebot: { '/about': { html: ABOUT.replace('<head>', '<head><meta name="googlebot" content="noindex">') } } } })
    expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/Gemini/) })
    expect(r.sentence).not.toMatch(/Apple|Common Crawl/)
  })
  // Alexa. Amazon: when robots.txt doesn't name Amzn-SearchBot but lets other search bots in, it
  // follows "the robots.txt directives given to other search bots", without saying which. A file
  // that lets every other crawler in by name and keeps `*` out can't be read for Alexa: couldn't
  // tell, never a fail. The groups come from the bot list, so a crawler added there is named too.
  it('CRITICAL: other crawlers let in by name, everyone else kept out: Alexa is “couldn’t tell”, not a fail', () => {
    const alexa = SEO_BOTS.find((b) => b.robotsToken === 'Amzn-SearchBot')!
    const named = [...new Set(SEO_BOTS.filter((b) => b !== alexa).map((b) => b.robotsToken))]
    const body = `${named.map((t) => `User-agent: ${t}\nAllow: /\n`).join('\n')}\nUser-agent: *\nDisallow: /\n`
    const r = run('others', { robots: { status: 200, body } })
    expect(r).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/Alexa/) })
    expect(r.sentence).not.toMatch(/stay away/)
    // The witness: the same file naming Alexa and keeping it out IS a fail, for Alexa.
    const namedOut = run('others', { robots: { status: 200, body: `${body}\nUser-agent: ${alexa.robotsToken}\nDisallow: /\n` } })
    expect(namedOut).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/ask Alexa to stay away/) })
    // …and when no other crawler is let in there either, whichever rules Alexa follows keep it out.
    const allOut = `${named.map((t) => `User-agent: ${t}\nAllow: /\nDisallow: /about\n`).join('\n')}\nUser-agent: *\nDisallow: /about\n`
    expect(details(run('others', { robots: { status: 200, body: allOut } }))).toContain('ask Alexa to stay away from your page /about')
  })
  // Common Crawl asked to stay away by a rule: "Almost", with no made-up "Common Crawl search"
  // and a value that doesn't read as "nothing opened". (verify-found F6)
  it('Common Crawl asked to stay away: “Almost”, without “Crawl search” or “0 of”', () => {
    const r = run('others', { robots: { status: 200, body: 'User-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' } })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost', value: 'only learning blocked' })
    expect(r.sentence).not.toMatch(/Crawl search/i)
  })
  // A page empty until its scripts run fails on Common Crawl's account only (Apple and Google run
  // scripts). It is "Almost", but NOT the site's choice, so never called one. (verify-found F6)
  it('a page empty until its scripts run: “Almost” on Common Crawl’s account, never called a choice', () => {
    const r = run('others', { bots: { ccbot: { '/': { html: EMPTY_SHELL } } } })
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost', value: '1 of 2 pages', sentence: expect.stringMatching(/Common Crawl doesn’t wait/) })
    expect(r.sentence).not.toMatch(/choice|nothing we saw/)
  })
})
