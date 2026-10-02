/**
 * The ten "Can be found" tests. Pure, synchronous, never throw (types.ts `SeoTest`).
 *
 * THE BOT TESTS (google, bing, chatgpt, claude, perplexity, others) pass when, for every page
 * we opened and every visitor the test names (bots.ts):
 *   - the visit using the bot's name answered 2xx with a real web page: not a security check
 *     (a vendor's marks, or a bare "Access denied" / "Verify you are human" page), not a
 *     password page, not a "page not found" served as 200, not something that isn't a web
 *     page (text, JSON, an empty body) when a person gets one, not a page with almost no words
 *     for a bot that runs no scripts;
 *   - it is the page a person gets: at least 80% the same words, and every one of the artist's
 *     published words (bio, releases, shows) a person's copy shows is in the bot's copy too;
 *   - the settings file (robots.txt) does not disallow that page for the bot's token;
 *   - neither the page (<meta name="robots"> / <meta name="{bot}">) nor the X-Robots-Tag header
 *     says noindex / none / a past unavailable_after, for everyone or for that bot;
 *   - for `bing` only, neither says noarchive (Bing: "Do not link in Chat and Copilot") without
 *     nocache. nocache and nosnippet don't fail it: a pass says what they limit (see `copilotRules`).
 * `fail` is only for what we SAW. `unknown` is for what we could not look at: no answer, a
 * settings file refused to us, a page cut at the size cap, a wall that turned our PERSON's
 * visit away too (then it is our server being turned away, not the bot), or a home page that
 * doesn't show the artist's name (we may not have been shown the real site).
 *
 * THE LIMIT every bot test states: we visit using the bot's NAME from our own server. A
 * firewall that checks real bot addresses can treat the real bot differently from us, in
 * either direction.
 *
 * WORDS. Every sentence a manager reads is plain, starts lower-case after "Not yet:" unless it
 * starts with a name ("ChatGPT"), and keeps codes, paths and file names in `evidence`.
 *
 * LINEAR. Everything here that reads fetched html scans it once (indexOf / sticky regexes
 * with no nested repeats); nothing backtracks on a hostile page.
 */
import { trimTrailingSlashes } from '@/lib/url'
import { SEO_BOTS, botsForTest, robotsTokensOf } from './bots'
import { sameSite } from './evidence'
import { collapse, decodeEntities, parseAttrs, parsePage, wordsOf, type Page } from './html'
import { anotherGroupAllows, describeRule, robotsVerdict, type RobotsVerdict } from './robots-txt'
import type { SeoBot, SeoEvidence, SeoKnown, SeoPageFetch, SeoTest, SeoTestId, SeoTestResult } from './types'

type FoundId = 'google' | 'bing' | 'chatgpt' | 'claude' | 'perplexity' | 'others' | 'allowed' | 'list' | 'words' | 'bingwm'
type BotTestId = SeoBot['test']
type Result = Omit<SeoTestResult, 'id'>
/** A test before `total` stamps its id on the result. */
type Inner = (e: SeoEvidence) => Result
type Row = { label: string; value: string }

/* ── plain words ────────────────────────────────────────────────────────────────────── */

const num = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`
const pageName = (path: string) => (path === '/' ? 'your home page' : `your page ${path}`)
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`)
const listWords = (items: string[], and = 'and') => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`)

/** A status in plain words, no number (the number is in the details). */
const STATUS_WORDS: Record<number, string> = {
  401: 'it asks for a password', 403: 'blocked', 404: 'not found', 405: 'not allowed', 410: 'gone', 429: 'too many visits',
  500: 'the site had an error', 502: 'not available', 503: 'not available', 504: 'not available',
}
const statusWords = (s: number) => STATUS_WORDS[s] ?? (s >= 500 ? 'the site had an error' : s >= 400 ? 'refused' : 'an answer we didn’t expect')
/** Answers that may be OUR server being refused, not the bot. */
const REFUSALS = new Set([401, 403, 429, 503])

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A guarded-fetch error as plain words (evidence.ts writes "code" or "code: address"). */
function errorWords(error: string | undefined): string {
  const code = (error ?? '').split(':')[0]
  return ({
    timeout: 'no answer in 10 seconds', network: 'no connection', 'out-of-time': 'we ran out of time',
    'too-many-redirects': 'it sent us on more than 3 times', 'not-public': 'not a public address', 'not-allowed': 'it sent us to another site',
    'bad-redirect': 'it sent us to a broken address',
  } as Record<string, string>)[code] ?? 'no answer'
}

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/* ── linear html helpers ────────────────────────────────────────────────────────────── */

const TAG_NAME = /[A-Za-z0-9-]/

type Tag = { name: string; closing: boolean; start: number; nameEnd: number; end: number }

/** Every tag in `html` (up to `limit`), in order: one forward pass. Comments are skipped and
 *  script / style bodies are jumped over, so a tag written inside a script is not a tag. */
function* tags(html: string, limit = html.length): Generator<Tag> {
  let pos = html.indexOf('<')
  while (pos >= 0 && pos < limit) {
    if (html.startsWith('<!--', pos)) {
      const end = html.indexOf('-->', pos + 4)
      if (end < 0) return
      pos = html.indexOf('<', end + 3)
      continue
    }
    let i = pos + 1
    const closing = html[i] === '/'
    if (closing) i++
    const start = i
    while (i < html.length && i - start < 32 && TAG_NAME.test(html[i])) i++
    const name = html.slice(start, i).toLowerCase()
    const gt = html.indexOf('>', i)
    if (gt < 0) return
    if (!name) {
      pos = html.indexOf('<', pos + 1)
      continue
    }
    yield { name, closing, start: pos, nameEnd: i, end: gt + 1 }
    if (!closing && (name === 'script' || name === 'style')) {
      const close = indexOfCi(html, `</${name}`, gt + 1)
      if (close < 0) return
      pos = close
      continue
    }
    pos = html.indexOf('<', gt + 1)
  }
}

/** Case-insensitive indexOf for an ASCII needle: one sticky-free regex scan. */
function indexOfCi(html: string, needle: string, from: number): number {
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'gi')
  re.lastIndex = from
  const m = re.exec(html)
  return m ? m.index : -1
}

/** A tag's attributes. Only the first 8 KB of a tag is read: no attribute we look at is longer. */
const attrsOf = (html: string, t: Tag) => parseAttrs(html.slice(t.nameEnd, Math.min(t.end - 1, t.nameEnd + 8192)))

/** Where the head ends: `</head>` or `<body`, else the whole page. */
function headEnd(html: string): number {
  for (const t of tags(html)) if ((t.closing && t.name === 'head') || (!t.closing && t.name === 'body')) return t.start
  return html.length
}

function hasPassword(html: string): boolean {
  for (const t of tags(html)) if (!t.closing && t.name === 'input' && (attrsOf(html, t).type ?? '').toLowerCase() === 'password') return true
  return false
}

/** A script that runs (not a data block: JSON-LD, application/json). */
function hasScripts(html: string): boolean {
  for (const t of tags(html)) {
    if (t.closing || t.name !== 'script') continue
    const type = (attrsOf(html, t).type ?? '').toLowerCase()
    if (!type || type.includes('javascript') || type === 'module' || type.includes('ecmascript')) return true
  }
  return false
}

/** The signs of a page that is built by its scripts: an empty mount point (`<div id="root">`,
 *  `__next`, `app`, …) or a `<noscript>` asking for JavaScript. A short page with a form
 *  widget's script is not one. */
const MOUNT_IDS = new Set(['root', 'app', '__next', '___gatsby', 'svelte', '__nuxt', 'q-app', 'main-app'])
function isAppShell(html: string): boolean {
  let open: Tag | null = null
  for (const t of tags(html)) {
    if (open) {
      if (t.closing && t.name === open.name && /^\s*$/.test(html.slice(open.end, t.start))) return true
      open = null
    }
    if (!t.closing && MOUNT_IDS.has((attrsOf(html, t).id ?? '').toLowerCase())) open = t
    if (!t.closing && t.name === 'noscript') {
      const close = indexOfCi(html, '</noscript', t.end)
      if (close > 0 && /javascript/i.test(html.slice(t.end, Math.min(close, t.end + 2000)))) return true
    }
  }
  return false
}

/** The first `<h1>`'s text, at most 300 characters of it. */
function firstH1(html: string): string {
  for (const t of tags(html)) {
    if (t.closing || t.name !== 'h1') continue
    const close = indexOfCi(html, '</h1', t.end)
    const inner = html.slice(t.end, close < 0 ? t.end + 300 : Math.min(close, t.end + 300))
    let out = ''
    let inTag = false
    for (const ch of inner) {
      if (ch === '<') inTag = true
      else if (ch === '>') inTag = false
      else if (!inTag) out += ch
    }
    return collapse(decodeEntities(out))
  }
  return ''
}

/** `html` with every `<name>…</name>` of the given names cut out (menus, headers, footers). */
function without(html: string, names: Set<string>): string {
  let out = ''
  let from = 0
  let depth = 0
  let skipping = ''
  for (const t of tags(html)) {
    if (!skipping && !t.closing && names.has(t.name)) {
      out += html.slice(from, t.start)
      skipping = t.name
      depth = 1
      continue
    }
    if (skipping && t.name === skipping) {
      depth += t.closing ? -1 : 1
      if (depth === 0) {
        skipping = ''
        from = t.end
      }
    }
  }
  return skipping ? out : out + html.slice(from)
}

/** `html` with inline tags removed without a space, so "Out<b>West</b>" reads "OutWest". */
const INLINE = new Set(['b', 'i', 'em', 'strong', 'span', 'a', 'small', 'mark', 'sup', 'sub', 'u', 's', 'abbr', 'cite', 'q', 'font', 'time'])
function joinInline(html: string): string {
  let out = ''
  let from = 0
  for (const t of tags(html)) {
    if (!INLINE.has(t.name)) continue
    out += html.slice(from, t.start)
    from = t.end
  }
  return out + html.slice(from)
}

/** The text inside every `<noscript>`: a reader that runs no scripts reads it. */
function noscriptText(html: string): string {
  const parts: string[] = []
  for (const t of tags(html)) {
    if (t.closing || t.name !== 'noscript') continue
    const close = indexOfCi(html, '</noscript', t.end)
    if (close < 0) break
    parts.push(parsePage(`<body>${html.slice(t.end, close)}</body>`).text)
  }
  return parts.join(' ')
}

/** Every canonical in the head, and the `<base href>`, read the way Google reads them:
 *  a `<link rel=canonical>` in the body is ignored. */
function headLinks(html: string): { canonicals: string[]; base: string | null } {
  const end = headEnd(html)
  const canonicals: string[] = []
  let base: string | null = null
  for (const t of tags(html, end)) {
    if (t.closing) continue
    if (t.name === 'base' && base === null) base = attrsOf(html, t).href ?? null
    if (t.name === 'link') {
      const a = attrsOf(html, t)
      if ((a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical') && a.href !== undefined) canonicals.push(a.href.trim())
    }
  }
  return { canonicals, base }
}

/* ── the artist's own words, looked for in a page ───────────────────────────────────── */

/** Letters and digits, lower-cased, " a b c " (web-address schemes dropped, so a bio's
 *  "https://skeen.com/press" matches a page's "skeen.com/press"). */
function spaced(s: string): string {
  return ` ${wordsOf(decodeEntities(s).replace(/https?:\/\//gi, ' ').replace(/\bwww\./gi, ' ')).join(' ')} `
}
/** For a name: letters and digits only, accents dropped ("Beyoncé" = "beyonce"). */
const flat = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

type Hay = { spaced: string; joined: string; words: string[] }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** `named`: for a show, its venue appears somewhere (maybe without its date or city). */
type Needle = { kind: 'bio' | 'release' | 'show'; label: string; found: (h: Hay) => boolean; named?: (h: Hay) => boolean }

function bioParts(bio: string): string[] {
  const cleaned = bio.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  const parts = cleaned.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => flat(s).length >= 8)
  // A bio of only short fragments ("DJ. NYC. Yes.") is looked for whole.
  if (!parts.length && flat(cleaned).length >= 3) return [cleaned.trim()]
  return parts
}

/** Is `needle` (spaced) in the page's text, or in its text with inline tags joined? A whole-
 *  word match only: "Therein" is not in "there in". */
const inHay = (needle: string, h: Hay) => h.spaced.includes(needle) || h.joined.includes(needle)

/** What Tapir has published that can be looked for, and what can't (and why). */
function needlesOf(pub: NonNullable<SeoKnown['published']>): { needles: Needle[]; skipped: string[] } {
  const needles: Needle[] = []
  const skipped: string[] = []
  for (const part of pub.bio ? bioParts(pub.bio) : []) {
    const s = spaced(part)
    needles.push({ kind: 'bio', label: clip(part, 40), found: (h) => inHay(s, h) })
  }
  for (const r of pub.releases ?? []) {
    const title = (r.title ?? '').trim()
    if (!title) continue
    if (flat(title).length < 3) {
      skipped.push(`“${clip(title, 20)}” (too short to look for)`)
      continue
    }
    const s = spaced(title)
    needles.push({ kind: 'release', label: title, found: (h) => inHay(s, h) })
  }
  for (const t of pub.tourDates ?? []) {
    if (t.isPast) continue
    const venue = (t.venue ?? '').trim()
    if (!venue || flat(venue).length < 3) {
      if (t.city || venue) skipped.push(`a show in ${clip(t.city ?? venue, 20)} (no venue name to look for)`)
      continue
    }
    const venueWords = wordsOf(venue)
    const cityWords = wordsOf(t.city ?? '')
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.date ?? '')
    const month = d ? Number(d[2]) : 0
    const day = d ? Number(d[3]) : 0
    const monthWords = month ? new Set([MONTHS[month - 1], MONTHS[month - 1].slice(0, 3), month === 9 ? 'sept' : '', String(month), d![2]].filter(Boolean)) : new Set<string>()
    const dayWords = day ? new Set([String(day), d![3], `${day}st`, `${day}nd`, `${day}rd`, `${day}th`]) : new Set<string>()
    const seq = (words: string[], at: number, want: string[]) => want.every((w, k) => words[at + k] === w)
    // The venue, with its city or its date within 15 words: a venue's name alone ("Live",
    // "The Room") can be anywhere on a page.
    const found = (h: Hay) => {
      for (let i = 0; i < h.words.length; i++) {
        if (!seq(h.words, i, venueWords)) continue
        const lo = Math.max(0, i - 15)
        const hi = Math.min(h.words.length, i + venueWords.length + 15)
        const near = h.words.slice(lo, hi)
        if (cityWords.length && near.some((_, k) => seq(near, k, cityWords))) return true
        if (d && near.some((w) => monthWords.has(w)) && near.some((w) => dayWords.has(w))) return true
      }
      return false
    }
    const named = (h: Hay) => h.words.some((_, i) => seq(h.words, i, venueWords))
    needles.push({ kind: 'show', label: venue, found, named })
  }
  return { needles, skipped }
}

