/**
 * robots.txt, read the way RFC 9309 and Google's own spec say (STRICT: a parser, AGENTS.md).
 * The fixtures are the documents' OWN examples, copied from
 *   https://www.rfc-editor.org/rfc/rfc9309  (figures 2-6, section 5)
 *   https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec  (the tables)
 * so the test checks the reading against the standard, not against this implementation.
 */
import { describe, expect, it } from 'vitest'
import { checkRobots, isAllowed, matchesPath, parseRobots, robotsVerdict } from '@/lib/seo-tests/robots-txt'

describe('RFC 9309 examples', () => {
  const SIMPLE = [
    'User-Agent: *',
    'Disallow: *.gif$',
    'Disallow: /example/',
    'Allow: /publications/',
    '',
    'User-Agent: foobot',
    'Disallow:/',
    'Allow:/example/page.html',
    'Allow:/example/allowed.gif',
    '',
    'User-Agent: barbot',
    'User-Agent: bazbot',
    'Disallow: /example/page.html',
    '',
    'User-Agent: quxbot',
    '',
    'EOF',
  ].join('\n')

  it('5.1 "*": .gif files and /example/ are out, /publications/ is in, for a bot with no group', () => {
    expect(isAllowed(SIMPLE, 'SomeBot', '/pics/cat.gif')).toBe(false)
    expect(isAllowed(SIMPLE, 'SomeBot', '/cat.gif?x=1')).toBe(true) // `$` ends the match
    expect(isAllowed(SIMPLE, 'SomeBot', '/example/anything')).toBe(false)
    expect(isAllowed(SIMPLE, 'SomeBot', '/publications/one')).toBe(true)
    expect(isAllowed(SIMPLE, 'SomeBot', '/other')).toBe(true)
  })
  it('5.1 foobot: only its two allowed paths (no space after the colon is fine)', () => {
    expect(isAllowed(SIMPLE, 'foobot', '/')).toBe(false)
    expect(isAllowed(SIMPLE, 'foobot', '/example/page.html')).toBe(true)
    expect(isAllowed(SIMPLE, 'foobot', '/example/allowed.gif')).toBe(true)
    expect(isAllowed(SIMPLE, 'foobot', '/example/other.html')).toBe(false)
    expect(isAllowed(SIMPLE, 'foobot', '/publications/one')).toBe(false) // the * group is NOT added
  })
  it('5.1 barbot and bazbot share one group; the * group does not apply to them', () => {
    for (const bot of ['barbot', 'bazbot']) {
      expect(isAllowed(SIMPLE, bot, '/example/page.html')).toBe(false)
      expect(isAllowed(SIMPLE, bot, '/example/other')).toBe(true)
      expect(isAllowed(SIMPLE, bot, '/x.gif')).toBe(true)
    }
  })
  it('5.1 quxbot: an empty last group allows everything', () => {
    expect(isAllowed(SIMPLE, 'quxbot', '/example/x')).toBe(true)
    expect(isAllowed(SIMPLE, 'quxbot', '/x.gif')).toBe(true)
  })
  it('5.2 the longest match wins', () => {
    const body = 'User-Agent: foobot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif'
    expect(isAllowed(body, 'foobot', '/example/page/disallowed.gif')).toBe(false)
    expect(isAllowed(body, 'foobot', '/example/page/other.gif')).toBe(true)
  })
  it('figure 2: two groups for the same token are merged', () => {
    const body = 'user-agent: ExampleBot\ndisallow: /foo\ndisallow: /bar\n\nuser-agent: ExampleBot\ndisallow: /baz'
    for (const p of ['/foo', '/bar', '/baz']) expect(isAllowed(body, 'ExampleBot', p)).toBe(false)
    expect(isAllowed(body, 'ExampleBot', '/qux')).toBe(true)
  })
  it('figure 3: no group of its own → the * group', () => {
    const body = 'user-agent: *\ndisallow: /foo\ndisallow: /bar\n\nuser-agent: BazBot\ndisallow: /baz'
    expect(isAllowed(body, 'ExampleBot', '/foo')).toBe(false)
    expect(isAllowed(body, 'ExampleBot', '/baz')).toBe(true)
  })
  it('no matching group and no * group: no rules apply', () => {
    expect(isAllowed('user-agent: BazBot\ndisallow: /', 'ExampleBot', '/anything')).toBe(true)
    expect(isAllowed('', 'ExampleBot', '/anything')).toBe(true)
  })
  it('figure 4: percent-encoding is compared in one canonical form', () => {
    expect(isAllowed('user-agent: *\ndisallow: /foo/bar/ツ', 'x', '/foo/bar/%E3%83%84')).toBe(false)
    expect(isAllowed('user-agent: *\ndisallow: /foo/bar/%E3%83%84', 'x', '/foo/bar/%e3%83%84')).toBe(false)
    expect(isAllowed('user-agent: *\ndisallow: /foo/bar/%62%61%7A', 'x', '/foo/bar/baz')).toBe(false)
    expect(isAllowed('user-agent: *\ndisallow: /foo/bar/baz', 'x', '/foo/bar/%62%61%7A')).toBe(false)
    expect(isAllowed('user-agent: *\ndisallow: /foo/bar?baz=quz', 'x', '/foo/bar?baz=quz')).toBe(false)
    expect(isAllowed('user-agent: *\ndisallow: /foo/bar?baz=https%3A%2F%2Ffoo.bar', 'x', '/foo/bar?baz=https%3A%2F%2Ffoo.bar')).toBe(false)
  })
  it('figure 6: %2A and %24 in a pattern are a literal * and $', () => {
    expect(isAllowed('user-agent: *\ndisallow: /path/file-with-a-%2A.html', 'x', '/path/file-with-a-*.html')).toBe(false)
    expect(isAllowed('user-agent: *\ndisallow: /path/file-with-a-%2A.html', 'x', '/path/file-with-a-b.html')).toBe(true)
    expect(isAllowed('user-agent: *\ndisallow: /path/foo-%24', 'x', '/path/foo-$')).toBe(false)
  })
  it('2.2.2: an allow and a disallow of equal length → allow', () => {
    expect(isAllowed('user-agent: *\ndisallow: /folder\nallow: /folder', 'x', '/folder/page')).toBe(true)
  })
  it('2.2.2: /robots.txt itself is always allowed', () => {
    expect(isAllowed('user-agent: *\ndisallow: /', 'x', '/robots.txt')).toBe(true)
    expect(isAllowed('user-agent: *\ndisallow: /', 'x', '/robots.txtx')).toBe(false)
  })
  it('2.2.2: rules before the first user-agent line belong to no group', () => {
    expect(isAllowed('disallow: /\nuser-agent: *\ndisallow: /private', 'x', '/public')).toBe(true)
    expect(isAllowed('disallow: /\nuser-agent: *\ndisallow: /private', 'x', '/private')).toBe(false)
  })
  it('2.2.1: the user-agent match is case-insensitive; field names too; paths are not', () => {
    const body = 'USER-AGENT: GoogleBot\nDISALLOW: /Private'
    expect(isAllowed(body, 'googlebot', '/Private')).toBe(false)
    expect(isAllowed(body, 'GOOGLEBOT', '/Private')).toBe(false)
    expect(isAllowed(body, 'googlebot', '/private')).toBe(true)
  })
  it('2.2.4: a Sitemap line does not end a group (Google\'s a / sitemap / b example)', () => {
    const body = 'user-agent: a\nsitemap: https://example.com/sitemap.xml\nuser-agent: b\ndisallow: /'
    expect(isAllowed(body, 'a', '/x')).toBe(false)
    expect(isAllowed(body, 'b', '/x')).toBe(false)
    expect(parseRobots(body).sitemaps).toEqual(['https://example.com/sitemap.xml'])
  })
})

