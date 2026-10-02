/**
 * Reading a LIVE page the way a crawler that runs no scripts does: its title, its meta tags,
 * its canonical link, its visible words, its pictures and every fact card (JSON-LD) block.
 * Shared by the who / shared / facts tests (types.ts).
 *
 * One linear pass over the html (`tokens`), never a regex that can backtrack across a 5 MB
 * page, and never a DOM (tests run in node). What it does NOT do, and so no test may claim:
 *   - run scripts: anything a script adds after the page loads is not here;
 *   - apply CSS: text hidden by a stylesheet still counts as visible;
 *   - fix broken nesting: an unclosed `<svg>` or `<template>` hides the rest of the page,
 *     which is also what a browser does.
 *
 * Every reader is total: junk html gives empty answers, never a throw.
 */
import { trimTrailingSlashes } from '@/lib/url'
import type { SeoEvidence, SeoPageFetch } from './types'

/* ── entities ───────────────────────────────────────────────────────────────────────── */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', bull: '•', times: '×',
  shy: '\u00AD', zwnj: '\u200C', zwj: '\u200D', lrm: '\u200E', rlm: '\u200F', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
}

/** `&#x27;` → `'`, `&amp;` → `&`. React escapes the quotes and ampersands a bio is full of,
 *  so text read off a page is decoded before anything is compared or counted. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    const lower = body.toLowerCase()
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[lower] ?? whole
  })
}

/** Whitespace runs → one space, trimmed. */
export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Words for comparing and counting: letters and digits, lower-cased. The one rule for "the
 *  same words" when Tapir's text is looked for in a page (found.ts `words`, facts.ts `releases`). */