/* ── reading one visit ──────────────────────────────────────────────────────────────── */

type Visit =
  | { kind: 'ok'; page: Page; words: string[]; empty: boolean; blank: boolean; scripts: boolean; truncated: boolean; hay: Hay; hasName: (name: string) => boolean }
  | { kind: 'not-page'; type: string; empty: boolean }
  | { kind: 'no-answer'; why: string; outOfTime: boolean }
  | { kind: 'away'; to: string; private: boolean }
  | { kind: 'broken-redirect'; status: number }
  | { kind: 'status'; status: number }
  | { kind: 'wall'; by: string; status: number }
  | { kind: 'login' }
  | { kind: 'soft404' }

/** A security vendor's page, by its OWN marks. Header marks count on any answer. Body marks
 *  count only on an error answer, or on a 2xx page that IS a challenge (its title), because
 *  the vendors' scripts also sit on normal pages (reCAPTCHA on a form, Imperva, DataDome,
 *  Cloudflare's bot detection), and a normal page is not a wall. */
const WALL_TITLE = /^\s*(just a moment\.*|attention required!? \| cloudflare|vercel security checkpoint|access denied|forbidden|403 forbidden|blocked|you have been blocked|verify you are (a )?human\.?|are you a robot\??|security check|please verify you are a human|human verification|unusual traffic.*|ddos-guard|request unsuccessful\. incapsula incident id.*|pardon our interruption\.*|access to this page has been denied\.?)\s*$/i

function wallOf(f: SeoPageFetch, html: string | null, title: string, h1: string, words: number): string | null {
  const h = f.headers ?? {}
  if (/challenge/i.test(h['cf-mitigated'] ?? '')) return 'Cloudflare'
  if (/^(challenge|deny)$/i.test((h['x-vercel-mitigated'] ?? '').trim())) return 'Vercel'
  if (/^(captcha|challenge)$/i.test((h['x-amzn-waf-action'] ?? '').trim())) return 'Amazon'
  if (!html) return null
  const head = html.slice(0, 300_000)
  const ok = f.status != null && f.status >= 200 && f.status < 300
  // A challenge page: Cloudflare's challenge script object, or a challenge title on a short page.
  if (head.includes('window._cf_chl_opt')) return 'Cloudflare'
  if (words < 300 && (WALL_TITLE.test(title) || WALL_TITLE.test(h1))) {
    if (/cloudflare/i.test(title) || /cf-error-details/i.test(head) || /just a moment/i.test(title)) return 'Cloudflare'
    if (/vercel/i.test(title)) return 'Vercel'
    return 'a security check'
  }
  if (/id="cf-error-details"/i.test(head) && /you have been blocked|access denied/i.test(head)) return 'Cloudflare'
  if (ok) return null
  if (head.includes('captcha-delivery.com')) return 'DataDome'
  if (head.includes('_Incapsula_Resource')) return 'Imperva'
  if (/sucuri website firewall/i.test(head)) return 'Sucuri'
  if (/px-captcha|_pxCaptcha/i.test(head)) return 'HUMAN'
  if (/ddos-guard/i.test(head)) return 'DDoS-Guard'
  return null
}

/** A "not found" page served as 200: the WHOLE title or first heading says so. "Not Found"
 *  alone is left out (a song can be called that); "404" counts only at the start. */
const NOT_FOUND = /^\s*(404\b.*|.*\bpage (was )?not found\b.*|.*\bcould ?n[o’']t be found\b.*|.*\b(page|this page) does ?n[o’']t exist\b.*|.*\bno longer exists?\b.*)$/i

const derived = new WeakMap<SeoPageFetch, Visit>()

function readVisit(f: SeoPageFetch | undefined): Visit {
  if (!f) return { kind: 'no-answer', why: 'we didn’t visit', outOfTime: false }
  const hit = derived.get(f)
  if (hit) return hit
  const v = readVisitNow(f)
  derived.set(f, v)
  return v
}

function readVisitNow(f: SeoPageFetch): Visit {
  if (f.status == null) {
    const [code, ...rest] = (f.error ?? '').split(': ')
    const to = rest.join(': ')
    // A redirect we refused to follow: the site sent the visit somewhere else. The first
    // address itself being refused (no "to") is our problem, not the site's.
    if ((code === 'not-allowed' || code === 'not-public') && to) return { kind: 'away', to, private: code === 'not-public' }
    return { kind: 'no-answer', why: errorWords(f.error), outOfTime: code === 'out-of-time' }
  }
  const s = f.status
  const html = typeof f.html === 'string' ? f.html : null
  const page = html ? parsePage(html) : null
  const words = page ? wordsOf(page.text) : []
  const title = page?.title ?? ''
  const h1 = html ? firstH1(html) : ''
  const wall = wallOf(f, html, title, h1, words.length)
  if (wall) return { kind: 'wall', by: wall, status: s }
  if (s >= 300 && s < 400) return { kind: 'broken-redirect', status: s }
  if (s < 200 || s >= 300) return { kind: 'status', status: s }
  if (!html || !page) return { kind: 'not-page', type: (f.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase(), empty: html === '' || s === 204 }
  if (words.length < 150 && hasPassword(html)) return { kind: 'login' }
  if (words.length < 200 && (NOT_FOUND.test(title) || NOT_FOUND.test(h1))) return { kind: 'soft404' }
  const bare = without(html, new Set(['nav']))
  const text = `${parsePage(bare).text} ${noscriptText(html)}`
  const hay: Hay = { spaced: spaced(text), joined: spaced(parsePage(joinInline(bare)).text), words: wordsOf(decodeEntities(text)) }
  const nameHay = flat(`${title} ${page.text}`)
  return {
    // empty: an app shell with almost no words until its scripts run. blank: nothing to read at all.
    kind: 'ok', page, words, empty: words.length < 20 && isAppShell(html), blank: words.length < 5, scripts: hasScripts(html), truncated: f.truncated === true, hay,
    hasName: (name: string) => !flat(name) || nameHay.includes(flat(name)),
  }
}

/** How much of two pages' words are the same (0-1), counting repeats. */
function overlap(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1
  const count = new Map<string, number>()
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1)
  let same = 0
  for (const w of b) {
    const n = count.get(w) ?? 0
    if (n > 0) {
      same++
      count.set(w, n - 1)
    }
  }
  return same / Math.max(a.length, b.length)
}
/** Below this, the bot was handed a different page. A date or a shuffled list moves a real page
 *  by a few percent; the artist's own words are checked one by one besides (`needlesOf`). */
