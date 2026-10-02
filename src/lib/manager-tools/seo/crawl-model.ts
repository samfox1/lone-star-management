/**
 * HOW CRAWLERS SEE YOUR SITE: the words and numbers, pure (Sam, 2026-09-30, round 11,
 * prototypes/seo_variants_20260930_r11.html). The section shows what a run SAW (types.ts
 * SeoCrawl): robots.txt, the sitemap, the page tags, each crawler's visits, and whether Google and
 * Bing list the pages. FACTS, not verdicts: the 24 tests judge. The only judging here is the mark
 * on each of the five rows (check / red alert / dashed ring) and "N of 5 fine", each counted from
 * the stored facts, never assumed.
 *
 * Every string in a crawl came from the artist's site or from Google / Bing. It is returned here
 * as plain text; the section renders it as React text, never as html.
 *
 * BING HAS NO "LISTED". Bing's API says when it last crawled a page, not whether the page is in
 * its index, so nothing about Bing here ever says "listed" (types.ts SeoCrawl.listing).
 */
import { SEO_BOTS } from '@/lib/seo-tests/bots'
import type { SeoBot, SeoCrawl } from '@/lib/seo-tests/types'
import { plural, shortDay, shortLink } from '../format'

export type CrawlBot = SeoCrawl['robots']['bots'][number]
export type CrawlPage = SeoCrawl['pages'][number]

/** A row's mark: `ok` a check, `bad` a red alert (something blocks or fails), `unknown` a dashed
 *  ring (couldn't read, not asked). */
export type CrawlMark = 'ok' | 'bad' | 'unknown'

export const CRAWL_ROWS = [
  { id: 'robots', name: 'robots.txt' },
  { id: 'sitemap', name: 'Sitemap' },
  { id: 'tags', name: 'Page address and tags' },
  { id: 'visits', name: 'Crawler visits' },
  { id: 'listed', name: 'Listed on Google and Bing' },
] as const
export type CrawlRowId = (typeof CRAWL_ROWS)[number]['id']

/** The right side of a row: its short value and its mark. */
export type CrawlFace = { value: string; mark: CrawlMark }

/** Words with some parts set as code (a robots.txt line): `{ code: 'Allow: /' }`. */
export type Words = (string | { code: string })[]

/** Where to look when we can't: the providers' own tools (https, fixed here). */
export const SEARCH_CONSOLE = { label: 'Open Google Search Console', href: 'https://search.google.com/search-console' }
export const BING_WEBMASTER = { label: 'Open Bing Webmaster Tools', href: 'https://www.bing.com/webmasters' }

/** A page Google doesn't list: its link to Search Console's inspect page, where "Request indexing" is. */
export const ASK_GOOGLE = 'Ask Google'
const SEARCH_CONSOLE_INSPECT = 'https://search.google.com/search-console/inspect'

/**
 * Search Console's inspect page for one of the site's pages. https and the host are fixed here; only
 * the two values vary, both encoded: the property (`origin` + "/", the address Tapir registered)
 * and the page (`origin` + `path`). null without an origin, or for a path not from the root.
 */
export function requestIndexingHref(origin: string | null | undefined, path: string): string | null {
  if (!origin || !path.startsWith('/')) return null
  return `${SEARCH_CONSOLE_INSPECT}?resource_id=${encodeURIComponent(`${origin}/`)}&id=${encodeURIComponent(`${origin}${path}`)}`
}

/* ── is there one to show ───────────────────────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The crawl, when it is one this page can read: shape version 1 with each part present. Anything
 * else (none yet, a later version, a stored value cut short) is null, and the section is not
 * drawn: a half-read crawl would show a wrong "fine".
 */
export function crawlToShow(c: unknown): SeoCrawl | null {
  if (!isObj(c) || c.v !== 1) return null
  const robots = c.robots
  const sitemap = c.sitemap
  const ok =
    isObj(robots) &&
    Array.isArray(robots.bots) &&
    robots.bots.every(isObj) &&
    isObj(sitemap) &&
    Array.isArray(sitemap.pages) &&
    sitemap.pages.every(isObj) &&
    Array.isArray(c.pages) &&
    c.pages.every((p) => isObj(p) && isObj(p.canonical) && isObj(p.noindex) && isObj(p.visits)) &&
    isObj(c.listing)
  return ok ? (c as unknown as SeoCrawl) : null
}

/* ── small words ────────────────────────────────────────────────────────────────────── */

/** A 2xx: the page opened. */
export const opens = (s: number | null | undefined): s is number => typeof s === 'number' && s >= 200 && s < 300

