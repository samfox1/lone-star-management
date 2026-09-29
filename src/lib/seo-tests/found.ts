/**
 * The ten "Can be found" tests. Pure, synchronous, never throw (types.ts `SeoTest`).
 *
 * THE BOT TESTS (google, bing, chatgpt, claude, perplexity, others) pass when, for every page
 * we opened and every visitor the test names (bots.ts):
 *   - the visit using the bot's name answered 2xx with a real page: not a security check
 *     (Cloudflare, Vercel, …), not a password page, not a "page not found" served as 200, not
 *     a page with almost no words for a bot that runs no scripts, and not a page very
 *     different from what a person is sent;
 *   - the settings file (robots.txt) does not disallow that page for the bot's token;
 *   - neither the page (<meta name="robots"> or <meta name="{bot}">) nor the X-Robots-Tag
 *     header says noindex / none / a past unavailable_after, for everyone or for that bot.
 * `fail` is only for what we SAW. `unknown` is for what we could not look at: no answer, a
 * settings file refused to us, or a wall that turned our person's visit away too (then it is
 * our server being turned away, not the bot).
 *
 * THE LIMIT every bot test states: we visit using the bot's NAME from our own server. A
 * firewall that checks real bot addresses can treat the real bot differently from us, in
 * either direction. So the names say "Nothing on your site turns X away" (what we can see),
 * not "X can read your site" (defs.ts).
 */
import { SEO_BOTS, botsForTest, robotsTokensOf } from './bots'
import { sameSite } from './evidence'
import { collapse, decodeEntities, parsePage, wordsOf, type Page } from './html'
import { describeRule, robotsVerdict, type RobotsVerdict } from './robots-txt'
import type { SeoBot, SeoEvidence, SeoPageFetch, SeoTest, SeoTestId, SeoTestResult } from './types'

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

const STATUS_WORDS: Record<number, string> = {
  401: 'asks for a password', 403: 'blocked', 404: 'not found', 405: 'not allowed', 410: 'gone', 429: 'too many visits',
  500: 'server error', 502: 'not available', 503: 'not available', 504: 'not available',
}
const statusWords = (s: number) => `${STATUS_WORDS[s] ?? (s >= 500 ? 'server error' : s >= 400 ? 'refused' : 'unexpected answer')}, error ${s}`

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
  } as Record<string, string>)[code] ?? 'no answer'
}

/* ── reading one visit ──────────────────────────────────────────────────────────────── */

type Visit =
  | { kind: 'ok'; page: Page | null; words: string[]; empty: boolean }
  | { kind: 'no-answer'; why: string; outOfTime: boolean }
  | { kind: 'away'; to: string; private: boolean }
  | { kind: 'broken-redirect'; status: number }
  | { kind: 'status'; status: number }
  | { kind: 'wall'; by: string; status: number }
  | { kind: 'login' }
  | { kind: 'soft404' }

/** A firewall's "prove you are human" or "you are blocked" page, by the vendor's own marks.
 *  A script the vendor adds to NORMAL pages (Cloudflare's /cdn-cgi/challenge-platform/scripts
 *  bot detection, a Turnstile widget on a form) is not a wall. */
function wallOf(f: SeoPageFetch, words: number): string | null {
  const h = f.headers ?? {}
  if (/challenge/i.test(h['cf-mitigated'] ?? '')) return 'Cloudflare'
  if (/^(challenge|deny)$/i.test((h['x-vercel-mitigated'] ?? '').trim())) return 'Vercel'
  if (/^(captcha|challenge)$/i.test((h['x-amzn-waf-action'] ?? '').trim())) return 'Amazon'
  const html = (f.html ?? '').slice(0, 300_000)
  if (!html) return null
  if (/window\._cf_chl_opt|<title>\s*just a moment\.{0,3}\s*<\/title>|<title>\s*attention required! \| cloudflare/i.test(html)) return 'Cloudflare'
  if (/id="cf-error-details"/i.test(html) && /you have been blocked/i.test(html)) return 'Cloudflare'
  if (/<title>\s*vercel security checkpoint/i.test(html)) return 'Vercel'
  if (/captcha-delivery\.com/i.test(html)) return 'DataDome'
  if (/_Incapsula_Resource/i.test(html)) return 'Imperva'
  if (/sucuri website firewall/i.test(html)) return 'Sucuri'
  if (/px-captcha|_pxCaptcha/i.test(html)) return 'HUMAN'
  if (words < 60 && /ddos-guard/i.test(html)) return 'DDoS-Guard'
  if (words < 60 && /captcha/i.test(html)) return 'a captcha'
  return null
}

const NOT_FOUND = /\b404\b|not found|could ?n[o’']t be found|does ?n[o’']t exist|no longer (?:exists|available)/i