const SAME_PAGE = 0.8

/* ── the run-level facts every test reads ───────────────────────────────────────────── */

/** The site as a whole did not answer, or answered every visit with a server error. */
function siteDown(e: SeoEvidence): { value: string; sentence: string } | null {
  const home = Array.isArray(e.plain) ? e.plain.find((p) => p.path === '/') : undefined
  if (!home) return null
  const homes = [home, ...Object.values(e.byBot ?? {}).map((v) => (Array.isArray(v) ? v.find((p) => p.path === '/') : undefined))].filter((x): x is SeoPageFetch => !!x)
  const silent = (f: SeoPageFetch) => f.status == null && !/^not-(allowed|public): /.test(f.error ?? '') && f.error !== 'out-of-time'
  if (homes.every(silent)) return { value: 'site didn’t answer', sentence: 'your site didn’t answer when we visited, so we couldn’t test this. It may be down.' }
  if (home.status != null && home.status >= 500 && homes.every((f) => silent(f) || (f.status != null && f.status >= 500))) {
    return { value: 'site error', sentence: 'your site answered with an error when we visited, so we couldn’t test this. It may be down.' }
  }
  return null
}

/** Does the home page show the artist's name? null = we couldn't read a home page. */
function namesArtistOnHome(e: SeoEvidence): boolean | null {
  const name = e.known?.artistName ?? ''
  if (!flat(name)) return null
  const copies = [e.plain?.find((p) => p.path === '/'), e.byBot?.googlebot?.find((p) => p.path === '/')]
  for (const f of copies) {
    const v = readVisit(f)
    if (v.kind === 'ok') return v.hasName(name)
  }
  return null
}
const notTheSite = (e: SeoEvidence) => `your home page doesn’t show your name, “${clip(e.known.artistName, 40)}”, so we may not have been shown your real site.`

/** The pages of the site we did NOT open: listed ones beyond what we opened, and home-page
 *  links to this site's pages. */
function unopened(e: SeoEvidence): number {
  const opened = new Set(e.paths ?? [])
  const more = new Set<string>()
  for (const u of e.sitemap?.urls ?? []) {
    const p = safe(() => new URL(u).pathname, '')
    if (p && !opened.has(p)) more.add(p)
  }
  const listedBeyond = Math.max(0, (e.sitemap?.total ?? 0) - (e.sitemap?.urls?.length ?? 0))
  const home = readVisit(e.plain?.find((p) => p.path === '/'))
  if (home.kind === 'ok') {
    const from = e.plain.find((p) => p.path === '/')?.finalUrl ?? `${e.origin}/`
    for (const href of home.page.links.slice(0, 500)) {
      const u = safe(() => new URL(href, from), null)
      if (!u || !sameSite(u.toString(), e.origin) || /\.(?:jpe?g|png|gif|webp|svg|pdf|mp3|mp4|zip|css|js|xml|txt)$/i.test(u.pathname)) continue
      if (u.pathname !== '/' && !opened.has(u.pathname)) more.add(u.pathname)
    }
  }
  return more.size + listedBeyond
}

/* ── "don't list me" rules: meta robots and X-Robots-Tag ────────────────────────────── */

const RULES_WITH_COLON = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after'])
const KNOWN_RULES = /^(all|noindex|index|nofollow|follow|none|nosnippet|indexifembedded|notranslate|noimageindex|noarchive|nocache|noodp|noydir|max-snippet|max-image-preview|max-video-preview|unavailable_after)\b/i

/**
 * X-Robots-Tag, per Google's spec: "googlebot: noindex" scopes the rules after it to that
 * bot until the next "bot:" prefix; no prefix = everyone. `fetch` joins repeated headers
 * with ", ", so a rule after a scoped one is read as that scope's (a header sent as two
 * lines "googlebot: nofollow" + "noindex" cannot be told apart from one line: a known limit).
 * Values separated by spaces instead of commas ("noindex nofollow") are split too.
 */
export function xRobotsRules(value: string): { scope: string; rule: string }[] {
  const out: { scope: string; rule: string }[] = []
  let scope = '*'
  for (const piece of value.split(',')) {
    const p = piece.trim()
    if (!p) continue
    const m = /^([a-z0-9_.-]+)\s*:\s*(.*)$/i.exec(p)
    if (m && !RULES_WITH_COLON.has(m[1].toLowerCase())) {
      scope = m[1].toLowerCase()
      if (m[2].trim()) out.push(...splitSpaces(m[2]).map((rule) => ({ scope, rule })))
      continue
    }
    const last = out[out.length - 1]
    // unavailable_after's date may itself hold a comma ("Wed, 01 Jan 2025 …").
    if (last && last.rule.startsWith('unavailable_after') && !KNOWN_RULES.test(p)) {
      last.rule += `, ${p.toLowerCase()}`
      continue
    }
    out.push(...splitSpaces(p).map((rule) => ({ scope, rule })))
  }
  return out
}

/** "noindex nofollow" → two rules; a rule with a value (max-snippet: 50, unavailable_after: …)
 *  is kept whole. */
function splitSpaces(p: string): string[] {
  const s = p.trim().toLowerCase()
  if (s.includes(':')) return [s]
  return s.split(/\s+/).filter(Boolean)
}

/** The rule that keeps a page out of the listings, or null. */
function blockingRule(rules: string[], now: number): string | null {
  for (const r of rules) {
    const rule = r.trim()
    if (rule === 'noindex' || rule === 'none') return rule
    const m = /^unavailable_after\s*:\s*(.+)$/.exec(rule)
    if (m) {
      const when = Date.parse(m[1])
      if (Number.isFinite(when) && when <= now) return rule
    }
  }
  return null
}

/** The "don't list this page" signals a visit carries for a bot answering to `names` (lower-case;
 *  "robots" = everyone), each as where and what, or null: the X-Robots-Tag header
 *  (`X-Robots-Tag: googlebot: noindex`) and the page's robots meta tags (`meta robots: noindex`). */
function noindexSignals(f: SeoPageFetch | undefined, page: Page | null, names: string[], now: number): { header: string | null; meta: string | null } {
  const out: { header: string | null; meta: string | null } = { header: null, meta: null }
  if (!f) return out
  const header = f.headers?.['x-robots-tag']
  if (header) {
    const rules = xRobotsRules(header).filter((r) => r.scope === '*' || names.includes(r.scope)).map((r) => r.rule)
    if (blockingRule(rules, now)) out.header = `X-Robots-Tag: ${clip(header, 80)}`
  }
  if (page) {
    search: for (const name of ['robots', ...names]) {
      for (const content of page.meta[name] ?? []) {
        if (blockingRule(xRobotsRules(content).map((r) => r.rule), now)) {
          out.meta = `meta ${name}: ${clip(collapse(content), 60)}`
          break search
        }
      }
    }
  }
  return out
}

/** Does this visit tell a bot answering to `names` not to list the page? The header first, then
 *  the page's tags: where and what, e.g. `X-Robots-Tag: googlebot: noindex`. */
function noindexFor(f: SeoPageFetch | undefined, page: Page | null, names: string[], now: number): string | null {
  const s = noindexSignals(f, page, names, now)
  return s.header ?? s.meta
}

/** The same signals as the tests read them, for "How crawlers see your site" (crawl.ts): the
 *  page's tags count only when the visit is a readable page (not a wall, an error, not html). */
export function visitNoindex(f: SeoPageFetch | undefined, names: string[], now: number): { header: string | null; meta: string | null } {
  const v = readVisit(f)
  return noindexSignals(f, v.kind === 'ok' ? v.page : null, names, now)
}

/* ── Copilot: what Bing may use of a page in its answers ────────────────────────────── */

/**
 * Bing's own list of the robots tags it reads (bing.com/webmasters/help/which-robots-metatags-
 * does-bing-support-5198d240, read 2026-09-30):
 *   noarchive  "Do not link in Chat and Copilot."
 *   nocache    "Display only URL/Snippet/Title in Chat or Copilot." … "If content has both
 *              NOCACHE and NOARCHIVE tags, we will treat it as NOCACHE."
 *   nosnippet  "Do not show a description nor a preview thumbnail (where applicable) for the page."
 * "Each of these tags can also be specified as X-Robots-Tag", and `name="bingbot"` in place of
 * `name="robots"` limits a tag to Bing. Bing's announcement (blogs.bing.com/webmaster/
 * september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-
 * Bing-Chat): "Content tagged NOARCHIVE will not be included in Bing Chat answers, not be linked
 * to in the answers", and with either tag the page "will still appear in our search results":
 * neither is a "don't list me", so the `allowed` test and the crawl section's noindex don't read
 * them. Bing does not say nosnippet changes Copilot, so its words name Bing only.
 */
const COPILOT_RULES = ['noarchive', 'nocache', 'nosnippet'] as const
type CopilotRule = (typeof COPILOT_RULES)[number]

/** The Copilot rules a visit carries for a bot answering to `names` (lower-case), each with where
 *  it was first seen: the X-Robots-Tag header for everyone or for that bot, then the page's
 *  robots and bot-named meta tags. */
function copilotRules(f: SeoPageFetch | undefined, page: Page | null, names: string[]): Partial<Record<CopilotRule, string>> {
  const out: Partial<Record<CopilotRule, string>> = {}
  const saw = (rules: string[], where: string) => {
    for (const r of rules) {
      const rule = COPILOT_RULES.find((c) => c === r.trim())
      if (rule && !out[rule]) out[rule] = where
    }
  }
  const header = f?.headers?.['x-robots-tag']
  if (header) saw(xRobotsRules(header).filter((r) => r.scope === '*' || names.includes(r.scope)).map((r) => r.rule), `X-Robots-Tag: ${clip(header, 80)}`)
  for (const name of page ? ['robots', ...names] : []) {
    for (const content of page!.meta[name] ?? []) saw(xRobotsRules(content).map((r) => r.rule), `meta ${name}: ${clip(collapse(content), 60)}`)
  }
  return out
}

/** "your home page", "2 of your pages": where a Copilot limit is, short enough for a sentence. */
const onPages = (paths: string[]) => (paths.length === 1 ? pageName(clip(paths[0], 30)) : `${num(paths.length)} of your pages`)

/** The one sentence a bing PASS adds for a limit that doesn't fail it (the results have no
 *  "warning" state): nocache first, as the one that changes Copilot. '' for none. */
function copilotSaid(short: string[], noText: string[]): string {
  if (short.length) return `A setting on ${onPages(short)} lets Copilot show only ${short.length === 1 ? 'its title' : 'their titles'} and a short line.`
  if (noText.length) return `A setting on ${onPages(noText)} asks Bing to show no description for ${noText.length === 1 ? 'it' : 'them'}.`
  return ''
}