export function wordsOf(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/* ── the tokenizer ──────────────────────────────────────────────────────────────────── */

export type Attrs = Record<string, string>
type Tok =
  | { t: 'open'; name: string; attrs: Attrs; selfClosing: boolean; raw?: string }
  | { t: 'close'; name: string }
  | { t: 'text'; text: string }

/** Elements whose content is text up to their own end tag, never markup. `noscript` too:
 *  its images are duplicates of the real ones, and its words are for browsers without
 *  scripts, not what a visitor sees. */
const RAW = new Set(['script', 'style', 'title', 'textarea', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes'])
/** What JavaScript's `\s` matches, by char code (the old tag regex's name rule used `\s`). */
function isSpace(c: number): boolean {
  return (
    c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  )
}

/**
 * The tag grammar the old regex read, `<(\/?)([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>`
 * (plain characters, "…" and '…' runs, then `>`), walked by hand. The regex rescanned to the
 * end of the page from EVERY `<` whose tag never closes: quadratic, ~153 s for 1 MiB of
 * `<a href="` (security review 2026-09-29), on the one thread every request shares.
 *
 * Linear: two lookup tables built once, backwards (the next `>`/`"`/`'`, and where a tag name
 * stops), and every quote reached from outside a quoted run remembers where its tag ends, so
 * a later `<` that reaches the same quote reuses the answer instead of rescanning. One
 * difference, pathological only: a tag NAME holding a quote is not re-split when its tag
 * fails to close (the regex backtracked into the name; no real page has one).
 */
function tagReader(html: string): { nameEnd: (from: number) => number; bodyEnd: (from: number) => number } {
  const n = html.length
  let special: Int32Array | null = null
  let stop: Int32Array | null = null
  const ends = new Map<number, number>()
  const build = () => {
    special = new Int32Array(n + 1)
    stop = new Int32Array(n + 1)
    special[n] = n
    stop[n] = n
    for (let i = n - 1; i >= 0; i--) {
      const c = html.charCodeAt(i)
      special[i] = c === 62 || c === 34 || c === 39 ? i : special[i + 1]
      stop[i] = c === 62 || c === 47 || isSpace(c) ? i : stop[i + 1]
    }
  }
  return {
    /** Where `[^\s/>]*` starting at `from` stops. */
    nameEnd(from) {
      if (!stop) build()
      return from >= n ? n : stop![from]
    },
    /** The index of the `>` that ends a tag body starting at `from`, or -1 when it never ends. */
    bodyEnd(from) {
      if (!special) build()
      const seen: number[] = []
      let p = from
      let out = -1
      for (;;) {
        const k = p >= n ? n : special![p]
        if (k >= n) break
        if (html.charCodeAt(k) === 62) {
          out = k
          break
        }
        const known = ends.get(k)
        if (known !== undefined) {
          out = known
          break
        }
        seen.push(k)
        const close = html.indexOf(html[k], k + 1)
        if (close < 0) break
        p = close + 1
      }
      for (const k of seen) ends.set(k, out)
      return out
    },
  }
}

const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

export function parseAttrs(s: string): Attrs {
  const out: Attrs = {}
  for (const m of s.matchAll(ATTR)) {
    const name = m[1].toLowerCase()
    // The FIRST of a repeated attribute wins, as in a browser.
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

function tokenize(html: string): Tok[] {
  const toks: Tok[] = []
  const n = html.length
  const tags = tagReader(html)
  let i = 0
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      toks.push({ t: 'text', text: html.slice(i) })
      break
    }
    if (lt > i) toks.push({ t: 'text', text: html.slice(i, lt) })
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    const next = html[lt + 1]
    if (next === '!' || next === '?') {
      // A doctype, CDATA or a bogus comment: skipped whole.
      const end = html.indexOf('>', lt)
      i = end < 0 ? n : end + 1
      continue
    }
    const isClose = next === '/'
    const nameStart = lt + (isClose ? 2 : 1)
    const bodyStart = nameStart < n && isLetter(html.charCodeAt(nameStart)) ? tags.nameEnd(nameStart + 1) : -1
    const end = bodyStart < 0 ? -1 : tags.bodyEnd(bodyStart)
    if (end < 0) {
      toks.push({ t: 'text', text: '<' })
      i = lt + 1
      continue
    }
    const name = html.slice(nameStart, bodyStart).toLowerCase()
    i = end + 1
    if (isClose) {
      toks.push({ t: 'close', name })
      continue
    }
    const attrText = html.slice(bodyStart, end)
    const selfClosing = /\/\s*$/.test(attrText)
    const tok: Tok = { t: 'open', name, attrs: parseAttrs(attrText), selfClosing }
    if (RAW.has(name) && !selfClosing) {
      const close = new RegExp(`</${name}\\s*>`, 'gi')
      close.lastIndex = i
      const c = close.exec(html)
      tok.raw = html.slice(i, c ? c.index : n)
      i = c ? close.lastIndex : n
    }
    toks.push(tok)
  }
  return toks
}

/* ── a page ─────────────────────────────────────────────────────────────────────────── */

type LdBlock = { raw: string; parsed: unknown; error: string | null }

export type Page = {
  /** The first `<title>` outside an svg, decoded and collapsed; null when there is none. */
  title: string | null
  titleCount: number
  /** name= / property= (lower-cased) → every content value, in page order. */
  meta: Record<string, string[]>
  canonical: string | null
  /** Every `<a href>` outside svg/template. */
  links: string[]
  /** Every `<img>` outside svg/template/noscript, with its attributes. */
  images: Attrs[]
  /** Every `<script type="application/ld+json">` block, parsed or with why not. */
  ld: LdBlock[]
  /** Visible words: body text outside scripts, styles, svg, template, noscript. */
  text: string
}

const LD_TYPE = /^application\/ld\+json$/i

function readPage(html: string): Page {
  const meta: Record<string, string[]> = {}
  const images: Attrs[] = []
  const links: string[] = []
  const ld: LdBlock[] = []
  const text: string[] = []
  let title: string | null = null
  let titleCount = 0
  let canonical: string | null = null
  let svg = 0
  let template = 0
  for (const tok of tokenize(html)) {
    if (tok.t === 'text') {
      if (!svg && !template) text.push(tok.text)
      continue
    }
    if (tok.t === 'close') {
      if (tok.name === 'svg' && svg) svg--
      else if (tok.name === 'template' && template) template--
      continue
    }
    const { name, attrs } = tok
    if (name === 'svg') {
      if (!tok.selfClosing) svg++
      continue
    }
    if (name === 'template') {
      if (!tok.selfClosing) template++
      continue
    }
    if (svg || template) continue
    if (name === 'title') {
      titleCount++
      if (title === null) title = collapse(decodeEntities(tok.raw ?? ''))
    } else if (name === 'meta') {
      const key = (attrs.property ?? attrs.name ?? '').trim().toLowerCase()
      if (key && 'content' in attrs) (meta[key] ??= []).push(attrs.content)
    } else if (name === 'link') {
      const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/)
      if (canonical === null && rel.includes('canonical') && attrs.href) canonical = attrs.href.trim()
    } else if (name === 'a') {
      if (attrs.href) links.push(attrs.href.trim())
    } else if (name === 'img') {
      images.push(attrs)
    } else if (name === 'script') {
      const type = (attrs.type ?? '').split(';')[0].trim()
      if (LD_TYPE.test(type)) {
        const raw = tok.raw ?? ''
        let parsed: unknown = null
        let error: string | null = null
        try {
          parsed = JSON.parse(raw)
        } catch (e) {
          error = e instanceof Error ? e.message.slice(0, 120) : 'does not parse'
        }
        ld.push({ raw, parsed, error })
      }
    }
  }
  return { title, titleCount, meta, canonical, links, images, ld, text: collapse(decodeEntities(text.join(' '))) }
}

/** The 14 tests read the same few pages: each page is read once per run, not once per test. */
const memo = new Map<string, Page>()
export function parsePage(html: string): Page {
  const hit = memo.get(html)
  if (hit) return hit
  const page = readPage(html)
  memo.set(html, page)
  if (memo.size > 8) memo.delete(memo.keys().next().value as string)
  return page
}

/** The first value of a meta tag (name or property), collapsed; null when absent or blank. */
export function metaOf(page: Page, key: string): string | null {
  const v = page.meta[key.toLowerCase()]?.[0]
  const c = v === undefined ? '' : collapse(v)
  return c || null
}

/* ── pages in the evidence ──────────────────────────────────────────────────────────── */

export type PageState =
  | { ok: true; path: string; html: string; page: Page; truncated: boolean }
  | { ok: false; path: string; why: string; noAnswer: boolean }

/** A tested page as a test sees it: read, or the plain reason it can't be. */
export function pageState(fetch: SeoPageFetch | undefined, path: string): PageState {
  const name = path === '/' ? 'your home page' : `your page ${path}`
  if (!fetch) return { ok: false, path, why: `we didn’t visit ${name}`, noAnswer: true }
  if (fetch.status === null) return { ok: false, path, why: `${name} didn’t answer${fetch.error ? ` (${plainError(fetch.error)})` : ''}`, noAnswer: true }
  if (fetch.status < 200 || fetch.status >= 300) return { ok: false, path, why: `${name} answered with error ${fetch.status}`, noAnswer: false }
  if (fetch.html === null) return { ok: false, path, why: `${name} isn’t a web page`, noAnswer: false }
  return { ok: true, path, html: fetch.html, page: parsePage(fetch.html), truncated: fetch.truncated === true }
}

function plainError(e: string): string {
  return ({ timeout: 'it timed out', network: 'no connection', 'not-public': 'not a public address', 'too-many-redirects': 'too many redirects' } as Record<string, string>)[e] ?? e
}

/** The home page: the plain visit to "/" (or the first path tested). */
export function homeOf(e: SeoEvidence): PageState {
  const fetch = e.plain.find((p) => p.path === '/') ?? e.plain[0]
  return pageState(fetch, fetch?.path ?? '/')
}

/** Every page of the plain visit, in order. */
export function pagesOf(e: SeoEvidence): PageState[] {
  return e.plain.map((f) => pageState(f, f.path))
}

/* ── the fact card (JSON-LD) ────────────────────────────────────────────────────────── */

export type LdNode = Record<string, unknown>
export const isObj = (v: unknown): v is LdNode => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The top-level nodes of one block: an `@graph` (array or single object), an array of
 *  nodes, or one node. Nested nodes (a show's performer, an album's songs) are not listed. */
export function ldNodes(parsed: unknown): LdNode[] {
  const out: LdNode[] = []
  const visit = (v: unknown, depth: number) => {
    if (depth > 4) return
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1)
      return
    }
    if (!isObj(v)) return
    const graph = v['@graph']
    if (graph !== undefined) {
      visit(graph, depth + 1)
      // A block may state a node AND a graph; the node counts too.
      if (v['@type'] !== undefined) out.push(v)
      return
    }
    out.push(v)
  }
  visit(parsed, 0)
  return out
}