describe("Google's robots.txt spec examples", () => {
  const GROUPS = 'user-agent: googlebot-news\ndisallow: /g1\n\nuser-agent: *\ndisallow: /g2\n\nuser-agent: googlebot\ndisallow: /g3'
  it('the most specific group wins; order in the file does not matter', () => {
    expect(isAllowed(GROUPS, 'googlebot-news', '/g1')).toBe(false)
    expect(isAllowed(GROUPS, 'googlebot-news', '/g3')).toBe(true)
    expect(isAllowed(GROUPS, 'googlebot', '/g3')).toBe(false)
    expect(isAllowed(GROUPS, 'googlebot', '/g1')).toBe(true)
    expect(isAllowed(GROUPS, 'Storebot-Google', '/g2')).toBe(false)
    expect(isAllowed(GROUPS, 'Storebot-Google', '/g3')).toBe(true)
  })
  it('groups for one agent merge; a specific group and * are not combined', () => {
    const body = 'user-agent: googlebot-news\ndisallow: /fish\n\nuser-agent: *\ndisallow: /carrots\n\nuser-agent: googlebot-news\ndisallow: /shrimp'
    expect(isAllowed(body, 'googlebot-news', '/fish')).toBe(false)
    expect(isAllowed(body, 'googlebot-news', '/shrimp')).toBe(false)
    expect(isAllowed(body, 'googlebot-news', '/carrots')).toBe(true)
    expect(isAllowed(body, 'otherbot', '/carrots')).toBe(false)
  })
  it('"googlebot/1.2" and "googlebot*" are both the googlebot group', () => {
    expect(isAllowed('user-agent: googlebot/1.2\ndisallow: /a', 'Googlebot', '/a')).toBe(false)
    expect(isAllowed('user-agent: googlebot*\ndisallow: /a', 'Googlebot', '/a')).toBe(false)
    // …and a longer name is NOT a match for the shorter crawler (no prefix matching).
    expect(isAllowed('user-agent: googlebot-news\ndisallow: /a', 'Googlebot', '/a')).toBe(true)
  })
  it('a rule with no path is ignored', () => {
    expect(isAllowed('user-agent: *\ndisallow:', 'x', '/anything')).toBe(true)
    expect(isAllowed('user-agent: *\nallow:\ndisallow: /', 'x', '/anything')).toBe(false)
  })

  // The URL matching table, row by row.
  const TABLE: [string, string[], string[]][] = [
    ['/', ['/', '/anything', '/a/b?c'], []],
    ['/*', ['/', '/anything'], []],
    ['/$', ['/'], ['/page', '/?x']],
    ['/fish', ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'], ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish']],
    ['/fish*', ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fishheads/yummy.html', '/fish.php?id=anything'], ['/Fish.asp', '/catfish', '/?id=fish', '/desert/fish']],
    ['/fish/', ['/fish/', '/fish/?id=anything', '/fish/salmon.htm'], ['/fish', '/fish.html', '/animals/fish/', '/Fish/Salmon.asp']],
    ['/*.php', ['/index.php', '/filename.php', '/folder/filename.php', '/folder/filename.php?parameters', '/folder/any.php.file.html', '/filename.php/'], ['/', '/windows.PHP']],
    ['/*.php$', ['/filename.php', '/folder/filename.php'], ['/filename.php?parameters', '/filename.php/', '/filename.php5', '/windows.PHP']],
    ['/fish*.php', ['/fish.php', '/fishheads/catfish.php?parameters'], ['/Fish.PHP']],
  ]
  for (const [pattern, yes, no] of TABLE) {
    it(`matching table: ${pattern}`, () => {
      for (const p of yes) expect([p, matchesPath(pattern, p)]).toEqual([p, true])
      for (const p of no) expect([p, matchesPath(pattern, p)]).toEqual([p, false])
    })
  }

  // The order-of-precedence table, row by row.
  const PRECEDENCE: [string, string, boolean][] = [
    ['/page', 'allow: /p\ndisallow: /', true],
    ['/folder/page', 'allow: /folder\ndisallow: /folder', true],
    ['/page.htm', 'allow: /page\ndisallow: /*.htm', false],
    ['/page.php5', 'allow: /page\ndisallow: /*.ph', true],
    ['/', 'allow: /$\ndisallow: /', true],
    ['/page.htm', 'allow: /$\ndisallow: /', false],
  ]
  for (const [path, rules, allowed] of PRECEDENCE) {
    it(`precedence table: ${path} with ${rules.replace('\n', ' / ')}`, () => {
      expect(isAllowed(`user-agent: *\n${rules}`, 'Googlebot', path)).toBe(allowed)
    })
  }

  it('ignores a leading byte order mark, comments, CR and CRLF line ends', () => {
    expect(isAllowed('\uFEFFuser-agent: *\r\ndisallow: /a # not /b\r\n', 'x', '/a')).toBe(false)
    expect(isAllowed('\uFEFFuser-agent: *\r\ndisallow: /a # not /b\r\n', 'x', '/b')).toBe(true)
    expect(isAllowed('user-agent: *\rdisallow: /a\r', 'x', '/a')).toBe(false)
    expect(isAllowed('# user-agent: *\n# disallow: /\nuser-agent: *\ndisallow: /a', 'x', '/b')).toBe(true)
  })
  it('reads the colon-less and misspelt lines Google\'s own parser accepts', () => {
    expect(isAllowed('user-agent *\ndisallow /a', 'x', '/a')).toBe(false)
    expect(isAllowed('useragent: *\ndissallow: /a', 'x', '/a')).toBe(false)
    // …but not a line with more than one gap, which is a sentence, not a rule.
    expect(isAllowed('user-agent: *\ndisallow the whole site please', 'x', '/the')).toBe(true)
  })
  it('html served as robots.txt yields no rules (Google parses it and ignores what is not a rule)', () => {
    const html = '<!doctype html><html><head><title>Home</title></head><body><p>Disallow: /</p></body></html>'
    expect(isAllowed(html, 'Googlebot', '/')).toBe(true)
    expect(parseRobots(html).groups).toEqual([])
  })
  it('reads only the first 500 KiB, like Google: a rule after that is ignored', () => {
    const filler = `# ${'x'.repeat(1000)}\n`.repeat(520) // ~520 KB of comments
    const body = `user-agent: *\ndisallow: /early\n${filler}disallow: /late\n`
    expect(isAllowed(body, 'x', '/early')).toBe(false)
    expect(isAllowed(body, 'x', '/late')).toBe(true)
    expect(parseRobots(body).truncated).toBe(true)
  })
  // A backtracking (regex) matcher does not fail this test, it HANGS the run (seen 2026-09-28
  // when the matcher was swapped for one by hand), which fails CI all the same.
  it('a 5 MB file and a pattern full of stars stay fast (no runaway matching)', () => {
    const big = 'user-agent: *\n' + 'disallow: /a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b\n'.repeat(100_000)
    const t = Date.now()
    expect(isAllowed(big, 'x', `/${'a'.repeat(200)}`)).toBe(true)
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('fallback tokens (Applebot follows Googlebot when it has no group of its own)', () => {
  it('uses the first token that has a group, then *', () => {
    const body = 'user-agent: Googlebot\ndisallow: /g\n\nuser-agent: *\ndisallow: /star'
    expect(isAllowed(body, ['Applebot', 'Googlebot'], '/g')).toBe(false)
    expect(isAllowed(body, ['Applebot', 'Googlebot'], '/star')).toBe(true)
    const own = 'user-agent: Applebot\ndisallow: /a\n\nuser-agent: Googlebot\ndisallow: /g'
    expect(isAllowed(own, ['Applebot', 'Googlebot'], '/g')).toBe(true)
    expect(isAllowed(own, ['Applebot', 'Googlebot'], '/a')).toBe(false)
  })
})

describe('checkRobots names the rule that decided', () => {
  it('reports the rule and the group it came from', () => {
    const parsed = parseRobots('user-agent: *\nallow: /\n\nuser-agent: GPTBot\ndisallow: /about')
    expect(checkRobots(parsed, 'GPTBot', '/about')).toEqual({ allowed: false, group: 'gptbot', rule: { allow: false, pattern: '/about' } })
    expect(checkRobots(parsed, 'ClaudeBot', '/about')).toEqual({ allowed: true, group: '*', rule: { allow: true, pattern: '/' } })
    expect(checkRobots(parsed, 'ClaudeBot', '/robots.txt')).toEqual({ allowed: true, group: null, rule: null })
  })
})

describe('robotsVerdict: what the answer to /robots.txt means', () => {
  const RULES = 'user-agent: *\ndisallow: /private'
  it('200: the rules decide', () => {
    expect(robotsVerdict({ status: 200, body: RULES }, 'x', '/private').verdict).toBe('blocked')
    expect(robotsVerdict({ status: 200, body: RULES }, 'x', '/public').verdict).toBe('allowed')
  })
  it('404 / 410: there is no file, so nothing is blocked (RFC 2.3.1.3, Google)', () => {
    for (const status of [404, 410, 400]) {
      expect(robotsVerdict({ status, body: null }, 'x', '/private')).toMatchObject({ verdict: 'allowed', why: 'no-file' })
    }
  })
  it('5xx: Google and the RFC assume the whole site is off limits', () => {
    for (const status of [500, 503]) {
      expect(robotsVerdict({ status, body: null }, 'x', '/')).toMatchObject({ verdict: 'blocked', why: 'server-error' })
    }
  })
  it('401 / 403 / 429 / no answer: we could not read it, so we cannot say', () => {
    for (const status of [401, 403, 429, null]) {
      expect(robotsVerdict({ status, body: null }, 'x', '/').verdict).toBe('unknown')
    }
  })
})