/* ── the settings file ──────────────────────────────────────────────────────────────── */

function robotsRow(e: SeoEvidence): string {
  const s = e.robots?.status
  if (s == null) return `no answer (${errorWords(e.robots?.error)})`
  if (s >= 200 && s < 300) return 'read'
  return `error ${s}`
}

/** Why we could not read the settings file, in plain words. */
function robotsUnread(e: SeoEvidence, v: RobotsVerdict, who: string): string {
  const isAre = / and |search engines/.test(who) ? 'are' : 'is'
  const err = e.robots?.error ?? ''
  const to = /^not-allowed: (.+)$/.exec(err)?.[1]
  if (to) return `your site’s settings for search engines send visitors to another site (${hostOf(to)}), which we don’t follow, so we can’t tell if ${who} ${isAre} let in.`
  if (v.why === 'not-shown' || v.why === 'slow-down') return `your site wouldn’t show us its settings for search engines, so we can’t tell if ${who} ${isAre} let in.`
  return `your site’s settings for search engines didn’t answer, so we can’t tell if ${who} ${isAre} let in.`
}

/* ── the bot tests ──────────────────────────────────────────────────────────────────── */

/** The names `others` reads, from bots.ts, so a crawler added there is named here too: every
 *  name but a training-only token that never visits (Apple Intelligence is Apple's own visit),
 *  and the ones that answer and search (all but the training-only). */
const OTHERS = botsForTest('others')
const OTHERS_NAMED = [...new Set(OTHERS.filter((b) => !b.trainingOnly || b.fetches).map((b) => b.who))]
const OTHERS_SEARCHERS = [...new Set(OTHERS.filter((b) => !b.trainingOnly).map((b) => b.who))]

const WHO: Record<BotTestId, string> = {
  google: 'Google', bing: 'Bing', chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity', others: listWords(OTHERS_NAMED),
}
/** The visitors that answer and search, per test, for "nothing we saw turns … away". */
const SEARCHERS: Partial<Record<BotTestId, string>> = { chatgpt: 'ChatGPT search', claude: 'Claude search', others: listWords(OTHERS_SEARCHERS, 'or') }
/** The name a training-only visitor learns for ("asks ChatGPT not to learn from it"). */
const LEARNER: Record<string, string> = { gptbot: 'ChatGPT', claudebot: 'Claude', 'applebot-extended': 'Apple Intelligence', ccbot: 'Common Crawl' }
/** The same visitor as a thing that can be turned away ("turns away ChatGPT's training visitor"). */
const LEARNER_VISITOR: Record<string, string> = { ChatGPT: 'ChatGPT’s training visitor', Claude: 'Claude’s training visitor', 'Apple Intelligence': 'Apple Intelligence', 'Common Crawl': 'Common Crawl' }

/** `choice`: a block the site's owner set on purpose (a settings rule, a firewall refusal).
 *  `rule`: it was a settings rule (the site ASKS), not a refusal. */
type Finding = { level: 'fail' | 'unknown'; path: string | null; sentence: string; training: boolean; learner?: string; choice?: boolean; rule?: boolean; todo?: string }

