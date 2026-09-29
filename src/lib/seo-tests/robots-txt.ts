/**
 * robots.txt, read the way the standard and Google read it:
 *   RFC 9309  https://www.rfc-editor.org/rfc/rfc9309
 *   Google    https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
 * and, where those are silent, Google's open-source parser (github.com/google/robotstxt).
 *
 *   groups     consecutive `user-agent` lines share the rules that follow them. A `sitemap`
 *              or any unknown line does NOT end a group. Rules before the first user-agent
 *              line belong to no group and are ignored.
 *   choosing   the crawler's own token (case-insensitive, exact: "googlebot-news" is not
 *              "googlebot") beats `*`. Every group for the chosen token is merged; the token's
 *              groups and `*` are never combined. `googlebot/1.2` and `googlebot*` are read as
 *              `googlebot` (Google: "All non-matching text is ignored").
 *   rules      the longest matching pattern wins; an allow and a disallow of the same length →
 *              allow. `*` = any run of characters, `$` at the end = end of the path. A rule with
 *              no path is ignored. Paths are case-sensitive. /robots.txt is always allowed.
 *   encoding   both sides are compared percent-encoded: raw UTF-8 is encoded, an encoded
 *              unreserved character (%62 = b) is decoded, hex is upper-cased, and a literal *
 *              or $ in the PATH is %2A / %24 (RFC figure 6).
 *   the file   a leading byte order mark, comments and CR / LF / CRLF line ends are fine.
 *              Only the first 500 KiB is read (Google's limit; the RFC's minimum).
 *   answers    see `robotsVerdict`.
 */

export type RobotsRule = { allow: boolean; pattern: string }
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] }
export type ParsedRobots = {
  groups: RobotsGroup[]
  /** Every `Sitemap:` value, in file order (not tied to any group). */
  sitemaps: string[]
  /** The file was longer than 500 KiB and the rest was ignored. */
  truncated: boolean
}

/** Google: "Google enforces a robots.txt file size limit of 500 kibibytes (KiB)." */
export const ROBOTS_MAX_BYTES = 500 * 1024

/** The spellings Google's parser accepts for each field (google/robotstxt, robots.cc). */
const USER_AGENT = new Set(['user-agent', 'useragent', 'user agent'])
const ALLOW = new Set(['allow'])
const DISALLOW = new Set(['disallow', 'dissallow', 'dissalow', 'disalow', 'diasllow', 'disallaw'])
const SITEMAP = new Set(['sitemap', 'site-map'])

/** The first 500 KiB of the file, cut on a byte boundary. */
function capped(body: string): { text: string; truncated: boolean } {
  // A string of N characters is at least N bytes, so a short one needs no encoding pass.
  if (body.length * 3 <= ROBOTS_MAX_BYTES) return { text: body, truncated: false }
  const bytes = new TextEncoder().encode(body)
  if (bytes.length <= ROBOTS_MAX_BYTES) return { text: body, truncated: false }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, ROBOTS_MAX_BYTES)), truncated: true }
}

/** "key: value" (or Google's colon-less "key value", when there are exactly two words). */
function keyValue(line: string): [string, string] | null {
  const colon = line.indexOf(':')
  if (colon >= 0) return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]
  const m = /^(\S+)[ \t]+(\S+)$/.exec(line)
  return m ? [m[1].toLowerCase(), m[2]] : null
}

/** "googlebot/1.2" → "googlebot"; "*" → "*". Lower-cased. Empty = matches no crawler. */
function agentToken(value: string): string {
  if (value === '*' || /^\*\s/.test(value)) return '*'
  return (/^[A-Za-z_-]+/.exec(value)?.[0] ?? '').toLowerCase()
}

export function parseRobots(body: string): ParsedRobots {
  const { text, truncated } = capped(body ?? '')
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []
  let current: RobotsGroup | null = null
  /** true while the last group line read was a user-agent line (so another one joins it). */
  let collectingAgents = false
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const hash = raw.indexOf('#')
    // trim() also strips a byte order mark (U+FEFF is whitespace to JavaScript).
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim()
    if (!line) continue
    const kv = keyValue(line)
    if (!kv) continue
    const [key, value] = kv
    if (USER_AGENT.has(key)) {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(agentToken(value))
      collectingAgents = true
    } else if (ALLOW.has(key) || DISALLOW.has(key)) {
      collectingAgents = false
      // RFC 2.2.2: a rule before any user-agent line is in no group. Google: "Crawlers
      // ignore rules without a [path]".
      if (!current || !value) continue
      current.rules.push({ allow: ALLOW.has(key), pattern: value })
    } else if (SITEMAP.has(key)) {
      if (value) sitemaps.push(value)
    }
    // Anything else (crawl-delay, host, html…) is ignored and does not end a group.
  }
  // A group whose agent did not parse ("") is kept: no crawler token is "", so it is never chosen.
  return { groups, sitemaps, truncated }
}

const HEX = '0123456789ABCDEF'
const UNRESERVED = /[A-Za-z0-9\-._~]/

/**
 * One canonical percent-encoded form, so "ツ", "%E3%83%84" and "%e3%83%84" compare equal and
 * "%62" equals "b". In a PATTERN, `*` and `$` stay special; in a PATH they are literal
 * characters and are encoded (%2A, %24) so a pattern's %2A matches them (RFC figure 6).
 */