/** A node's types without the schema.org prefix: `"schema:MusicGroup"` → `MusicGroup`. */
export function typesOf(node: LdNode): string[] {
  const t = node['@type']
  const list = Array.isArray(t) ? t : [t]
  return list.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, '').trim())
}

export const hasType = (node: LdNode, ...types: string[]) => typesOf(node).some((t) => types.includes(t))

/** Every top-level node of every block that parsed. */
export function pageNodes(page: Page): LdNode[] {
  return page.ld.filter((b) => b.error === null).flatMap((b) => ldNodes(b.parsed))
}

/** A property as a list of strings (a JSON-LD value may be one or many). */
export function strings(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v]
  return list.filter((x): x is string => typeof x === 'string').map(collapse).filter(Boolean)
}

/** A property as text: a string, or a `{ name }` object (a Country, a Place). */
export function textOf(v: unknown): string | null {
  if (typeof v === 'string') return collapse(v) || null
  if (Array.isArray(v)) return textOf(v[0])
  if (isObj(v) && typeof v.name === 'string') return collapse(v.name) || null
  return null
}

/**
 * The artist's own node on a page: a MusicGroup or Person at the top level. The one whose
 * `@id` ends `#artist` first (the bridge's), else the one named like the artist, else the
 * first. Several nodes with that same `@id` are ONE node in JSON-LD, so they are merged.
 * Never a nested node: a show's support act is a MusicGroup too.
 */