function botTest(test: BotTestId): Inner {
  return (e) => {
    const who = WHO[test]
    const them = test === 'others' ? 'them' : who
    const limits = `We visit from our own server using ${test === 'others' ? 'each one’s' : `${who}’s`} name, not from ${them} directly, so a firewall that checks who is really visiting may treat ${them} differently than it treated us; and we only open the pages listed here.`
    const bots = botsForTest(test)
    const paths = e.paths
    if (!Array.isArray(paths) || !paths.length || !Array.isArray(e.plain) || !e.plain.length || !e.byBot) {
      return { status: 'unknown', value: 'couldn’t check', sentence: 'we have no pages from your site to look at.', evidence: [], limits }
    }
    const down = siteDown(e)
    if (down) return { status: 'unknown', value: down.value, sentence: down.sentence, evidence: [{ label: 'home page', value: robotsRowFor(e.plain.find((p) => p.path === '/')) }], limits }
    const now = Date.parse(e.gatheredAt) || Date.now()
    const pub = e.known?.published ?? null
    const { needles } = pub ? needlesOf(pub) : { needles: [] as Needle[] }
    const findings: Finding[] = []
    const badPaths = new Set<string>()
    const rows: Row[] = [{ label: 'Visited as', value: bots.map((b) => (b.fetches ? b.robotsToken : `${b.robotsToken} (settings only)`)).join(' · ') }]
    const robotsNotes: string[] = []
    const tagNotes: string[] = []
    const notes: string[] = []
    /** bing only: the Copilot rules seen, and the pages limited by nocache / nosnippet. */
    const copilotNotes: string[] = []
    const copilotShort: string[] = []
    const copilotNoText: string[] = []
    const seenPage = new Set<string>()
    const gone = new Set<string>()
    let robotsLevel: 'ok' | 'said' = 'ok'
    const anchor = namesArtistOnHome(e)
    if (anchor === false) findings.push({ level: 'unknown', path: null, training: false, sentence: notTheSite(e) })

    for (const bot of bots) {
      const visitor = bot.fetches ? bot : SEO_BOTS.find((b) => b.key === bot.visitsAs) ?? null
      // 1. The settings file, for this bot's own token (and the visitor's, for a token-only one).
      const tokenSets = [robotsTokensOf(bot), ...(visitor && visitor !== bot ? [robotsTokensOf(visitor)] : [])]
      for (const path of paths) {
        for (const tokens of tokenSets) {
          const v = robotsVerdict(e.robots ?? { status: null, body: null }, tokens, path)
          if (v.verdict === 'allowed') continue
          if (v.why === 'server-error' || v.verdict === 'unknown') {
            if (robotsLevel === 'ok') {
              robotsLevel = 'said'
              if (v.why === 'server-error') {
                findings.push({ level: 'fail', path: null, training: false, sentence: `your site gives an error when search engines ask for its settings, so ${who} ${test === 'others' ? 'stay' : 'stays'} away from your whole site.`, todo: 'Ask whoever runs your site to fix its settings for search engines.' })
              } else findings.push({ level: 'unknown', path: null, training: false, sentence: robotsUnread(e, v, who) })
            }
            if (v.why === 'server-error') paths.forEach((p) => badPaths.add(p))
            continue
          }
          // Unnamed and kept out by `*` while another crawler is let in by name: this bot then
          // follows "other search bots'" rules, its vendor won't say whose (bots.ts). Not a fail.
          if (bot.followsOtherSearchBots && v.check?.group === '*' && anotherGroupAllows(e.robots?.body ?? '', tokens, path)) {
            findings.push({ level: 'unknown', path: null, training: false, sentence: `your site’s settings for search engines don’t mention ${bot.who}, and ${bot.company ?? bot.who} doesn’t say which other search engine’s rules it then follows, so we can’t tell if ${bot.who} is let in.` })
            continue
          }
          badPaths.add(path)
          const rule = v.check?.rule ? describeRule(v.check.rule) : 'a rule'
          robotsNotes.push(`${rule} (for ${v.check?.group === '*' ? 'everyone' : tokens[0]}, on ${path})`)
          const training = !!bot.trainingOnly && tokens === tokenSets[0]
          findings.push({
            level: 'fail', path, training, choice: true, rule: true, learner: training ? LEARNER[bot.key] : undefined,
            sentence: `your site’s settings for search engines ask ${bot.who} to stay away from ${pageName(path)}.`,
            todo: `Ask whoever runs your site to let ${bot.who} in.`,
          })
        }
      }
      if (!visitor) continue
      const visits = e.byBot[visitor.key]
      if (!Array.isArray(visits)) {
        findings.push({ level: 'unknown', path: null, training: false, sentence: `we didn’t visit using ${visitor.who}’s name, so we can’t tell what it gets.` })
        continue
      }
      // 2. The visits. A token-only bot reads its visitor's pages; each page is judged once.
      const names = [visitor.robotsToken.toLowerCase(), ...(bot !== visitor ? [bot.robotsToken.toLowerCase()] : [])]
      const blamed = bot === visitor ? visitor.who : bot.who
      let wordsSeen = 0
      let wordsPlain = 0
      let anyScripts = false
      let pagesRead = 0
      for (const path of paths) {
        const f = visits.find((x) => x.path === path)
        const plainF = e.plain.find((p) => p.path === path)
        const key = `${visitor.key} ${path} ${names.join(',')}`
        if (seenPage.has(key)) continue
        seenPage.add(key)
        const v = readVisit(f)
        const p = readVisit(plainF)
        // A token-only bot (Gemini) is read through another's visit (Google's): say both.
        const vname = bot === visitor || bots.includes(visitor) ? visitor.who : `${bot.who} (through ${visitor.who})`
        /** The name we really sent. */
        const uname = visitor.who
        const gets = test === 'others' ? 'get' : 'gets'
        const training = !!visitor.trainingOnly
        const add = (level: 'fail' | 'unknown', sentence: string, todo?: string, choice = false) => {
          if (level === 'fail') badPaths.add(path)
          findings.push({ level, path, training, learner: training ? LEARNER[visitor.key] : undefined, choice, sentence, todo })
        }
        const refusedUsToo = p.kind === 'wall' || (p.kind === 'status' && REFUSALS.has(p.status))
        const letIn = `Ask whoever runs your site to let ${uname} through its security check.`
        switch (v.kind) {
          case 'no-answer':
            add('unknown', v.outOfTime ? `we ran out of time before we reached ${pageName(path)}.`
              : /^too-many-redirects/.test(f?.error ?? '') ? `${pageName(path)} sent our visit on more than 3 times, so we stopped.`
                : `${pageName(path)} didn’t answer our visit using ${uname}’s name.`)
            break
          case 'away':
            add('fail', v.private ? `${pageName(path)} sends visitors to a private address.` : `${pageName(path)} sends ${vname} to another site (${hostOf(v.to)}).`)
            break
          case 'broken-redirect':
            add('fail', `${pageName(path)} sends visitors to a broken address.`)
            break
          case 'wall':
            notes.push(`${path}: a security check (${v.by}) for ${visitor.robotsToken}${refusedUsToo ? ' and for a person' : ''}`)
            if (refusedUsToo) add('unknown', `your site turned away our test visits even without a bot’s name, so we can’t tell what ${who} ${gets}.`)
            else add('fail', `a security check stopped our visit using ${uname}’s name on ${pageName(path)}.`, letIn, true)
            break
          case 'status':
            if (refusedUsToo && REFUSALS.has(v.status)) add('unknown', `your site turned away our test visits even without a bot’s name, so we can’t tell what ${who} ${gets}.`)
            else if (p.kind === 'status' && p.status === v.status && path !== '/' && (v.status === 404 || v.status === 410)) {
              // A page missing for everyone is a broken link, not the bot being turned away (the
              // list test judges listed pages). It leaves the count; the home page never does.
              notes.push(`${path} doesn’t open for anyone (${v.status})`)
              gone.add(path)
            } else if (p.kind === 'status' && p.status === v.status) add('fail', `${pageName(path)} doesn’t open for anyone (${statusWords(v.status)}).`, 'Ask whoever runs your site to fix that page.')
            else add('fail', `${pageName(path)} turned away our visit using ${uname}’s name (${statusWords(v.status)}).`, p.kind === 'ok' ? letIn : undefined, REFUSALS.has(v.status))
            break
          case 'login':
            add('fail', `${pageName(path)} asks for a password, so ${vname} can’t read it.`)
            break
          case 'soft404':
            add('fail', `${pageName(path)} says “page not found”.`, 'Ask whoever runs your site to fix that page or take it off the list.')
            break
          case 'not-page':
            if (p.kind === 'ok') add('fail', `${vname} is sent something that isn’t a web page on ${pageName(path)}.`, letIn)
            else if (p.kind === 'not-page' && p.type && p.type === v.type && !p.empty && !v.empty && !/html/.test(p.type)) notes.push(`${path} is a file (${p.type}) for everyone`)
            else add('unknown', `we got no web page at ${pageName(path)}, so we couldn’t read it.`)
            break
          case 'ok': {
            // A page cut at the size cap can't be judged on its words (a comment or tag cut
            // open hides the rest): only a "don't list me" in the part we read counts.
            if (v.truncated) {
              const cutTag = noindexFor(f, v.page, names, now)
              if (cutTag) {
                tagNotes.push(`${cutTag} (on ${path})`)
                findings.push({ level: 'fail', path, training: !!bot.trainingOnly, sentence: `${pageName(path)} asks ${blamed} not to list it.`, todo: 'Ask whoever runs your site to let search engines list that page.' })
                badPaths.add(path)
              } else add('unknown', `${pageName(path)} is over 1 MB, and we read only the start of it.`)
              break
            }
            pagesRead++
            anyScripts ||= v.scripts
            if (v.empty && !visitor.runsScripts) {
              add('fail', `${pageName(path)} shows almost no words until it finishes loading, and ${vname} doesn’t wait for that.`)
              break
            }
            if (v.blank && !v.empty && !v.scripts) {
              add('fail', `${pageName(path)} has almost no words for anyone to read.`)
              break
            }
            if (p.kind === 'ok') {
              // The artist's own words first: the most exact thing to say.
              const missing = needles.filter((n) => n.found(p.hay) && !n.found(v.hay))
              if (missing.length) {
                const what = missing.some((m) => m.kind === 'bio') ? 'your bio' : `“${clip(missing[0].label, 30)}”`
                add('fail', `${vname} is shown ${pageName(path)} without some of your words (${what}).`)
                break
              }
              const same = overlap(p.words, v.words)
              if (same < SAME_PAGE && !p.blank && !v.blank) {
                notes.push(`${path}: ${visitor.robotsToken} got ${Math.round(same * 100)}% the same words`)
                add('fail', `${vname} is shown a different page than people see on ${pageName(path)}.`)
                break
              }
            } else if (!plainF) {
              add('unknown', `we have no visit as a person to ${pageName(path)} to compare with.`)
            } else notes.push(`couldn’t compare ${path} with a person’s visit (${plainF.status ?? errorWords(plainF.error)})`)
            wordsSeen += needles.filter((n) => n.found(v.hay)).length
            if (p.kind === 'ok') wordsPlain += needles.filter((n) => n.found(p.hay)).length
            const tag = noindexFor(f, v.page, names, now)
            if (tag) {
              tagNotes.push(`${tag} (on ${path})`)
              findings.push({ level: 'fail', path, training: !!bot.trainingOnly, sentence: `${pageName(path)} asks ${blamed} not to list it.`, todo: 'Ask whoever runs your site to let search engines list that page.' })
              badPaths.add(path)
              break
            }
            if (test === 'bing') {
              const c = copilotRules(f, v.page, names)
              for (const rule of COPILOT_RULES) if (c[rule]) copilotNotes.push(`${c[rule]} (on ${path})`)
              // Both tags: Bing treats the page as nocache (in answers, as title and a line).
              if (c.noarchive && !c.nocache) {
                findings.push({ level: 'fail', path, training: false, sentence: `${pageName(path)} asks Copilot to leave it out of its answers.`, todo: 'Ask whoever runs your site to let Copilot use that page.' })
                badPaths.add(path)
              } else if (c.nocache) copilotShort.push(path)
              else if (c.nosnippet) copilotNoText.push(path)
            }
          }
        }
      }
      // An app shell: the artist's words are on NONE of the pages without scripts.
      if (!visitor.runsScripts && needles.length && pagesRead && anyScripts && wordsSeen === 0 && wordsPlain === 0) {
        if (unopened(e)) findings.push({ level: 'unknown', path: null, training: !!visitor.trainingOnly, sentence: `none of your bio, releases or shows were on the pages we opened before they finished loading, and your site has more pages.` })
        else {
          paths.forEach((p) => badPaths.add(p))
          findings.push({ level: 'fail', path: null, training: !!visitor.trainingOnly, learner: visitor.trainingOnly ? LEARNER[visitor.key] : undefined, sentence: `none of your bio, releases or shows are on your pages until they finish loading, and ${visitor.who} doesn’t wait for that.` })
        }
      }
      // What each visitor saw, per page, for the details.
      if (bot === visitor || !bots.includes(visitor)) {
        for (const path of paths) {
          const f = visits.find((x) => x.path === path)
          const seen = !f ? 'not visited' : f.status == null ? `no answer (${errorWords(f.error)})` : `${f.status}${f.headers?.server ? ` · ${f.headers.server}` : ''}`
          const row = rows.find((r) => r.label === path)
          const entry = `${visitor.robotsToken} ${seen}`
          if (row) {
            if (!row.value.includes(entry)) row.value += ` · ${entry}`
          } else rows.push({ label: path, value: entry })
        }
      }
    }
    rows.push({ label: 'robots.txt', value: robotsNotes.length ? robotsNotes.join('; ') : `${robotsRow(e)}${e.robots?.status != null && e.robots.status >= 200 && e.robots.status < 300 ? ', no rule blocks these visitors' : ''}` })
    rows.push({ label: 'noindex', value: tagNotes.length ? tagNotes.join('; ') : 'none seen' })
    if (test === 'bing') rows.push({ label: 'Copilot', value: copilotNotes.length ? copilotNotes.join('; ') : 'no noarchive, nocache or nosnippet seen' })
    if (notes.length) rows.push({ label: 'notes', value: notes.join('; ') })

    const counted = paths.filter((p) => !gone.has(p))
    const total = counted.length
    const good = counted.filter((p) => !badPaths.has(p)).length
    const value = `${good} of ${plural(total, 'page')}`
    // One finding per sentence; it is "training only" when EVERY visitor it came from is.
    const merge = (list: Finding[]) => {
      const out: Finding[] = []
      for (const f of list) {
        const same = out.find((g) => g.sentence === f.sentence)
        if (same) {
          same.training &&= f.training
          same.choice &&= f.choice
        } else out.push({ ...f })
      }
      return out
    }
    const fails = merge(findings.filter((f) => f.level === 'fail'))
    const unsure = merge(findings.filter((f) => f.level === 'unknown'))
    const problems = (list: Finding[]) => ({ label: 'problems', value: list.map((f) => f.sentence).join(' ') })
    if (fails.length) {
      const searchClean = fails.every((f) => f.training) && unsure.every((f) => f.training)
      if (searchClean) {
        const learners = [...new Set(fails.map((f) => f.learner).filter((x): x is string => !!x))]
        if (fails.every((f) => f.choice) && learners.length) {
          const asks = fails.every((f) => f.rule)
          return {
            status: 'fail', lead: 'Almost', value: 'only learning blocked',
            sentence: asks
              ? `your site asks ${listWords(learners)} not to learn from it. That’s your choice: nothing we saw turns ${SEARCHERS[test] ?? who} away.`
              : `your site turns away ${listWords(learners.map((l) => LEARNER_VISITOR[l] ?? l))} (${learners.length > 1 ? 'they only gather' : 'it only gathers'} pages to train AI). Nothing we saw turns ${SEARCHERS[test] ?? who} away.`,
            todo: `If you want ${listWords(learners)} to learn about you, ask whoever runs your site to let ${learners.length > 1 ? 'them' : 'it'} in.`,
            evidence: [...rows, problems(fails)], limits,
          }
        }
        return { status: 'fail', lead: 'Almost', value, sentence: fails[0].sentence, todo: fails[0].todo, evidence: [...rows, problems(fails)], limits }
      }
      const first = fails.find((f) => !f.training) ?? fails[0]
      return { status: 'fail', value, sentence: first.sentence, todo: first.todo, evidence: [...rows, problems(fails)], limits }
    }
    if (unsure.length) {
      return { status: 'unknown', value: 'couldn’t check', sentence: unsure[0].sentence, evidence: [...rows, { label: 'couldn’t check', value: unsure.map((f) => f.sentence).join(' ') }], limits }
    }
    const pages = total === 1 ? 'your page' : `all ${num(total)} of your pages`
    const pass = test === 'others'
      ? `Our visits using each one’s name opened ${pages}, and nothing asks ${listWords(OTHERS_NAMED, 'or')} to stay away.`
      : `Our visits using ${who}’s name opened ${pages}, and nothing asks ${who} to stay away.`
    return { status: 'pass', value, sentence: [pass, test === 'bing' ? copilotSaid(copilotShort, copilotNoText) : ''].filter(Boolean).join(' '), evidence: rows, limits }
  }
}

function robotsRowFor(f: SeoPageFetch | undefined): string {
  if (!f) return 'not visited'
  return f.status == null ? `no answer (${errorWords(f.error)})` : `answered ${f.status}`
}

/* ── allowed ────────────────────────────────────────────────────────────────────────── */

/** The two crawlers whose listing `allowed` judges (and crawl.ts reports). */
export const SEARCH_BOTS = ['googlebot', 'bingbot'] as const

/** One page however its address ends: "/about/" and "/about" are the same page, query kept. */
export const pathKey = (u: URL) => `${trimTrailingSlashes(u.pathname) || '/'}${u.search}`

/**
 * The canonicals one visit names, read the way `allowed` reads them: every `<link rel=canonical>`
 * in the head, then a `Link: <…>; rel=canonical` header, each resolved against the page's
 * `<base href>` and the address that answered (`finalUrl`). `url` is null when it doesn't parse.
 * [] when the visit isn't a readable page (no answer, a wall, an error, not html) or names none.
 */