function canonical(s: string, isPattern: boolean): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '%' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      const byte = Number.parseInt(s.slice(i + 1, i + 3), 16)
      const c = String.fromCharCode(byte)
      out += byte < 0x80 && UNRESERVED.test(c) ? c : `%${s.slice(i + 1, i + 3).toUpperCase()}`
      i += 2
      continue
    }
    const code = ch.charCodeAt(0)
    if (code < 0x80) {
      out += !isPattern && (ch === '*' || ch === '$') ? `%${HEX[code >> 4]}${HEX[code & 15]}` : ch
      continue
    }
    // Non-ASCII: its UTF-8 bytes, percent-encoded. Take a surrogate pair whole.
    const cp = s.codePointAt(i)!
    const whole = String.fromCodePoint(cp)
    for (const b of new TextEncoder().encode(whole)) out += `%${HEX[b >> 4]}${HEX[b & 15]}`
    i += whole.length - 1
  }
  return out
}

/**
 * Does a (canonical) pattern match a (canonical) path? Google's algorithm: a set of positions
 * in the path, advanced one pattern character at a time. O(pattern × path), so a pattern full
 * of stars cannot run away the way a naive regex can.
 */
function matchCanonical(pattern: string, path: string): boolean {
  let pos: number[] = [0]
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '$' && i === pattern.length - 1) return pos[pos.length - 1] === path.length
    if (c === '*') {
      const from = pos[0]
      pos = []
      for (let p = from; p <= path.length; p++) pos.push(p)
      continue
    }
    const next: number[] = []
    for (const p of pos) if (p < path.length && path[p] === c) next.push(p + 1)
    if (next.length === 0) return false
    pos = next
  }
  return true
}

/** Does this robots.txt path pattern match this URL path (path + query)? */
export function matchesPath(pattern: string, path: string): boolean {
  return matchCanonical(canonical(pattern, true), canonical(path, false))
}

export type RobotsCheck = {
  allowed: boolean
  /** The agent whose group decided ("*" or a lower-cased token), null = no group applied. */
  group: string | null
  /** The rule that decided, null = no rule matched (allowed). */
  rule: RobotsRule | null
}

/**
 * The rules for a crawler that answers to `tokens`, in order: the first token with a group of
 * its own wins (Applebot → Googlebot), else `*`, else none.
 */
function rulesFor(parsed: ParsedRobots, tokens: string | readonly string[]): { group: string | null; rules: RobotsRule[] } {
  const list = (typeof tokens === 'string' ? [tokens] : tokens).map((t) => t.toLowerCase())
  for (const token of [...list, '*']) {
    const matching = parsed.groups.filter((g) => g.agents.includes(token))
    if (matching.length) return { group: token, rules: matching.flatMap((g) => g.rules) }
  }
  return { group: null, rules: [] }
}

export function checkRobots(parsed: ParsedRobots, tokens: string | readonly string[], path: string): RobotsCheck {
  const canonPath = canonical(path || '/', false)
  if (canonPath === '/robots.txt') return { allowed: true, group: null, rule: null }
  const { group, rules } = rulesFor(parsed, tokens)
  let best: RobotsRule | null = null
  let bestLen = -1
  for (const rule of rules) {
    const pattern = canonical(rule.pattern, true)
    if (!matchCanonical(pattern, canonPath)) continue
    // Longest wins; on a tie, allow (RFC 2.2.2, Google "least restrictive").
    if (pattern.length > bestLen || (pattern.length === bestLen && rule.allow && !best!.allow)) {
      best = rule
      bestLen = pattern.length
    }
  }
  return { allowed: best ? best.allow : true, group, rule: best }
}

export function isAllowed(robotsBody: string, token: string | readonly string[], path: string): boolean {
  return checkRobots(parseRobots(robotsBody), token, path).allowed
}

export type RobotsVerdict = {
  verdict: 'allowed' | 'blocked' | 'unknown'
  /**
   *   rules         the file was read; `check` says which rule decided
   *   no-file       404 / 410 / other 4xx: "the crawler MAY access any resources" (RFC)
   *   server-error  5xx: "the crawler MUST assume complete disallow" (RFC); Google stops too
   *   not-shown     401 / 403: the file exists but was refused to US. Google would treat it as
   *                 no file, but a firewall may show the real crawler a real file, so we
   *                 cannot say what it contains.
   *   slow-down     429: Google treats it like a server error, but it was OUR visit that was
   *                 rate-limited, so it says nothing about the real crawler.
   *   no-answer     no answer at all (refused before it left, timed out, too many redirects)
   */
  why: 'rules' | 'no-file' | 'server-error' | 'not-shown' | 'slow-down' | 'no-answer'
  check?: RobotsCheck
}

export function robotsVerdict(
  robots: { status: number | null; body: string | null },
  tokens: string | readonly string[],
  path: string,
): RobotsVerdict {
  const s = robots.status
  if (s == null) return { verdict: 'unknown', why: 'no-answer' }
  if (s >= 500) return { verdict: 'blocked', why: 'server-error' }
  if (s === 429) return { verdict: 'unknown', why: 'slow-down' }
  if (s === 401 || s === 403) return { verdict: 'unknown', why: 'not-shown' }
  // A redirect that could not be followed: Google treats a robots.txt it cannot reach through
  // redirects as a 404.
  if (s >= 300) return { verdict: 'allowed', why: 'no-file' }
  if (s < 200) return { verdict: 'unknown', why: 'no-answer' }
  // A 2xx we hold no body for: we did not read it, so we cannot say it has no rules.
  if (robots.body == null) return { verdict: 'unknown', why: 'no-answer' }
  const check = checkRobots(parseRobots(robots.body ?? ''), tokens, path)
  return { verdict: check.allowed ? 'allowed' : 'blocked', why: 'rules', check }
}

/** A rule in the file's own words, for "Show the details": "Disallow: /about". */
export function describeRule(rule: RobotsRule): string {
  return `${rule.allow ? 'Allow' : 'Disallow'}: ${rule.pattern}`
}