/** "answered 200", or "no answer". */
export const answered = (s: number | null | undefined): string => (typeof s === 'number' ? `answered ${s}` : 'no answer')

/** The site's origin as the run tested it: robots.txt is read at origin + "/robots.txt". */
export function crawlOrigin(crawl: SeoCrawl, fallback?: string | null): string | null {
  for (const u of [crawl.robots.url, fallback]) {
    try {
      if (u) return new URL(u).origin
    } catch {
      /* try the next */
    }
  }
  return null
}

/** A calendar day in the manager's own zone: "Sep 29, 2026". A date with no time ("2026-09-29",
 *  a sitemap's usual form) is that day everywhere, never shifted a day by a time zone. '' for
 *  nothing or a bad date. */
export function dayText(iso: string | null | undefined, locale?: string): string {
  if (!iso) return ''
  const s = iso.trim()
  const ym = /^(\d{4})-(\d{2})$/.exec(s)
  if (ym) return new Date(+ym[1], +ym[2] - 1, 1).toLocaleDateString(locale, { month: 'short', year: 'numeric' })
  if (/^\d{4}$/.test(s)) return s
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const at = d ? new Date(+d[1], +d[2] - 1, +d[3]) : new Date(s)
  if (!Number.isFinite(at.getTime())) return ''
  return shortDay(at, { locale })
}

/* ── who runs which crawler ─────────────────────────────────────────────────────────── */

/**
 * The company behind each test's crawlers. `others` holds several companies, so there a
 * crawler's company comes from bots.ts: its `company` ("Meta" for Meta AI, "Amazon" for Alexa),
 * else its own plain name ("Apple", "Common Crawl"). A Record over the union: a new test is a
 * compile error here until it is named (AGENTS.md rule 4).
 */
const COMPANY_BY_TEST: Record<SeoBot['test'], string | null> = {
  google: 'Google',
  bing: 'Microsoft',
  chatgpt: 'OpenAI',
  claude: 'Anthropic',
  perplexity: 'Perplexity',
  others: null,
}

/** Who runs a crawler, from bots.ts. A robots.txt name only (Gemini's Google-Extended) belongs to
 *  the company whose crawler does its visiting (`visitsAs`). A key bots.ts no longer knows keeps
 *  its own plain name. */
export function companyOf(key: string, who: string): string {
  const bot = SEO_BOTS.find((b) => b.key === key)
  if (!bot) return who || 'Other'
  const visitor = (bot.visitsAs && SEO_BOTS.find((b) => b.key === bot.visitsAs)) || bot
  return COMPANY_BY_TEST[visitor.test] ?? visitor.company ?? visitor.who
}

/** Crawlers grouped by company, companies in the order they first appear. */
export function byCompany<T extends { key: string; who: string }>(bots: readonly T[]): { company: string; bots: T[] }[] {
  const out: { company: string; bots: T[] }[] = []
  for (const b of bots) {
    const company = companyOf(b.key, b.who)
    const g = out.find((x) => x.company === company)
    if (g) g.bots.push(b)
    else out.push({ company, bots: [b] })
  }
  return out
}

/* ── 1. robots.txt ──────────────────────────────────────────────────────────────────── */

export function robotsFace(robots: SeoCrawl['robots']): CrawlFace {
  const bots = robots.bots
  const blocked = bots.filter((b) => b.verdict === 'blocked').length
  if (blocked) return { mark: 'bad', value: blocked === bots.length ? 'blocks every crawler' : `blocks ${plural(blocked, 'crawler', 'crawlers')}` }
  if (!bots.length || bots.some((b) => b.verdict !== 'allowed')) return { mark: 'unknown', value: 'couldn’t read' }
  if (bots.every((b) => b.why === 'no-file')) return { mark: 'ok', value: 'no file (everyone allowed)' }
  return { mark: 'ok', value: 'lets every crawler in' }
}

/** What decided for one crawler, as one key: two crawlers with the same key were decided alike. */
export const decisionOf = (b: Pick<CrawlBot, 'why' | 'group' | 'rule'>): string => `${b.why}\n${b.group ?? ''}\n${b.rule ?? ''}`

/** When the whole file is one answer (no rules read), what it means. */
const WHY_WORDS: Record<Exclude<CrawlBot['why'], 'rules'>, string> = {
  'no-file': 'There’s no robots.txt file, so every crawler may visit every page.',
  'server-error': 'The file answered with an error. Crawlers treat that as “keep out of the whole site” until it answers properly.',
  'not-shown': 'The site wouldn’t show us the file, so we can’t say what it tells crawlers.',
  'slow-down': 'The site told us to slow down when we asked for the file, so we couldn’t read it.',
  'no-answer': 'We couldn’t read the file, so we can’t say what it tells crawlers.',
}