function readVisit(f: SeoPageFetch | undefined): Visit {
  if (!f) return { kind: 'no-answer', why: 'we didn’t visit', outOfTime: false }
  if (f.status == null) {
    const [code, ...rest] = (f.error ?? '').split(': ')
    const to = rest.join(': ')
    // A redirect we refused to follow: the site sent the visit somewhere else. The first
    // address itself being refused (no "to") is our problem, not the site's.
    if ((code === 'not-allowed' || code === 'not-public') && to) return { kind: 'away', to, private: code === 'not-public' }
    return { kind: 'no-answer', why: errorWords(f.error), outOfTime: code === 'out-of-time' }
  }
  const s = f.status
  const htmlWords = f.html ? wordsOf(parsePage(f.html).text).length : 0
  const wall = wallOf(f, htmlWords)
  if (wall) return { kind: 'wall', by: wall, status: s }
  if (s >= 300 && s < 400) return { kind: 'broken-redirect', status: s }
  if (s < 200 || s >= 300) return { kind: 'status', status: s }
  if (!f.html) return { kind: 'ok', page: null, words: [], empty: false }
  const page = parsePage(f.html)
  const words = wordsOf(page.text)
  if (/<input\b[^>]*\btype\s*=\s*["']?password/i.test(f.html) && words.length < 150) return { kind: 'login' }
  const h1 = /<h1\b[^>]*>([\s\S]{0,300}?)<\/h1>/i.exec(f.html)?.[1] ?? ''
  if (words.length < 200 && (NOT_FOUND.test(page.title ?? '') || NOT_FOUND.test(h1.replace(/<[^>]*>/g, ' ')))) return { kind: 'soft404' }
  const empty = words.length < 20 && /<script\b[^>]*\bsrc\s*=/i.test(f.html)
  return { kind: 'ok', page, words, empty }
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
/** Below this, the bot was handed a different page. Dynamic bits (a date, a shuffled list)
 *  move a real page by a few percent; a bot wall or a cloaked page shares almost nothing. */
const SAME_PAGE = 0.6

/* ── "don't list me" rules: meta robots and X-Robots-Tag ────────────────────────────── */

const RULES_WITH_COLON = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after'])
const KNOWN_RULES = /^(all|noindex|index|nofollow|follow|none|nosnippet|indexifembedded|notranslate|noimageindex|noarchive|nocache|noodp|noydir|max-snippet|max-image-preview|max-video-preview|unavailable_after)\b/i

/**
 * X-Robots-Tag, per Google's spec: "googlebot: noindex" scopes the rules after it to that
 * bot until the next "bot:" prefix; no prefix = everyone. `fetch` joins repeated headers
 * with ", ", so a rule after a scoped one is read as that scope's (a header sent as two
 * lines "googlebot: nofollow" + "noindex" cannot be told apart from one line: a known limit).
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
      if (m[2].trim()) out.push({ scope, rule: m[2].trim().toLowerCase() })
      continue
    }
    const last = out[out.length - 1]
    // unavailable_after's date may itself hold a comma ("Wed, 01 Jan 2025 …").
    if (last && last.rule.startsWith('unavailable_after') && !KNOWN_RULES.test(p)) {
      last.rule += `, ${p.toLowerCase()}`
      continue
    }
    out.push({ scope, rule: p.toLowerCase() })
  }
  return out
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

/** Does this visit tell a bot answering to `names` (lower-case; "robots" = everyone) not to
 *  list the page? Returns where and what, e.g. `X-Robots-Tag: googlebot: noindex`. */
function noindexFor(f: SeoPageFetch | undefined, page: Page | null, names: string[], now: number): string | null {
  if (!f) return null
  const header = f.headers?.['x-robots-tag']
  if (header) {
    const rules = xRobotsRules(header).filter((r) => r.scope === '*' || names.includes(r.scope)).map((r) => r.rule)
    const hit = blockingRule(rules, now)
    if (hit) return `X-Robots-Tag: ${clip(header, 80)}`
  }
  if (page) {
    for (const name of ['robots', ...names]) {
      for (const content of page.meta[name] ?? []) {
        const hit = blockingRule(content.split(',').map((s) => s.toLowerCase()), now)
        if (hit) return `<meta name="${name}"> ${clip(collapse(content), 60)}`.replace(/[<>]/g, '')
      }
    }
  }
  return null
}

/* ── the bot tests ──────────────────────────────────────────────────────────────────── */

const WHO: Record<BotTestId, string> = {
  google: 'Google', bing: 'Bing', chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity', others: 'Gemini, Apple and Common Crawl',
}

type Finding = { level: 'fail' | 'unknown'; path: string | null; sentence: string; training: boolean; todo?: string }

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function robotsRow(e: SeoEvidence): string {
  const s = e.robots?.status
  if (s == null) return 'no answer'
  if (s >= 200 && s < 300) return 'read'
  return `error ${s}`
}

function robotsWhy(v: RobotsVerdict, status: number | null): string {
  if (v.why === 'not-shown') return `it was refused to us, error ${status}`
  if (v.why === 'slow-down') return 'it asked us to slow down, error 429'
  return 'it didn’t answer'
}

function botTest(test: BotTestId): Inner {
  return (e) => {
    const who = WHO[test]
    const limits = `We visit from our own server using ${test === 'others' ? 'each one’s' : `${who}’s`} name, not from ${test === 'others' ? 'them' : who} directly, so a firewall that checks who is really visiting may treat ${test === 'others' ? 'them' : who} differently than it treated us; and we only open the pages listed here.`
    const bots = botsForTest(test)
    const paths = e.paths
    if (!Array.isArray(paths) || !paths.length || !Array.isArray(e.plain) || !e.byBot) {
      return { status: 'unknown', value: 'couldn’t check', sentence: 'we have no pages from your site to look at.', evidence: [], limits }
    }
    const now = Date.parse(e.gatheredAt) || Date.now()
    const findings: Finding[] = []
    const badPaths = new Set<string>()
    const rows: Row[] = [{ label: 'Visited as', value: bots.map((b) => (b.fetches ? b.robotsToken : `${b.robotsToken} (settings only)`)).join(' · ') }]
    const robotsNotes: string[] = []
    const tagNotes: string[] = []
    const seenPage = new Set<string>()
    let robotsLevel: 'ok' | 'blocked-all' | 'unknown' = 'ok'

    for (const bot of bots) {
      const visitor = bot.fetches ? bot : SEO_BOTS.find((b) => b.key === bot.visitsAs) ?? null
      const botName = bot.who
      // 1. The settings file, for this bot's own token (and the visitor's, for a token-only one).
      const tokenSets = [robotsTokensOf(bot), ...(visitor && visitor !== bot ? [robotsTokensOf(visitor)] : [])]
      for (const path of paths) {
        for (const tokens of tokenSets) {
          const v = robotsVerdict(e.robots ?? { status: null, body: null }, tokens, path)
          if (v.verdict === 'allowed') continue
          if (v.why === 'server-error') {
            if (robotsLevel === 'ok') {
              robotsLevel = 'blocked-all'
              findings.push({ level: 'fail', path: null, training: false, sentence: `your site’s settings file is broken (error ${e.robots.status}), so ${who} stays away from your whole site.`, todo: 'Ask whoever runs your site to fix the settings file (/robots.txt).' })
            }
            paths.forEach((p) => badPaths.add(p))
            continue
          }
          if (v.verdict === 'unknown') {
            if (robotsLevel === 'ok') {
              robotsLevel = 'unknown'
              findings.push({ level: 'unknown', path: null, training: false, sentence: `we couldn’t read your site’s settings file (${robotsWhy(v, e.robots?.status ?? null)}), so we can’t tell if it lets ${who} in.` })
            }
            continue
          }
          badPaths.add(path)
          const rule = v.check?.rule ? describeRule(v.check.rule) : 'a rule'
          robotsNotes.push(`${rule} (for ${v.check?.group === '*' ? 'everyone' : tokens[0]}, on ${path})`)
          findings.push({ level: 'fail', path, training: !!bot.trainingOnly, sentence: `your site’s settings file asks ${botName} to stay away from ${pageName(path)}.`, todo: 'Remove that rule from your site’s settings file (/robots.txt).' })
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
      for (const path of paths) {
        const f = visits.find((v) => v.path === path)
        const plainF = e.plain.find((p) => p.path === path)
        const key = `${visitor.key} ${path} ${names.join(',')}`
        if (seenPage.has(key)) continue
        seenPage.add(key)
        const v = readVisit(f)
        const p = readVisit(plainF)
        const vname = visitor.who
        const add = (level: 'fail' | 'unknown', sentence: string, todo?: string) => {
          if (level === 'fail') badPaths.add(path)
          findings.push({ level, path, training: !!visitor.trainingOnly, sentence, todo })
        }
        const refusedUsToo = p.kind === 'wall' || (p.kind === 'status' && [401, 403, 429, 503].includes(p.status))
        switch (v.kind) {
          case 'no-answer':
            add('unknown', v.outOfTime ? `we ran out of time before we reached ${pageName(path)}.` : `${pageName(path)} didn’t answer our visit using ${vname}’s name (${v.why}).`)
            break
          case 'away':
            add('fail', v.private ? `${pageName(path)} sends visitors to a private address.` : `${pageName(path)} sends ${vname} to another site (${hostOf(v.to)}).`)
            break
          case 'broken-redirect':
            add('fail', `${pageName(path)} sends visitors to a broken address.`)
            break
          case 'wall':
            if (refusedUsToo) add('unknown', `your site turned away our test visits even without a bot’s name, so we can’t tell what ${who} gets.`)
            else add('fail', `a security check (${v.by}) stopped our visit using ${vname}’s name on ${pageName(path)}.`, `If you use a firewall or bot protection, check it lets ${vname} in.`)
            break
          case 'status':
            if (refusedUsToo && [401, 403, 429, 503].includes(v.status)) add('unknown', `your site turned away our test visits even without a bot’s name, so we can’t tell what ${who} gets.`)
            else add('fail', `${pageName(path)} turned away our visit using ${vname}’s name (${statusWords(v.status)}).`, p.kind === 'ok' ? `If you use a firewall or bot protection, check it lets ${vname} in.` : undefined)
            break
          case 'login':
            add('fail', `${pageName(path)} asks for a password, so ${vname} can’t read it.`)
            break
          case 'soft404':
            add('fail', `${pageName(path)} says “page not found”.`)
            break
          case 'ok': {
            if (v.empty && !visitor.runsScripts) {
              add('fail', `${pageName(path)} has almost no words until its scripts run, and ${vname} doesn’t run them.`)
              break
            }
            if (p.kind === 'ok' && v.page && p.page && !v.empty && !p.empty) {
              const same = overlap(p.words, v.words)
              if (same < SAME_PAGE) {
                add('fail', `${vname} is sent a different page than people get on ${pageName(path)} (only ${Math.round(same * 100)}% the same words).`)
                break
              }
            }
            const tag = noindexFor(f, v.page, names, now)
            if (tag) {
              tagNotes.push(`${tag} (on ${path})`)
              add('fail', `${pageName(path)} asks ${bot === visitor ? vname : who} not to list it.`, 'Remove the “noindex” setting from that page, then publish.')
            }
          }
        }
      }
      // What each visitor saw, per page, for the details.
      if (bot === visitor || !bots.includes(visitor)) {
        for (const path of paths) {
          const f = visits.find((x) => x.path === path)
          const label = path
          const seen = !f ? 'not visited' : f.status == null ? `no answer (${errorWords(f.error)})` : `${f.status}${f.headers?.server ? ` · ${f.headers.server}` : ''}`
          const row = rows.find((r) => r.label === label)
          const entry = `${visitor.robotsToken} ${seen}`
          if (row) {
            if (!row.value.includes(entry)) row.value += ` · ${entry}`
          } else rows.push({ label, value: entry })
        }
      }
    }
    rows.push({ label: 'robots.txt', value: robotsNotes.length ? robotsNotes.join('; ') : `${robotsRow(e)}${e.robots?.status != null && e.robots.status >= 200 && e.robots.status < 300 ? ', no rule blocks these visitors' : ''}` })
    rows.push({ label: 'noindex', value: tagNotes.length ? tagNotes.join('; ') : 'none seen' })

    const total = paths.length
    const good = paths.filter((p) => !badPaths.has(p)).length
    const value = `${good} of ${plural(total, 'page')}`
    const once = <T extends { sentence: string }>(list: T[]) => list.filter((f, i) => list.findIndex((g) => g.sentence === f.sentence) === i)
    const fails = once(findings.filter((f) => f.level === 'fail'))
    if (fails.length) {
      const first = fails.find((f) => !f.training) ?? fails[0]
      const onlyTraining = fails.every((f) => f.training)
      const more = fails.length > 1 ? ` (${plural(fails.length - 1, 'more problem')} in the details)` : ''
      if (onlyTraining) {
        return {
          status: 'fail', lead: 'Almost', value,
          sentence: `${who} search can open your pages, but your site turns away the part of ${who} that learns from websites. ${first.sentence[0].toUpperCase()}${first.sentence.slice(1)}${more}`.replace(/^./, (c) => c.toLowerCase()),
          todo: first.todo, evidence: [...rows, { label: 'problems', value: fails.map((f) => f.sentence).join(' ') }], limits,
        }
      }
      return { status: 'fail', value, sentence: `${first.sentence.slice(0, -1)}${more}.`, todo: first.todo, evidence: [...rows, { label: 'problems', value: fails.map((f) => f.sentence).join(' ') }], limits }
    }
    const unsure = once(findings.filter((f) => f.level === 'unknown'))
    if (unsure.length) {
      return { status: 'unknown', value: 'couldn’t check', sentence: unsure[0].sentence, evidence: [...rows, { label: 'couldn’t check', value: unsure.map((f) => f.sentence).join(' ') }], limits }
    }
    const pass = test === 'others'
      ? `Our visits using Apple’s and Common Crawl’s names opened all ${num(total)} of your pages, and nothing asks Gemini, Apple or Common Crawl to stay away.`
      : `Our visits using ${who}’s name opened all ${num(total)} of your pages, and nothing asks ${who} to stay away.`
    return { status: 'pass', value, sentence: total === 1 ? pass.replace(`all 1 of your pages`, 'your page') : pass, evidence: rows, limits }
  }
}

/* ── allowed ────────────────────────────────────────────────────────────────────────── */

const SEARCH_BOTS = ['googlebot', 'bingbot'] as const

/** Every canonical a page names: its `<link rel=canonical>` and the Link header's. Both are
 *  judged: when they disagree, one of them points somewhere else. */
function canonicalsOf(f: SeoPageFetch, page: Page | null): string[] {
  const out: string[] = []
  if (page?.canonical) out.push(page.canonical)
  const m = /<([^>]+)>\s*;[^,]*\brel\s*=\s*"?canonical"?/i.exec(f.headers?.link ?? '')
  if (m) out.push(m[1].trim())
  return out
}

const pathKey = (u: URL) => `${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`

const allowed: Inner = (e) => {
  const limits = 'We check the pages we opened; a page can also be hidden from inside Google Search Console or Bing Webmaster Tools, which we can’t see.'
  if (!Array.isArray(e.paths) || !e.paths.length || !Array.isArray(e.plain)) return { status: 'unknown', value: 'couldn’t check', sentence: 'we have no pages from your site to look at.', evidence: [], limits }
  const now = Date.parse(e.gatheredAt) || Date.now()
  const fails: { path: string | null; sentence: string; todo: string }[] = []
  const unsure: string[] = []
  const rows = { meta: [] as string[], tag: [] as string[], robots: [] as string[], canonical: [] as string[] }
  let robotsDone = false
  for (const path of e.paths) {
    // The settings file, for Google and Bing.
    for (const key of SEARCH_BOTS) {
      const bot = SEO_BOTS.find((b) => b.key === key)!
      const v = robotsVerdict(e.robots ?? { status: null, body: null }, robotsTokensOf(bot), path)
      if (v.why === 'server-error' || v.verdict === 'unknown') {
        if (!robotsDone) {
          robotsDone = true
          if (v.why === 'server-error') fails.push({ path: null, sentence: `your site’s settings file is broken (error ${e.robots.status}), so search engines stay away from your whole site.`, todo: 'Ask whoever runs your site to fix the settings file (/robots.txt).' })
          else unsure.push(`we couldn’t read your site’s settings file (${robotsWhy(v, e.robots?.status ?? null)}).`)
          rows.robots.push(`error or no answer (${e.robots?.status ?? 'none'})`)
        }
        continue
      }
      if (v.verdict === 'blocked') {
        rows.robots.push(`${v.check?.rule ? describeRule(v.check.rule) : 'blocked'} for ${bot.robotsToken} on ${path}`)
        fails.push({ path, sentence: `your site’s settings file tells ${bot.who} to skip ${pageName(path)}.`, todo: 'Remove that rule from your site’s settings file (/robots.txt).' })
      }
    }
    // The page as a person gets it, and as Google and Bing get it.
    const plainF = e.plain.find((p) => p.path === path)
    const pv = readVisit(plainF)
    if (pv.kind !== 'ok') {
      unsure.push(`we couldn’t read ${pageName(path)}.`)
      continue
    }
    const visits: [string, SeoPageFetch | undefined][] = [['a person', plainF], ...SEARCH_BOTS.map((k) => [SEO_BOTS.find((b) => b.key === k)!.who, e.byBot?.[k]?.find((x) => x.path === path)] as [string, SeoPageFetch | undefined])]
    for (const [label, f] of visits) {
      if (!f) continue
      const page = f.html ? safe(() => parsePage(f.html!), null) : null
      const hit = noindexFor(f, page, [...SEARCH_BOTS], now)
      if (hit) {
        ;(hit.startsWith('X-Robots-Tag') ? rows.tag : rows.meta).push(`${hit} (${label}, ${path})`)
        fails.push({ path, sentence: `${pageName(path)} asks search engines not to list it.`, todo: 'Remove the “noindex” setting from that page, then publish.' })
        break
      }
    }
    // The canonical: another site, or another page, means "list that one instead of me".
    for (const canon of canonicalsOf(plainF!, pv.page)) {
      let target: URL | null = null
      try {
        target = new URL(decodeEntities(canon), plainF!.finalUrl ?? `${e.origin}${path}`)
      } catch {
        target = null
      }
      rows.canonical.push(`${path} → ${clip(canon, 80)}`)
      if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
        fails.push({ path, sentence: `${pageName(path)} points search engines to an address that doesn’t work.`, todo: 'Fix the page’s main address setting, then publish.' })
      } else if (!sameSite(target.toString(), e.origin)) {
        fails.push({ path, sentence: `${pageName(path)} tells search engines to list another site (${target.host}) instead.`, todo: 'Point the page’s main address at your own site, then publish.' })
      } else {
        const here = new URL(`${e.origin}${path}`)
        if (pathKey(target) !== pathKey(here)) {
          const to = pathKey(target) === '/' ? 'your home page' : `your page ${pathKey(target)}`
          fails.push({ path, sentence: `${pageName(path)} tells search engines to list ${to} instead.`, todo: 'Point the page’s main address at itself, then publish.' })
        }
      }
    }
  }
  const evidence: Row[] = [
    { label: '<meta robots>'.replace(/[<>]/g, ''), value: rows.meta.join('; ') || 'no noindex' },
    { label: 'X-Robots-Tag', value: rows.tag.join('; ') || 'no noindex' },
    { label: 'robots.txt', value: rows.robots.join('; ') || (e.robots?.status == null ? 'no answer' : e.robots.status >= 200 && e.robots.status < 300 ? 'read, nothing blocks Google or Bing' : `error ${e.robots.status}, so no rules`) },
    { label: 'canonical', value: rows.canonical.join('; ') || 'not set' },
  ]
  const n = e.paths.length
  if (fails.length) {
    const bad = new Set(fails.map((f) => f.path ?? '*'))
    const okCount = bad.has('*') ? 0 : e.paths.filter((p) => !bad.has(p)).length
    return { status: 'fail', value: `${okCount} of ${plural(n, 'page')}`, sentence: fails[0].sentence, todo: fails[0].todo, evidence: [...evidence, { label: 'problems', value: fails.map((f) => f.sentence).join(' ') }], limits }
  }
  if (unsure.length) return { status: 'unknown', value: 'couldn’t check', sentence: unsure[0], evidence: [...evidence, { label: 'couldn’t check', value: unsure.join(' ') }], limits }
  return { status: 'pass', value: 'nothing blocks you', sentence: `Nothing on your ${n === 1 ? 'page' : `${num(n)} pages`} tells search engines to skip ${n === 1 ? 'it' : 'them'}.`, evidence, limits }
}

/* ── list ───────────────────────────────────────────────────────────────────────────── */

const W3C_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/

const list: Inner = (e) => {
  const opened = Math.max(0, (Array.isArray(e.paths) ? e.paths.length : 1) - 1)
  const limits = `We open at most ${num(Math.max(opened, 4))} pages from the list, and only Google Search Console shows whether Google has read it.`
  const sm = e.sitemap
  if (!sm || !Array.isArray(sm.urls) || !Array.isArray(e.plain)) return { status: 'unknown', value: 'couldn’t check', sentence: 'we didn’t open your list of pages.', evidence: [], limits }
  const where = sm.url ? sm.url.replace(/^https?:\/\/[^/]+/, '') || '/' : '/sitemap.xml'
  const rows: Row[] = [{ label: 'sitemap', value: `${where} · ${sm.status == null ? `no answer (${errorWords(sm.error)})` : `answered ${sm.status}`}` }]
  if (sm.status == null || [401, 403, 429, 503].includes(sm.status)) {
    return { status: 'unknown', value: 'couldn’t check', sentence: sm.status == null ? `we couldn’t open your list of pages (${errorWords(sm.error)}).` : `your site refused to show us its list of pages (error ${sm.status}).`, evidence: rows, limits }
  }
  if (sm.status < 200 || sm.status >= 300) {
    return { status: 'fail', value: 'no list', sentence: 'your site has no list of its pages for search engines.', good: 'A list of every page at /sitemap.xml, named in your site’s settings file.', todo: 'Ask whoever runs your site to add one.', evidence: rows, limits }
  }
  if (sm.parsed === false) {
    return { status: 'fail', value: 'not a real list', sentence: 'the list of pages your site gives search engines isn’t a real list (it’s a web page).', todo: 'Ask whoever runs your site to fix /sitemap.xml.', evidence: rows, limits }
  }
  const total = sm.total ?? sm.urls.length
  rows.push({ label: 'URLs', value: `${num(total)}${sm.urls.length ? ` · ${sm.urls.slice(0, 5).map((u) => safe(() => pathKey(new URL(u)), u)).join(' · ')}${sm.urls.length > 5 ? ' …' : ''}` : ''}` })
  if (sm.truncated) rows.push({ label: 'size', value: 'too long to read whole; we read only the start' })
  if (sm.children?.length) rows.push({ label: 'lists inside', value: sm.children.map((c) => `${c.url.replace(/^https?:\/\/[^/]+/, '')} ${c.status ?? 'no answer'}`).join(' · ') })
  rows.push({ label: 'named in robots.txt', value: sm.namedInRobots ? 'yes' : 'no' })
  const dated = sm.lastmods.filter((d): d is string => !!d)
  // Every page on one date is often the build time, which Google learns to ignore; but a site
  // published in one go is dated that way honestly, so it is noted, never judged.
  const oneDate = dated.length >= 3 && dated.every((d) => d === dated[0])
  rows.push({ label: 'lastmod', value: dated.length ? `${num(dated.length)} of ${num(sm.lastmods.length)} dated · newest ${[...dated].sort().slice(-1)[0]}${oneDate ? ' · every page has the same date' : ''}` : 'none' })

  const hard: { sentence: string; todo?: string }[] = []
  const soft: { sentence: string; todo?: string }[] = []
  const unsure: string[] = []
  if (total === 0 && (sm.offSite?.count ?? 0) === 0) hard.push({ sentence: 'your list of pages is empty.', todo: 'Ask whoever runs your site to list every page in it.' })
  for (const c of sm.children ?? []) {
    if (c.status == null) unsure.push(`we couldn’t open part of your list (${c.url.replace(/^https?:\/\/[^/]+/, '')}).`)
    else if (c.status < 200 || c.status >= 300) hard.push({ sentence: `part of your list of pages doesn’t open (error ${c.status}).` })
  }
  // The pages on the list that we opened.
  const listed = new Set(sm.urls.map((u) => safe(() => pathKey(new URL(u)), '')))
  const broken: string[] = []
  let openedListed = 0
  for (const f of e.plain) {
    if (!listed.has(safe(() => pathKey(new URL(`${e.origin}${f.path}`)), f.path))) continue
    openedListed++
    const v = readVisit(f)
    if (v.kind === 'no-answer' || v.kind === 'wall') unsure.push(`we couldn’t open ${pageName(f.path)} from your list.`)
    else if (v.kind === 'status') broken.push(`${f.path} (${statusWords(v.status)})`)
    else if (v.kind === 'soft404') broken.push(`${f.path} (says “page not found”)`)
    else if (v.kind === 'away' || v.kind === 'broken-redirect' || v.kind === 'login') broken.push(`${f.path} (doesn’t open as a page)`)
  }
  if (broken.length) {
    rows.push({ label: 'pages that don’t open', value: broken.join(' · ') })
    hard.push({ sentence: `${plural(broken.length, 'page')} on your list ${broken.length === 1 ? 'doesn’t' : 'don’t'} open: ${broken.join(', ')}.`, todo: 'Remove old pages from the list, or bring them back.' })
  }
  if ((sm.offSite?.count ?? 0) > 0) {
    rows.push({ label: 'other sites', value: `${sm.offSite!.count} · ${sm.offSite!.examples.map((u) => clip(u, 60)).join(' · ')}` })
    hard.push({ sentence: `your list names ${plural(sm.offSite!.count, 'page')} on other sites, which search engines ignore.`, todo: 'Keep only your own pages in the list.' })
  }
  const now = Date.parse(e.gatheredAt) || Date.now()
  const future = dated.filter((d) => W3C_DATE.test(d) && Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d) > now + 36 * 3600_000)
  const junk = dated.filter((d) => !W3C_DATE.test(d) || !Number.isFinite(Date.parse(d)))
  if (future.length) hard.push({ sentence: `your list dates ${plural(future.length, 'page')} in the future (${future[0]}), so search engines stop trusting its dates.` })
  if (junk.length) hard.push({ sentence: `your list has ${plural(junk.length, 'date')} that ${junk.length === 1 ? 'isn’t a real date' : 'aren’t real dates'} (${clip(junk[0], 30)}).` })
  if (!sm.namedInRobots) soft.push({ sentence: 'your list of pages exists, but your site’s settings file doesn’t point to it.', todo: 'Add a “Sitemap:” line to your site’s settings file (/robots.txt).' })
  if (!dated.length && total > 0) soft.push({ sentence: 'your list doesn’t say when each page last changed, so search engines can’t tell what’s new.' })

  const value = `${num(total)} ${total === 1 ? 'page' : 'pages'}`
  if (hard.length) return { status: 'fail', value, sentence: hard[0].sentence, todo: hard[0].todo, evidence: rows, limits }
  if (unsure.length) return { status: 'unknown', value: 'couldn’t check', sentence: unsure[0], evidence: rows, limits }
  if (soft.length) return { status: 'fail', lead: 'Almost', value, sentence: soft[0].sentence, todo: soft[0].todo, evidence: rows, limits }
  rows.push({ label: 'pages opened', value: openedListed ? `${openedListed}, all open` : 'none from the list' })
  return { status: 'pass', value, sentence: `Your site gives search engines a list of ${value}${openedListed ? ', and the ones we opened work' : ''}.`, evidence: rows, limits }
}

/* ── words ──────────────────────────────────────────────────────────────────────────── */

/** Letters and digits only, lower-cased: what "the same words" means when a bio typed in
 *  Tapir is compared with the text a site renders. Quotes of any shape are separators, so
 *  He's / He’s / He&rsquo;s all read "he s". */
function spaced(s: string): string {
  return ` ${wordsOf(decodeEntities(s)).join(' ')} `
}
const squashed = (s: string) => spaced(s).replace(/\s+/g, '')

/** A bio's sentences, markdown links reduced to their words. Tiny fragments are skipped. */
function bioParts(bio: string): string[] {
  return bio
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => squashed(s).length >= 8)
}

const words: Inner = (e) => {
  const limits = 'We look for your words on the pages we opened, and we can’t tell whether a style on your site hides them from view.'
  const pub = e.known?.published
  if (!pub) return { status: 'unknown', value: 'couldn’t check', sentence: 'we don’t have your published details to look for.', evidence: [], limits }
  const readable: { path: string; text: string; raw: string; truncated: boolean }[] = []
  const unread: string[] = []
  for (const f of Array.isArray(e.plain) ? e.plain : []) {
    const v = readVisit(f)
    if (v.kind === 'ok' && v.page) readable.push({ path: f.path, text: v.page.text, raw: f.html ?? '', truncated: !!f.truncated })
    else unread.push(f.path)
  }
  const rows: Row[] = [{ label: 'JavaScript', value: 'off (we never run scripts)' }, { label: 'pages read', value: readable.map((r) => r.path).join(' · ') || 'none' }]
  if (!readable.length) return { status: 'unknown', value: 'couldn’t check', sentence: 'we couldn’t read any of your pages.', evidence: rows, limits }
  const hay = spaced(readable.map((r) => r.text).join(' '))
  const hayFlat = hay.replace(/\s+/g, '')
  const rawFlat = squashed(readable.map((r) => r.raw).join(' '))
  const inText = (needle: string, loose: boolean) => {
    const s = spaced(needle)
    if (s.trim() === '') return true
    if (hay.includes(s)) return true
    const flat = s.replace(/\s+/g, '')
    return loose && flat.length >= 6 && hayFlat.includes(flat)
  }

  const missing: string[] = []
  let bioSentence: string | null = null
  const parts = pub.bio ? bioParts(pub.bio) : []
  if (parts.length) {
    const found = parts.filter((p) => inText(p, true)).length
    rows.push({ label: 'bio', value: `${found} of ${plural(parts.length, 'sentence')} in the text` })
    if (found < parts.length) {
      const hidden = parts.filter((p) => !inText(p, true)).every((p) => rawFlat.includes(squashed(p)))
      bioSentence = found === 0
        ? hidden ? 'your bio is only in the page’s hidden code, not in its words, so most AI tools won’t read it.' : 'your bio isn’t on your pages as words.'
        : `only ${found} of ${plural(parts.length, 'sentence')} of your bio ${found === 1 ? 'is' : 'are'} on your pages as words.`
    }
  }
  const releases = (pub.releases ?? []).map((r) => r.title).filter((t) => t && t.trim())
  if (releases.length) {
    const miss = releases.filter((t) => !inText(t, true))
    rows.push({ label: 'releases', value: `${releases.length - miss.length} of ${releases.length} in the text` })
    if (miss.length) rows.push({ label: 'in Tapir: releases not in the text', value: miss.slice(0, 5).map((t) => clip(t, 30)).join(', ') })
    missing.push(...miss)
  }
  const shows = (pub.tourDates ?? []).filter((t) => !t.isPast).map((t) => (t.venue ?? t.city ?? '').trim()).filter(Boolean)
  if (shows.length) {
    const miss = shows.filter((t) => !inText(t, true))
    rows.push({ label: 'shows', value: `${shows.length - miss.length} of ${shows.length} upcoming in the text` })
    if (miss.length) rows.push({ label: 'in Tapir: shows not in the text', value: miss.slice(0, 5).map((t) => clip(t, 30)).join(', ') })
    missing.push(...miss)
  }
  if (!parts.length && !releases.length && !shows.length) {
    return { status: 'unknown', value: 'nothing to look for', sentence: 'you haven’t published a bio, releases or upcoming shows for us to look for.', evidence: rows, limits }
  }
  if (!bioSentence && !missing.length) {
    const found = [parts.length ? 'bio' : '', releases.length ? plural(releases.length, 'release') : '', shows.length ? plural(shows.length, 'show') : ''].filter(Boolean)
    const said = found.length > 1 ? `${found.slice(0, -1).join(', ')} and ${found[found.length - 1]}` : found[0]
    return { status: 'pass', value: clip(found.join(', '), 28), sentence: `Your ${said} are right in the page, as words.`.replace(/^Your bio are/, 'Your bio is'), evidence: rows, limits }
  }
  // Something is missing. If a page could not be read (or was cut), it may be there.
  const blind = [...unread, ...readable.filter((r) => r.truncated).map((r) => r.path)]
  if (blind.length) {
    rows.push({ label: 'not read', value: blind.join(' · ') })
    return { status: 'unknown', value: 'couldn’t check', sentence: `we couldn’t read all of ${blind.map(pageName).join(', ')}, and some of your words weren’t on the pages we could read.`, evidence: rows, limits }
  }
  const named = missing.slice(0, 3).map((m) => `“${clip(m, 30)}”`)
  const missSentence = missing.length ? `your pages don’t show ${named.join(', ')}${missing.length > 3 ? ` and ${plural(missing.length - 3, 'more')}` : ''} as words.` : null
  const sentence = bioSentence && missSentence ? `${bioSentence.slice(0, -1)}, and ${missSentence}` : (bioSentence ?? missSentence!)
  const value = bioSentence ? (missing.length ? `bio + ${plural(missing.length, 'item')} missing` : 'bio missing') : `${plural(missing.length, 'item')} missing`
  return { status: 'fail', value: clip(value, 28), sentence, todo: 'Show these on your site as words, not only inside a picture or a script.', evidence: rows, limits }
}

/* ── bingwm ─────────────────────────────────────────────────────────────────────────── */

const bingwm: Inner = (e) => {
  const limits = 'The code shows someone started linking your site; we can’t see whether that finished, or whether anyone reads Bing’s reports.'
  const homeF = Array.isArray(e.plain) ? e.plain.find((p) => p.path === '/') ?? e.plain[0] : undefined
  const home = homeF ? readVisit(homeF) : null
  const meta = home?.kind === 'ok' && home.page ? (home.page.meta['msvalidate.01'] ?? []).map((s) => s.trim()).find(Boolean) ?? null : null
  const file = e.bing?.siteAuth
  const rows: Row[] = [
    { label: 'msvalidate.01', value: meta ? `found (${meta.length} characters)` : home?.kind === 'ok' ? 'not on the home page' : 'home page not read' },
    { label: 'BingSiteAuth.xml', value: !file ? 'not checked' : file.status == null ? 'no answer' : file.hasUser ? `${file.status}, names a user` : `${file.status}, no Bing file` },
  ]
  if (meta || file?.hasUser) return { status: 'pass', value: 'code found', sentence: 'Your site carries the code Bing Webmaster Tools gives you when you link a site.', evidence: rows, limits }
  const action = { kind: 'outside' as const, href: 'https://www.bing.com/webmasters', label: 'Open Bing Webmaster Tools' }
  return {
    status: 'unknown', value: 'can’t tell', evidence: rows, limits, action,
    sentence: 'we found no Bing code on your site, but it can also be linked through your domain or Google Search Console, which we can’t see.',
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