export function canonicalTargets(f: SeoPageFetch | undefined, origin: string, path: string): { raw: string; url: URL | null }[] {
  if (!f) return []
  const cv = readVisit(f)
  if (cv.kind !== 'ok' || !f.html) return []
  const { canonicals, base } = headLinks(f.html)
  const m = /<([^>]+)>\s*;[^,]*\brel\s*=\s*"?canonical"?/i.exec((f.headers?.link ?? '').slice(0, 4096))
  if (m) canonicals.push(m[1].trim())
  const answeredAt = f.finalUrl ?? `${origin}${path}`
  const baseUrl = safe(() => (base ? new URL(decodeEntities(base), answeredAt).toString() : answeredAt), answeredAt)
  return canonicals.filter((c) => c !== '').map((c) => ({ raw: c, url: safe(() => new URL(decodeEntities(c), baseUrl), null as URL | null) }))
}

const allowed: Inner = (e) => {
  const limits = 'We check the pages we opened; a page can also be hidden from inside Google Search Console or Bing Webmaster Tools, which we can’t see.'
  if (!Array.isArray(e.paths) || !e.paths.length || !Array.isArray(e.plain) || !e.plain.length) return { status: 'unknown', value: 'couldn’t check', sentence: 'we have no pages from your site to look at.', evidence: [], limits }
  const down = siteDown(e)
  if (down) return { status: 'unknown', value: down.value, sentence: down.sentence, evidence: [], limits }
  if (!SEARCH_BOTS.every((k) => Array.isArray(e.byBot?.[k]))) return { status: 'unknown', value: 'couldn’t check', sentence: 'we didn’t visit as Google and Bing, so we can’t tell what they are told.', evidence: [], limits }
  const now = Date.parse(e.gatheredAt) || Date.now()
  const fails: { path: string | null; sentence: string; todo: string }[] = []
  const unsure: string[] = []
  const rows = { meta: [] as string[], tag: [] as string[], robots: [] as string[], canonical: [] as string[], notes: [] as string[] }
  if (namesArtistOnHome(e) === false) unsure.push(notTheSite(e))
  let robotsDone = false
  for (const path of e.paths) {
    // The settings file, for Google and Bing.
    for (const key of SEARCH_BOTS) {
      const bot = SEO_BOTS.find((b) => b.key === key)!
      const v = robotsVerdict(e.robots ?? { status: null, body: null }, robotsTokensOf(bot), path)
      if (v.why === 'server-error' || v.verdict === 'unknown') {
        if (!robotsDone) {
          robotsDone = true
          if (v.why === 'server-error') fails.push({ path: null, sentence: 'your site gives an error when search engines ask for its settings, so they stay away from your whole site.', todo: 'Ask whoever runs your site to fix its settings for search engines.' })
          else unsure.push(robotsUnread(e, v, 'search engines'))
          rows.robots.push(robotsRow(e))
        }
        continue
      }
      if (v.verdict === 'blocked') {
        rows.robots.push(`${v.check?.rule ? describeRule(v.check.rule) : 'blocked'} for ${bot.robotsToken} on ${path}`)
        fails.push({ path, sentence: `your site’s settings for search engines tell ${bot.who} to skip ${pageName(path)}.`, todo: `Ask whoever runs your site to let ${bot.who} list that page.` })
      }
    }
    // The page as a person gets it, and as Google and Bing get it.
    const plainF = e.plain.find((p) => p.path === path)
    const pv = readVisit(plainF)
    if (pv.kind === 'away') {
      fails.push({ path, sentence: pv.private ? `${pageName(path)} sends visitors to a private address.` : `${pageName(path)} sends visitors to another site (${hostOf(pv.to)}), so search engines list that site instead.`, todo: 'Ask whoever runs your site to make that page open on your own site.' })
      continue
    }
    if (pv.kind === 'status' && path !== '/' && (pv.status === 404 || pv.status === 410)) {
      rows.notes.push(`${path} doesn’t open for anyone (${pv.status})`)
      continue
    }
    if (pv.kind !== 'ok') {
      unsure.push(pv.kind === 'no-answer' && pv.outOfTime ? `we ran out of time before we reached ${pageName(path)}.` : `we couldn’t read ${pageName(path)}.`)
      continue
    }
    const copies: [string, SeoPageFetch | undefined][] = [['a person', plainF], ...SEARCH_BOTS.map((k) => [SEO_BOTS.find((b) => b.key === k)!.who, e.byBot[k].find((x) => x.path === path)] as [string, SeoPageFetch | undefined])]
    const missingCopy = copies.find(([, f]) => !f)
    if (missingCopy) unsure.push(`we didn’t visit ${pageName(path)} as ${missingCopy[0]}, so we can’t tell what it is told.`)
    let listed = true
    for (const [label, f] of copies) {
      if (!f) continue
      const cv = readVisit(f)
      const hit = noindexFor(f, cv.kind === 'ok' ? cv.page : null, [...SEARCH_BOTS], now)
      if (hit) {
        ;(hit.startsWith('X-Robots-Tag') ? rows.tag : rows.meta).push(`${hit} (${label}, ${path})`)
        fails.push({ path, sentence: `${pageName(path)} asks search engines not to list it.`, todo: 'Ask whoever runs your site to let search engines list that page.' })
        listed = false
        break
      }
    }
    if (!listed) continue
    // The canonical, in each copy: another site or another page means "list that one instead".
    let canonSaid = false
    for (const [label, f] of copies) {
      if (!f || canonSaid) continue
      const targets = canonicalTargets(f, e.origin, path)
      if (!targets.length) continue
      const answeredAt = f.finalUrl ?? `${e.origin}${path}`
      rows.canonical.push(`${path} (${label}) → ${targets.map((t) => clip(t.raw, 80)).join(' + ')}`)
      const distinct = new Set(targets.map((t) => (t.url ? `${t.url.host}${pathKey(t.url)}` : t.raw)))
      // Two that disagree: Google may ignore both, or pick either. Each is judged, and noted.
      if (distinct.size > 1) rows.notes.push(`${path} names two different main addresses; Google may ignore both or pick either`)
      const here = safe(() => new URL(answeredAt), null as URL | null)
      for (const { url: target } of targets) {
        if (canonSaid) break
        if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
          fails.push({ path, sentence: `${pageName(path)} points search engines to an address that doesn’t work.`, todo: 'Ask whoever runs your site to fix that page’s address for search engines.' })
          canonSaid = true
        } else if (!sameSite(target.toString(), e.origin)) {
          fails.push({ path, sentence: `${pageName(path)} tells search engines to list another site (${target.host}) instead.`, todo: 'Ask whoever runs your site to fix that page’s address for search engines.' })
          canonSaid = true
        } else if (here && pathKey(target) !== pathKey(here) && pathKey(target) !== pathKey(safe(() => new URL(`${e.origin}${path}`), here))) {
          // Pointing back to the address we ASKED for, from where it redirected (a regional
          // edition: "/" → "/us" naming "/"), is the usual pattern, not "list another page".
          const to = pathKey(target) === '/' ? 'your home page' : `your page ${pathKey(target)}`
          fails.push({ path, sentence: `${pageName(path)} tells search engines to list ${to} instead.`, todo: 'Ask whoever runs your site to fix that page’s address for search engines.' })
          canonSaid = true
        } else if (here && target.protocol === 'http:' && here.protocol === 'https:') {
          rows.notes.push(`${path} names its http:// address as the main one`)
        }
      }
    }
    if (pv.truncated && !fails.some((f) => f.path === path)) unsure.push(`${pageName(path)} is over 1 MB, and we read only the start of it.`)
  }
  const evidence: Row[] = [
    { label: 'meta robots', value: rows.meta.join('; ') || 'no noindex' },
    { label: 'X-Robots-Tag', value: rows.tag.join('; ') || 'no noindex' },
    { label: 'robots.txt', value: rows.robots.join('; ') || (e.robots?.status == null ? 'no answer' : e.robots.status >= 200 && e.robots.status < 300 ? 'read, nothing blocks Google or Bing' : `error ${e.robots.status}, so no rules`) },
    { label: 'canonical', value: rows.canonical.join('; ') || 'not set' },
    ...(rows.notes.length ? [{ label: 'notes', value: rows.notes.join('; ') }] : []),
  ]
  const gone = new Set(rows.notes.filter((x) => x.includes('doesn’t open for anyone')).map((x) => x.split(' ')[0]))
  const counted = e.paths.filter((p) => !gone.has(p))
  const n = counted.length
  if (fails.length) {
    const bad = new Set(fails.map((f) => f.path ?? '*'))
    const okCount = bad.has('*') ? 0 : counted.filter((p) => !bad.has(p)).length
    return { status: 'fail', value: `${okCount} of ${plural(n, 'page')}`, sentence: fails[0].sentence, todo: fails[0].todo, evidence: [...evidence, { label: 'problems', value: fails.map((f) => f.sentence).join(' ') }], limits }
  }
  if (unsure.length) return { status: 'unknown', value: 'couldn’t check', sentence: unsure[0], evidence: [...evidence, { label: 'couldn’t check', value: unsure.join(' ') }], limits }
  return { status: 'pass', value: `${plural(n, 'page')} can be listed`, sentence: `Nothing on your ${n === 1 ? 'page' : `${num(n)} pages`} tells search engines to skip ${n === 1 ? 'it' : 'them'}.`, evidence, limits }
}

/* ── list ───────────────────────────────────────────────────────────────────────────── */

/** W3C Datetime (the format sitemaps.org names): YYYY, YYYY-MM, YYYY-MM-DD, or a full time
 *  with a zone. The day must exist in its month ("2026-02-31" does not). */
export function isW3cDate(s: string): boolean {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/.exec(s)
  if (!m) return false
  const [, y, mo, d, hh, mi, ss] = m
  if (mo && (Number(mo) < 1 || Number(mo) > 12)) return false
  if (d) {
    const days = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate()
    if (Number(d) < 1 || Number(d) > days) return false
  }
  if (hh && (Number(hh) > 23 || Number(mi) > 59 || (ss && Number(ss) > 59))) return false
  return true
}
/** The earliest moment a W3C date can mean ("2026-09" → 1 September): a date is in the future
 *  only when even that is still to come. */