export function artistNodeOf(page: Page, artistName: string): LdNode | null {
  const candidates = pageNodes(page).filter((n) => hasType(n, 'MusicGroup', 'Person'))
  if (!candidates.length) return null
  const byId = candidates.filter((n) => typeof n['@id'] === 'string' && /#artist$/.test(n['@id'] as string))
  if (byId.length) {
    const id = byId[0]['@id']
    return Object.assign({}, ...byId.filter((n) => n['@id'] === id).reverse()) as LdNode
  }
  const name = fold(artistName)
  return candidates.find((n) => name && fold(textOf(n.name) ?? '') === name) ?? candidates[0]
}

/* ── words ──────────────────────────────────────────────────────────────────────────── */

/** For comparing words: NFKC, lower-case, whitespace collapsed. */
export const fold = (s: string): string => collapse(s.normalize('NFKC').toLowerCase())

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Does `text` name `name` as a whole word ("Skeen" in "Skeen · Chicago", not in "Skeens")? */
export function namesArtist(text: string, name: string): boolean {
  const n = fold(name)
  if (!n) return false
  // Japanese, Chinese, Korean and Thai run words together: "米津玄師公式サイト" names 米津玄師.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(n)) return fold(text).includes(n)
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'u').test(fold(text))
}

/** Words that say nothing about WHO: "official", "website", "home"... A title or summary
 *  made of the name plus only these is the bare name. */
const FILLER = new Set(['official', 'site', 'website', 'web', 'homepage', 'home', 'page', 'music', 'the', 'of', 'welcome', 'to', 'and', 'a', 'an', 'for', 'by'])

/** The artist's name and nothing that tells them apart: "SKEEN", "Skeen — official site". */
export function isBareName(text: string, name: string): boolean {
  const n = fold(name)
  let rest = fold(text)
  if (n) rest = rest.split(n).join(' ')
  return rest
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .every((w) => FILLER.has(w))
}

/* ── links ──────────────────────────────────────────────────────────────────────────── */

const TRACKING = /^(utm_.*|si|igsh|igshid|fbclid|ref|feature)$/i

/** "www.Example.com." → "example.com": the name that makes www and the bare domain one site. */
export function siteName(host: string): string {
  return host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
}

/**
 * One profile, however it is spelled: host without `www.`, path without a trailing slash,
 * no share-tracking query, scheme ignored. The same rule as the bridge's `profileKey`, so
 * a link the bridge de-duplicated is one link here too. Null for anything not http(s).
 */
export function linkKey(url: string): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
  u.searchParams.sort()
  return `${siteName(u.hostname)}${trimTrailingSlashes(u.pathname)}${u.search}`
}

/** Cut to `max` characters with an ellipsis. */
export function clip(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : s
}

/** "1,234" whatever the machine's locale. */
export const num = (n: number): string => n.toLocaleString('en-US')

/** "s" when n is not 1. */
export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many)

/** "YYYY-MM-DD" from an ISO date or datetime, or null when it isn't one. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : `${m[1]}-${m[2]}-${m[3]}`
}

/** "Aug 15, 2026". */
export function prettyDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