const isStarGroup = (g: string) => /^user-agent:\s*\*$/i.test(g.trim())

/**
 * The line above WHO IT LETS IN, and which decision it covers (`common`): a crawler whose own
 * decision is `common` is not given its rule again in the table. When every crawler was decided
 * the same way, one line says how. When most were, it says theirs and the table gives the others
 * theirs. Otherwise there is no line and every crawler shows its own.
 */
export function robotsLead(bots: readonly CrawlBot[]): { words: Words; common: string } | null {
  if (!bots.length) return null
  const counts = new Map<string, number>()
  for (const b of bots) counts.set(decisionOf(b), (counts.get(decisionOf(b)) ?? 0) + 1)
  const [common, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const first = bots.find((b) => decisionOf(b) === common)!
  if (n === bots.length) {
    if (first.why !== 'rules') return { words: [WHY_WORDS[first.why] ?? WHY_WORDS['no-answer']], common }
    if (!first.group) return { words: ['No group in the file applies to these crawlers, so they may visit.'], common }
    const opener: Words = isStarGroup(first.group)
      ? ['None of these crawlers is named, so the ', { code: first.group }, ' group covers all of them']
      : ['All of these crawlers follow the ', { code: first.group }, ' group']
    return { words: first.rule ? [...opener, ': ', { code: first.rule }] : [...opener, '. None of its rules applies, so they may visit.'], common }
  }
  // Most, but not all: say theirs once, and let the table name the rest.
  if (n * 2 > bots.length && first.why === 'rules' && first.group && first.rule) {
    return { words: ['Most follow the ', { code: first.group }, ' group: ', { code: first.rule }, '. The others show their own rule.'], common }
  }
  return null
}

/** The rule that decided for one crawler, spelled as robots.txt lines: "User-agent: GPTBot ·
 *  Disallow: /". '' when no group or rule decided. */
export function ruleText(b: Pick<CrawlBot, 'group' | 'rule'>): string {
  return [b.group, b.rule].filter(Boolean).join(' · ')
}

/** NOTE: only what is true of this file. A Host line: Google and Bing skip it. */
export function robotsNotes(text: string | null): Words[] {
  const notes: Words[] = []
  if (text && /^[ \t]*host[ \t]*:/im.test(text)) {
    notes.push(['Google and Bing skip the ', { code: 'Host' }, ' line (only Yandex ever used it), so it does no harm.'])
  }
  return notes
}

/* ── 2. the sitemap ─────────────────────────────────────────────────────────────────── */

/** One listed page's "opens" cell: its status when the run opened it; `null` status = not opened
 *  (or, for a page the run did open, no answer). */
export type ListedPage = SeoCrawl['sitemap']['pages'][number] & { opened: boolean }

export function sitemapPages(crawl: SeoCrawl): ListedPage[] {
  const opened = new Set(crawl.pages.map((p) => p.path))
  return crawl.sitemap.pages.map((p) => ({ ...p, opened: p.status != null || opened.has(p.path) }))
}

export function sitemapFace(crawl: SeoCrawl): CrawlFace {
  const s = crawl.sitemap
  if (s.status == null) return { mark: 'unknown', value: 'couldn’t read' }
  if (s.status === 404 || s.status === 410) return { mark: 'bad', value: 'none found' }
  if (!opens(s.status)) return { mark: 'bad', value: answered(s.status) }
  const total = Math.max(s.total, s.pages.length)
  if (!total) return { mark: 'bad', value: 'no pages in it' }
  const tried = sitemapPages(crawl).filter((p) => p.opened)
  const shut = tried.filter((p) => !opens(p.status)).length
  const pages = plural(total, 'page', 'pages')
  if (shut) return { mark: 'bad', value: `${pages} · ${plural(shut, 'doesn’t', 'don’t')} open` }
  if (!tried.length) return { mark: 'ok', value: pages }
  if (tried.length === total) return { mark: 'ok', value: `${pages} · all open` }
  return { mark: 'ok', value: `${pages} · ${tried.length} tried, all open` }
}

/* ── 3. page address and tags ───────────────────────────────────────────────────────── */

export type CanonicalState = 'self' | 'other' | 'none'

/** What a page's canonical says: itself (same origin, path and query), another address, or none. */
export function canonicalState(url: string | null | undefined, origin: string | null, path: string): CanonicalState {
  if (!url) return 'none'
  try {
    const u = new URL(url)
    // No origin to hold it to (never expected: robots.txt's address carries it): the path alone.
    if (!origin) return `${u.pathname}${u.search}` === path ? 'self' : 'other'
    const own = new URL(path, origin)
    return u.origin === own.origin && u.pathname === own.pathname && u.search === own.search ? 'self' : 'other'
  } catch {
    return 'other'
  }
}

const VISITORS = ['person', 'google', 'bing'] as const

/** The pages whose tags can be read: the ones that opened for a person. */
const readPages = (crawl: SeoCrawl) => crawl.pages.filter((p) => opens(p.status))

/** A page whose canonical is not the same for a person, Google and Bing. */
export const canonicalDiffers = (p: CrawlPage): boolean => p.canonical.person !== p.canonical.google || p.canonical.person !== p.canonical.bing

/** "/about: a person gets www.x.com/about, Google www.x.com, Bing no tag". */
export function canonicalDiffText(p: CrawlPage): string {
  const say = (u: string | null) => (u ? shortLink(u) : 'no tag')
  return `${p.path}: a person gets ${say(p.canonical.person)}, Google ${say(p.canonical.google)}, Bing ${say(p.canonical.bing)}`
}

/** Which "don't list this page" signal a page carries: its tag, a header, or both. */
export function noindexBy(p: CrawlPage): string | null {
  const { meta, header } = p.noindex
  return meta && header ? 'by its tag and a header' : meta ? 'by its tag' : header ? 'by a header' : null
}

export function tagsFace(crawl: SeoCrawl, origin: string | null): CrawlFace {
  const pages = readPages(crawl)
  if (!pages.length) return { mark: 'unknown', value: 'couldn’t check' }
  const skip = pages.filter((p) => noindexBy(p)).length
  if (skip) return { mark: 'bad', value: `${plural(skip, 'page says', 'pages say')} don’t list` }
  const states = pages.map((p) => VISITORS.map((v) => canonicalState(p.canonical[v], origin, p.path)))
  const elsewhere = states.filter((s) => s.includes('other')).length
  if (elsewhere) return { mark: 'bad', value: `${plural(elsewhere, 'page points', 'pages point')} elsewhere` }
  const self = states.filter((s) => s.every((x) => x === 'self')).length
  if (self === pages.length) return { mark: 'ok', value: 'each page points to itself' }
  if (states.every((s) => s.every((x) => x === 'none'))) return { mark: 'ok', value: 'no canonical tags' }
  return { mark: 'ok', value: `${self} of ${pages.length} point to themselves` }
}

/** The other spelling (apex ↔ www) sends a visitor to the site's own host. */
export function sendsHome(other: NonNullable<SeoCrawl['otherHost']>, origin: string | null): boolean {
  if (!other.to || !origin) return false
  try {
    return new URL(other.to).host === new URL(origin).host
  } catch {
    return false
  }
}

/** The other spelling's redirect, in words: "308 permanent", "302 temporary". */
export function redirectWord(status: number | null): string {
  if (status === 301 || status === 308) return `${status} permanent`
  if (status === 302 || status === 303 || status === 307) return `${status} temporary`
  return answered(status)
}

/* ── 4. crawler visits ──────────────────────────────────────────────────────────────── */

/** What one crawler got on one page: its status, or null for no answer (or no visit recorded). */
export const visitOf = (p: CrawlPage, key: string): number | null => {
  const s = p.visits[key]
  return typeof s === 'number' ? s : null
}

export function visitsFace(crawl: SeoCrawl): CrawlFace {
  const visitors = crawl.robots.bots.filter((b) => b.visits)
  const pages = crawl.pages
  if (!visitors.length || !pages.length) return { mark: 'unknown', value: 'couldn’t check' }
  const cells = pages.flatMap((p) => visitors.map((b) => visitOf(p, b.key)))
  const all = pages.filter((p) => visitors.every((b) => opens(visitOf(p, b.key)))).length
  const value = `${plural(visitors.length, 'crawler', 'crawlers')} · ${all} of ${plural(pages.length, 'page', 'pages')}`
  if (cells.some((s) => s != null && !opens(s))) return { mark: 'bad', value }
  if (cells.some((s) => s == null)) return { mark: 'unknown', value }
  return { mark: 'ok', value }
}

/* ── 5. listed on Google and Bing ───────────────────────────────────────────────────── */

type GoogleEntry = NonNullable<SeoCrawl['listing']['google']>[number]
type BingEntry = NonNullable<SeoCrawl['listing']['bing']>[number]

/** Google's answer for one page (URL Inspection's verdict): "Listed" for PASS (and PARTIAL, its
 *  retired "valid with warnings", still in the index); asked but no answer = "no answer" (never
 *  "not listed"); Google's own "unspecified" = no answer. NEUTRAL is Google's "Excluded", which
 *  covers harmless states ("Page with redirect", "Alternate page with proper canonical tag"): a
 *  ring, not red. Only FAIL ("Error") is red. */
export function googleWord(e: Pick<GoogleEntry, 'answered' | 'verdict' | 'coverage'>): { word: string; mark: CrawlMark } {
  const says = googleSays(e)
  if (says === 'no-answer') return { word: 'no answer', mark: 'unknown' }
  if (says === 'listed') return { word: 'Listed', mark: 'ok' }
  const word = e.coverage ? `Not listed: ${e.coverage}` : 'Not listed'
  return { word, mark: e.verdict === 'FAIL' ? 'bad' : 'unknown' }
}

/** Google's answer in three: it lists the page, it answered and doesn't, or no answer. */
function googleSays(e: Pick<GoogleEntry, 'answered' | 'verdict'>): 'listed' | 'not-listed' | 'no-answer' {
  if (!e.answered || e.verdict == null || e.verdict === 'VERDICT_UNSPECIFIED') return 'no-answer'
  return e.verdict === 'PASS' || e.verdict === 'PARTIAL' ? 'listed' : 'not-listed'
}

/** Google's states where asking won't help: the page points somewhere else on purpose ("Page with
 *  redirect", "Alternate page with proper canonical tag", "Duplicate, Google chose different
 *  canonical than user"), the site keeps Google out ("Excluded by 'noindex' tag", "Blocked by
 *  robots.txt"), or the page is gone ("Not found (404)", "Soft 404"). Fix the page instead;
 *  Request indexing changes nothing. */
const ASKING_WONT_HELP = /redirect|canonical|noindex|robots\.txt|404/i

/** Google answered and doesn't list the page (the "Not listed" word), for a reason asking can fix:
 *  the page gets `ASK_GOOGLE`. */
export const googleNotListed = (e: Pick<GoogleEntry, 'answered' | 'verdict' | 'coverage'>): boolean =>
  googleSays(e) === 'not-listed' && !ASKING_WONT_HELP.test(e.coverage ?? '')

/** Bing's answer for one page. Only when it last visited: never "listed". Asked but no answer =
 *  "no answer", never "no visit on record" (which is Bing saying it has none). */
export function bingWord(e: Pick<BingEntry, 'answered' | 'lastCrawled'>, day: string): string {
  if (!e.answered) return 'no answer'
  return e.lastCrawled ? (day ? `last visited ${day}` : 'last visited') : 'no visit on record'
}

export function listingFace(listing: SeoCrawl['listing']): CrawlFace {
  const g = Array.isArray(listing.google) ? listing.google : null
  const b = Array.isArray(listing.bing) ? listing.bing : null
  if (g && g.length && g.every((e) => !e.answered)) return { mark: 'unknown', value: 'couldn’t ask Google' }
  if (g) {
    const words = g.map(googleWord)
    const listed = words.filter((w) => w.mark === 'ok').length
    const value = `${listed} of ${g.length} on Google`
    if (words.some((w) => w.mark === 'bad')) return { mark: 'bad', value }
    return { mark: g.length && words.every((w) => w.mark === 'ok') ? 'ok' : 'unknown', value }
  }
  // Bing alone never makes this row fine: when it visited is not whether it lists a page.
  if (b && b.length && b.every((e) => !e.answered)) return { mark: 'unknown', value: 'couldn’t ask Bing' }
  if (b) return { mark: 'unknown', value: `Bing visited ${b.filter((e) => e.lastCrawled).length} of ${b.length}` }
  return { mark: 'unknown', value: 'can’t see from outside' }
}

/* ── the five rows ──────────────────────────────────────────────────────────────────── */

export function crawlFaces(crawl: SeoCrawl, origin: string | null): Record<CrawlRowId, CrawlFace> {
  return {
    robots: robotsFace(crawl.robots),
    sitemap: sitemapFace(crawl),
    tags: tagsFace(crawl, origin),
    visits: visitsFace(crawl),
    listed: listingFace(crawl.listing),
  }
}

/** "4 of 5 fine": only a check counts; a ring is not fine and not a fail. */
export function fineCount(faces: Record<CrawlRowId, CrawlFace>): { fine: number; total: number } {
  const all = CRAWL_ROWS.map((r) => faces[r.id])
  return { fine: all.filter((f) => f.mark === 'ok').length, total: all.length }
}