function earliestMoment(s: string): number {
  if (/^\d{4}$/.test(s)) return Date.UTC(Number(s), 0, 1)
  if (/^\d{4}-\d{2}$/.test(s)) return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`)
  return Date.parse(s)
}

const list: Inner = (e) => {
  const sm = e.sitemap
  const listedPaths = new Set((sm?.urls ?? []).map((u) => safe(() => pathKey(new URL(u)), '')))
  const openedListed = (Array.isArray(e.plain) ? e.plain : []).filter((f) => listedPaths.has(safe(() => pathKey(new URL(`${e.origin}${f.path}`)), f.path)))
  const limits = `We opened ${plural(openedListed.length, 'page')} from the list, and only Google Search Console shows whether Google has read it.`
  if (!sm || !Array.isArray(sm.urls) || !Array.isArray(e.plain) || !Array.isArray(e.paths) || !e.paths.length) return { status: 'unknown', value: 'couldn’t check', sentence: 'we didn’t open your list of pages.', evidence: [], limits }
  const where = sm.url ? sm.url.replace(/^https?:\/\/[^/]+/, '') || '/' : '/sitemap.xml'
  const rows: Row[] = [{ label: 'sitemap', value: `${where} · ${sm.status == null ? `no answer (${errorWords(sm.error)})` : `answered ${sm.status}`}${sm.format ? ` · ${sm.format}` : ''}` }]
  if (sm.tried?.length) rows.push({ label: 'tried', value: sm.tried.map((t) => `${t.url.replace(/^https?:\/\/[^/]+/, '')} ${t.status ?? 'no answer'}`).join(' · ') })
  if (sm.namedElsewhere?.length) rows.push({ label: 'named on another site', value: sm.namedElsewhere.join(' · ') })
  const elsewhere = sm.namedElsewhere?.length ? hostOf(sm.namedElsewhere[0]) : null
  const down = siteDown(e)
  if (sm.status == null || sm.status >= 500 || REFUSALS.has(sm.status)) {
    if (down && (sm.status == null || sm.status >= 500)) return { status: 'unknown', value: down.value, sentence: down.sentence, evidence: rows, limits }
    const sentence = sm.status == null ? `we couldn’t open your list of pages (${errorWords(sm.error)}).`
      : sm.status >= 500 ? 'your list of pages gave an error when we opened it, so we couldn’t read it.'
        : 'your site wouldn’t show us its list of pages.'
    return { status: 'unknown', value: 'couldn’t check', sentence, evidence: rows, limits }
  }
  if (sm.status < 200 || sm.status >= 300) {
    if (elsewhere) return { status: 'unknown', value: 'couldn’t check', sentence: `your site points to a list of pages on another site (${elsewhere}), which we don’t open.`, evidence: rows, limits }
    return { status: 'fail', value: 'no list', sentence: 'your site has no list of its pages for search engines.', good: 'A list of every page that search engines can find.', todo: 'Ask whoever runs your site to add a list of pages for search engines.', evidence: rows, limits }
  }
  if (sm.parsed === false) {
    if (sm.truncated) return { status: 'unknown', value: 'couldn’t check', sentence: 'your list of pages is too big for us to read.', evidence: rows, limits }
    // Evidence from before `format` existed: a failed parse there meant an html page.
    return sm.format === 'html' || sm.format === undefined
      ? { status: 'fail', value: 'not a real list', sentence: 'the list of pages your site gives search engines isn’t a real list (it’s a web page).', todo: 'Ask whoever runs your site to fix the list of pages.', evidence: rows, limits }
      : { status: 'fail', value: 'not a real list', sentence: 'the list of pages your site gives search engines isn’t in a form they can read.', todo: 'Ask whoever runs your site to fix the list of pages.', evidence: rows, limits }
  }
  const total = sm.total ?? sm.urls.length
  rows.push({ label: 'URLs', value: `${num(total)}${sm.urls.length ? ` · ${sm.urls.slice(0, 5).map((u) => safe(() => pathKey(new URL(u)), u)).join(' · ')}${sm.urls.length > 5 ? ' …' : ''}` : ''}` })
  if (sm.truncated) rows.push({ label: 'size', value: 'too long to read whole; we read only the start' })
  if (sm.children?.length) rows.push({ label: 'lists inside', value: `${sm.children.map((c) => `${c.url.replace(/^https?:\/\/[^/]+/, '')} ${c.status ?? 'no answer'}`).join(' · ')}${sm.childTotal && sm.childTotal > sm.children.length ? ` (${sm.children.length} of ${sm.childTotal} opened)` : ''}` })
  const robotsRead = e.robots?.status != null && e.robots.status >= 200 && e.robots.status < 300
  rows.push({ label: 'named in robots.txt', value: sm.namedInRobots ? 'yes' : robotsRead ? 'no' : `robots.txt ${robotsRow(e)}` })
  if (sm.otherSpelling) rows.push({ label: 'other spellings', value: `${sm.otherSpelling} addresses spelled with http:// or another form of your domain` })
  const dated = sm.lastmods.filter((d): d is string => !!d)
  // Every page on one date is often the build time, which Google learns to ignore; but a site
  // published in one go is dated that way honestly, so it is noted, never judged.
  const oneDate = dated.length >= 3 && dated.every((d) => d === dated[0])
  rows.push({ label: 'lastmod', value: dated.length ? `${num(dated.length)} of ${num(sm.lastmods.length)} dated · newest ${[...dated].sort().slice(-1)[0]}${oneDate ? ' · every page has the same date' : ''}` : 'none' })

  const hard: { sentence: string; todo?: string }[] = []
  const soft: { sentence: string; todo?: string }[] = []
  const unsure: string[] = []
  const now = Date.parse(e.gatheredAt) || Date.now()
  if ((sm.badLocs?.count ?? 0) > 0) {
    rows.push({ label: 'not full addresses', value: `${sm.badLocs!.count} · ${sm.badLocs!.examples.map((u) => clip(u, 40)).join(' · ')}` })
    hard.push({ sentence: `your list has ${plural(sm.badLocs!.count, 'entry', 'entries')} that ${sm.badLocs!.count === 1 ? 'isn’t a full web address' : 'aren’t full web addresses'}, which search engines skip.`, todo: 'Ask whoever runs your site to list full addresses, starting with https://.' })
  }
  if (total === 0 && (sm.offSite?.count ?? 0) === 0 && (sm.badLocs?.count ?? 0) === 0) hard.push({ sentence: 'your list of pages is empty.', todo: 'Ask whoever runs your site to list every page in it.' })
  for (const c of sm.children ?? []) {
    if (c.status == null || c.status >= 500 || REFUSALS.has(c.status)) unsure.push('we couldn’t open part of your list of pages.')
    else if (c.status < 200 || c.status >= 300) hard.push({ sentence: 'part of your list of pages doesn’t open.', todo: 'Ask whoever runs your site to fix the list of pages.' })
  }
  // The pages on the list that we opened.
  const broken: string[] = []
  for (const f of openedListed) {
    const v = readVisit(f)
    if (v.kind === 'no-answer' && v.outOfTime) unsure.push(`we ran out of time before we reached ${pageName(f.path)} from your list.`)
    else if (v.kind === 'no-answer' || v.kind === 'wall' || (v.kind === 'status' && REFUSALS.has(v.status))) unsure.push(`we couldn’t open ${pageName(f.path)} from your list.`)
    else if (v.kind === 'status') broken.push(`${f.path} (${statusWords(v.status)})`)
    else if (v.kind === 'soft404') broken.push(`${f.path} (says “page not found”)`)
    else if (v.kind === 'away' || v.kind === 'broken-redirect' || v.kind === 'login') broken.push(`${f.path} (doesn’t open as a page)`)
  }
  // Listed pages that ask not to be listed, or that the settings keep Google from: a list
  // should hold only pages meant to be found. Noted; the `allowed` test judges them.
  const unlisted = openedListed.filter((f) => {
    const v = readVisit(f)
    const blocked = robotsVerdict(e.robots ?? { status: null, body: null }, ['Googlebot'], f.path).verdict === 'blocked'
    return blocked || (v.kind === 'ok' && noindexFor(f, v.page, ['googlebot'], now) !== null)
  })
  if (unlisted.length) rows.push({ label: 'note', value: `${unlisted.map((f) => f.path).join(' · ')} on the list ${unlisted.length === 1 ? 'asks' : 'ask'} not to be listed, or ${unlisted.length === 1 ? 'is' : 'are'} kept from Google` })
  if (broken.length) {
    rows.push({ label: 'pages that don’t open', value: broken.join(' · ') })
    hard.push({ sentence: `${plural(broken.length, 'page')} on your list ${broken.length === 1 ? 'doesn’t' : 'don’t'} open: ${broken.slice(0, 2).join(', ')}${broken.length > 2 ? ', …' : ''}.`, todo: 'Ask whoever runs your site to take old pages off the list, or bring them back.' })
  }
  if ((sm.offSite?.count ?? 0) > 0) {
    rows.push({ label: 'other sites', value: `${sm.offSite!.count} · ${sm.offSite!.examples.map((u) => clip(u, 60)).join(' · ')}` })
    hard.push({ sentence: `your list names ${plural(sm.offSite!.count, 'page')} on other sites, which search engines ignore.`, todo: 'Ask whoever runs your site to keep only your own pages in the list.' })
  }
  const junk = dated.filter((d) => !isW3cDate(d))
  // 36 hours of slack: a site's "today" may be ahead of ours by a time zone.
  const future = dated.filter((d) => isW3cDate(d) && earliestMoment(d) > now + 36 * 3600_000)
  if (future.length) hard.push({ sentence: `your list dates ${plural(future.length, 'page')} in the future (${future[0]}), so search engines stop trusting its dates.` })
  if (junk.length) hard.push({ sentence: `your list has ${plural(junk.length, 'date')} that ${junk.length === 1 ? 'isn’t a real date' : 'aren’t real dates'} (${clip(junk[0], 30)}).` })
  if (!sm.namedInRobots && sm.namedElsewhere?.length) {
    // It names a list on another site (which we don't open); the one we read works. A note.
    rows.push({ label: 'note', value: `robots.txt names a list on another site (${hostOf(sm.namedElsewhere[0])}); we read ${where} instead` })
  } else if (!sm.namedInRobots) {
    if (robotsRead) soft.push({ sentence: 'your list of pages exists, but your site’s settings for search engines don’t point to it.', todo: 'Ask whoever runs your site to point search engines to the list.' })
    else if (e.robots?.status === 404 || e.robots?.status === 410) soft.push({ sentence: 'your list of pages exists, but your site has no settings file for search engines to point to it.', todo: 'Ask whoever runs your site to add settings for search engines that point to the list.' })
  }
  if (!dated.length && total > 0 && sm.format !== 'text') soft.push({ sentence: 'your list doesn’t say when each page last changed, so search engines can’t tell what’s new.' })

  const value = `${num(total)} ${total === 1 ? 'page' : 'pages'}`
  if (hard.length) return { status: 'fail', value, sentence: hard[0].sentence, todo: hard[0].todo, evidence: rows, limits }
  if (unsure.length) return { status: 'unknown', value: 'couldn’t check', sentence: unsure[0], evidence: rows, limits }
  if (soft.length) return { status: 'fail', lead: 'Almost', value, sentence: soft[0].sentence, todo: soft[0].todo, evidence: rows, limits }
  const k = openedListed.length
  let sentence = `Your site gives search engines a list of ${value}`
  if (k && k >= total) sentence += total === 1 ? ', and it opens.' : `, and all ${num(total)} open.`
  else if (k) sentence += `. We opened ${num(k)} of the ${num(total)}, and they work.`
  else sentence += '.'
  if (sm.childTotal && sm.children && sm.childTotal > sm.children.length) sentence = `${sentence.slice(0, -1)} (we read ${sm.children.length} of its ${sm.childTotal} lists).`
  rows.push({ label: 'pages opened', value: k ? `${k}, all open` : 'none from the list' })
  return { status: 'pass', value, sentence, evidence: rows, limits }
}

/* ── words ──────────────────────────────────────────────────────────────────────────── */

const words: Inner = (e) => {
  const limits = 'We look for your words on the pages we opened, and we can’t tell whether a style on your site hides them from view.'
  const pub = e.known?.published
  if (!pub) return { status: 'unknown', value: 'couldn’t check', sentence: 'we don’t have your published details to look for.', evidence: [], limits }
  if (!Array.isArray(e.paths) || !e.paths.length) return { status: 'unknown', value: 'couldn’t check', sentence: 'we have no pages from your site to look at.', evidence: [], limits }
  const down = siteDown(e)
  if (down) return { status: 'unknown', value: down.value, sentence: down.sentence, evidence: [], limits }
  const { needles, skipped } = needlesOf(pub)
  const readable: { path: string; visit: Extract<Visit, { kind: 'ok' }>; raw: string }[] = []
  const unread: string[] = []
  for (const f of Array.isArray(e.plain) ? e.plain : []) {
    const v = readVisit(f)
    if (v.kind === 'ok') readable.push({ path: f.path, visit: v, raw: f.html ?? '' })
    // A page that doesn't exist (404 / 410) can't hold the words: not a blind spot.
    else if (!(v.kind === 'status' && (v.status === 404 || v.status === 410))) unread.push(f.path)
  }
  const rows: Row[] = [{ label: 'JavaScript', value: 'off (we never run scripts)' }, { label: 'pages read', value: readable.map((r) => r.path).join(' · ') || 'none' }]
  if (skipped.length) rows.push({ label: 'in Tapir: not looked for', value: skipped.slice(0, 5).join('; ') })
  if (!needles.length) {
    return { status: 'na', value: 'nothing to look for', sentence: 'there’s no bio, release or upcoming show in Tapir that we can look for yet.', evidence: rows, limits }
  }
  if (!readable.length) return { status: 'unknown', value: 'couldn’t check', sentence: 'we couldn’t read any of your pages.', evidence: rows, limits }
  if (namesArtistOnHome(e) === false) return { status: 'unknown', value: 'couldn’t check', sentence: notTheSite(e), evidence: rows, limits }
  const on = (n: Needle) => readable.some((r) => n.found(r.visit.hay))
  const rawHay = spaced(readable.map((r) => r.raw).join(' ')).replace(/\s+/g, '')
  const bio = needles.filter((n) => n.kind === 'bio')
  const bioFound = bio.filter(on)
  const missingItems = needles.filter((n) => n.kind !== 'bio' && !on(n))
  if (bio.length) rows.push({ label: 'bio', value: `${bioFound.length} of ${plural(bio.length, 'sentence')} in the text` })
  for (const kind of ['release', 'show'] as const) {
    const all = needles.filter((n) => n.kind === kind)
    if (!all.length) continue
    const miss = all.filter((n) => !on(n))
    rows.push({ label: kind === 'release' ? 'releases' : 'shows', value: `${all.length - miss.length} of ${all.length}${kind === 'show' ? ' upcoming' : ''} in the text` })
    if (miss.length) rows.push({ label: `in Tapir: ${kind === 'release' ? 'releases' : 'shows'} not in the text`, value: miss.slice(0, 5).map((n) => clip(n.label, 30)).join(', ') })
  }
  const bioMissing = bioFound.length < bio.length
  if (!bioMissing && !missingItems.length) {
    const rel = needles.filter((n) => n.kind === 'release').length
    const sh = needles.filter((n) => n.kind === 'show').length
    const parts = [bio.length ? 'bio' : '', rel ? plural(rel, 'release') : '', sh ? plural(sh, 'show') : ''].filter(Boolean)
    const single = parts.length === 1 && (parts[0] === 'bio' || /^1 /.test(parts[0]))
    return { status: 'pass', value: clip(parts.join(', '), 28), sentence: `Your ${listWords(parts)} ${single ? 'is' : 'are'} right in the page, as words.`, evidence: rows, limits }
  }
  // Something is missing. If a page could not be read, was cut, or was never opened, it may be there.
  const blind = [...unread, ...readable.filter((r) => r.visit.truncated).map((r) => r.path)]
  const more = unopened(e)
  if (blind.length || more) {
    if (blind.length) rows.push({ label: 'not read', value: blind.join(' · ') })
    if (more) rows.push({ label: 'not opened', value: `${more} more ${more === 1 ? 'page' : 'pages'} on your site` })
    return { status: 'unknown', value: 'couldn’t check', sentence: 'some of your words weren’t on the pages we opened, and your site has more pages we didn’t open or couldn’t read.', evidence: rows, limits }
  }
  let bioSentence: string | null = null
  if (bioMissing) {
    const hidden = bio.filter((n) => !on(n)).every((n) => rawHay.includes(spaced(n.label.replace(/…$/, '')).replace(/\s+/g, '')))
    bioSentence = bioFound.length === 0
      ? hidden ? 'your bio is on your site where search engines see it, but not where people read it.' : 'your bio isn’t on your pages as words.'
      : `only ${bioFound.length} of ${plural(bio.length, 'sentence')} of your bio ${bioFound.length === 1 ? 'is' : 'are'} on your pages as words.`
  }
  // A show whose venue is on the page, but not its date or city, is said as exactly that.
  const venueOnly = missingItems.filter((m) => m.kind === 'show' && readable.some((r) => m.named?.(r.visit.hay)))
  const absent = missingItems.filter((m) => !venueOnly.includes(m))
  const named = absent.slice(0, 3).map((m) => `“${clip(m.label, 30)}”`)
  const clauses = [
    absent.length ? `your pages don’t show ${listWords(named)}${absent.length > 3 ? ` and ${plural(absent.length - 3, 'more')}` : ''} as words` : '',
    venueOnly.length ? `${absent.length ? 'they' : 'your pages'} name ${listWords(venueOnly.slice(0, 2).map((m) => `“${clip(m.label, 30)}”`))} but not the show’s date or city` : '',
  ].filter(Boolean)
  const missSentence = clauses.length ? `${clauses.join(', and ')}.` : null
  const sentence = bioSentence && missSentence ? `${bioSentence.slice(0, -1)}, and ${missSentence}` : (bioSentence ?? missSentence!)
  const value = bioMissing ? (missingItems.length ? `bio + ${plural(missingItems.length, 'item')} missing` : 'bio missing') : `${plural(missingItems.length, 'item')} missing`
  return { status: 'fail', value: clip(value, 28), sentence, todo: 'Write these on your site as text, not only inside a picture.', evidence: rows, limits }
}

/* ── bingwm ─────────────────────────────────────────────────────────────────────────── */

const BING_CODE = /^[0-9a-f]{32}$/i

const bingwm: Inner = (e) => {
  const limits = 'The code shows someone started linking your site; we can’t see whether that finished, or whether anyone reads Bing’s reports.'
  const homeF = Array.isArray(e.plain) ? e.plain.find((p) => p.path === '/') ?? e.plain[0] : undefined
  const home = homeF ? readVisit(homeF) : null
  const meta = home?.kind === 'ok' ? (home.page.meta['msvalidate.01'] ?? []).map((s) => s.trim()).find((s) => BING_CODE.test(s)) ?? null : null
  const file = e.bing?.siteAuth
  const fileRow = !file ? 'not checked' : file.status == null ? 'no answer' : file.hasUser ? `${file.status}, holds a code` : REFUSALS.has(file.status) ? `refused to us (${file.status})` : `${file.status}, no Bing file`
  const rows: Row[] = [
    { label: 'msvalidate.01', value: meta ? 'found (a 32-character code)' : home?.kind === 'ok' ? 'no code on the home page' : 'home page not read' },
    { label: 'BingSiteAuth.xml', value: fileRow },
  ]
  if (meta || file?.hasUser) return { status: 'pass', value: 'code found', sentence: 'Your site carries the code Bing Webmaster Tools gives you when you link a site.', evidence: rows, limits }
  const down = siteDown(e)
  if (down) return { status: 'unknown', value: down.value, sentence: down.sentence, evidence: rows, limits }
  const action = { kind: 'outside' as const, href: 'https://www.bing.com/webmasters', label: 'Open Bing Webmaster Tools' }
  if (home?.kind !== 'ok') return { status: 'unknown', value: 'couldn’t check', sentence: 'we couldn’t read your home page, where Bing Webmaster Tools’ code would be.', evidence: rows, limits, action }
  return {
    status: 'unknown', value: 'couldn’t check', evidence: rows, limits, action,
    sentence: 'we saw no sign of Bing Webmaster Tools on your site. It may be linked in a way we can’t see.',
    todo: 'If you haven’t linked it yet, sign in to Bing Webmaster Tools and add your site. It takes about 5 minutes.',
  }
}

/* ── the table ──────────────────────────────────────────────────────────────────────── */

/** Every test is total: a bug or a malformed evidence object is "couldn't check", never a
 *  throw and never a pass. */
function total(id: FoundId, test: Inner): SeoTest {
  return (e) => {
    try {
      const r: Result = test(e)
      return { id, ...r }
    } catch {
      return { id, status: 'unknown', value: 'couldn’t check', sentence: 'something went wrong reading your site, so we couldn’t check this.', evidence: [], limits: 'This check stopped before it finished, so it tells you nothing this time.' }
    }
  }
}

export const FOUND_TESTS: Record<FoundId, SeoTest> = {
  google: total('google', botTest('google')),
  bing: total('bing', botTest('bing')),
  chatgpt: total('chatgpt', botTest('chatgpt')),
  claude: total('claude', botTest('claude')),
  perplexity: total('perplexity', botTest('perplexity')),
  others: total('others', botTest('others')),
  allowed: total('allowed', allowed),
  list: total('list', list),
  words: total('words', words),
  bingwm: total('bingwm', bingwm),
}

export type { SeoTestId }
/** Exposed for the found tests' sentence-case rule: these may start a sentence capitalised. */
export const FOUND_NAMES: readonly string[] = [...new Set([...Object.values(WHO), ...SEO_BOTS.map((b) => b.who), 'Google', 'Bing', 'ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'Apple', 'Common Crawl'])]
