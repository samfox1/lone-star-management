/**
 * The SEO / GEO test runs, kept (supabase/migrations/20260929140000_seo_test_runs.sql).
 *
 * The page reads these; it never decides a result itself (types.ts).
 *
 * WRITES go through two functions only the SERVICE ROLE may call: `seo_test_claim` (start) and
 * `seo_test_finish` (finish or fail). A manager's session can only read. So `claimRun`,
 * `finishRun` and `failRun` take the service-role client (lib/supabase/admin), and their callers
 * (test-actions.ts, the publish hook) check the signed-in manager owns the artist first and pass
 * that manager's id for the per-person limits. The database refuses a claim while a run is going
 * ("busy"), inside a cool-down, when a publish is already covered ("coalesced"), past the
 * per-person ceiling ("limit") or for someone who is not the artist's manager ("denied"), and it
 * derives `passed`, `total` and `summary` from the results. Nothing here counts anything the page
 * shows.
 *
 * Every string written is capped here first, in BYTES of its JSON form: the table's 256 KB check
 * counts bytes, and 24 results at these caps stay under ~200 KB of it.
 *
 * READERS take the manager's own client (RLS: their artists only).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEO_TEST_IDS, SEO_TEST_STATUSES, isScored, type SeoCrawl, type SeoRunReach, type SeoRunTrigger, type SeoTestHistory, type SeoTestId, type SeoTestResult, type SeoTestRun, type SeoTestStatus } from './types'

/** Mirrors the migration, for tests and copy. The database is the authority. */
export const SEO_RUN_KEEP = 30
export const SEO_MANUAL_COOLDOWN_S = 60

/** Every status the contract has, `na` included (types.ts derives the list from the union). */
const isStatus = (v: unknown): v is SeoTestStatus => typeof v === 'string' && (SEO_TEST_STATUSES as readonly string[]).includes(v)
const isTestId = (v: unknown): v is SeoTestId => typeof v === 'string' && (SEO_TEST_IDS as readonly string[]).includes(v)

/**
 * The score, as the migration's finish trigger derives it: `passed` = the passes, `total` =
 * every result that is not `na` ("does not apply" is left out on BOTH sides, so 19 passes and
 * one `na` out of 24 is "19 of 23"). For tests and for a page that has results in hand; the
 * stored `passed` / `total` are the database's and always win.
 */
export function seoScore(results: readonly { status: SeoTestStatus }[]): { passed: number; total: number } {
  let passed = 0
  let total = 0
  for (const r of results) {
    if (!isScored(r.status)) continue
    total++
    if (r.status === 'pass') passed++
  }
  return { passed, total }
}

/* ── claim / finish: the service-role functions ─────────────────────────────────────── */

export type SeoClaimRefusal = 'busy' | 'cooldown' | 'coalesced' | 'limit' | 'denied' | 'error'

export type SeoClaim =
  | { ok: true; runId: string; ranAt: string }
  | { ok: false; reason: SeoClaimRefusal; retryInS: number | null; error: string }

const REFUSED: Record<Exclude<SeoClaimRefusal, 'error'>, (retryInS: number | null) => string> = {
  busy: () => 'A test is already running. It will show here when it finishes.',
  cooldown: (s) => `Tested a moment ago. Try again in ${s ?? SEO_MANUAL_COOLDOWN_S} seconds.`,
  coalesced: () => 'Your latest publish is already being tested.',
  limit: (s) => `You’ve started a lot of tests lately. Try again in ${s ? Math.max(1, Math.ceil(s / 60)) : 30} minutes.`,
  denied: () => 'Artist not found.',
}
const isRefusal = (v: unknown): v is keyof typeof REFUSED => typeof v === 'string' && v in REFUSED

export type ClaimWho = {
  /** The signed-in manager whose click or publish this is (the per-person limits count it).
   *  null only for a scheduled run. */
  userId: string | null
  /** For a publish run: the publish it is for (what coalescing compares). */
  publishedAt?: string | null
}

/**
 * Start a run: one call to `seo_test_claim`, which the database answers. Never throws.
 * `writer` MUST be the service-role client: no other role may call it.
 */
export async function claimRun(writer: SupabaseClient, artistId: string, trigger: SeoRunTrigger, who: ClaimWho): Promise<SeoClaim> {
  const fail = (): SeoClaim => ({ ok: false, reason: 'error', retryInS: null, error: 'Couldn’t start the test.' })
  try {
    const { data, error } = await writer.rpc('seo_test_claim', {
      p_artist_id: artistId,
      p_trigger: trigger,
      p_user_id: who.userId,
      p_published_at: trigger === 'publish' ? (who.publishedAt ?? null) : null,
    })
    if (error) return fail()
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: unknown; run_id?: unknown; ran_at?: unknown; retry_in_s?: unknown } | null
    if (row?.outcome === 'claimed' && typeof row.run_id === 'string') return { ok: true, runId: row.run_id, ranAt: String(row.ran_at ?? '') }
    if (row && isRefusal(row.outcome)) {
      const retryInS = typeof row.retry_in_s === 'number' && Number.isFinite(row.retry_in_s) ? row.retry_in_s : null
      return { ok: false, reason: row.outcome, retryInS, error: REFUSED[row.outcome](retryInS) }
    }
    return fail()
  } catch {
    return fail()
  }
}

export type FinishInput = {
  results: SeoTestResult[]
  siteUrl: string | null
  siteFresh: boolean | null
  publishedAt: string | null
  note?: string | null
  /** Did the site answer (SeoEvidence.reach)? null = no site, or the run could not tell. */
  reach?: SeoRunReach | null
  /** What the run saw, for "How crawlers see your site" (types.ts SeoCrawl). null/absent = none.
   *  Stored through `capCrawl`: anything but a whole v:1 crawl is dropped, never guessed at. */
  crawl?: SeoCrawl | null
}

const REACH_STATES: readonly SeoRunReach['state'][] = ['answered', 'server-error', 'refused', 'no-answer']

/** `reach` in exactly its known shape, or null: an unknown state, a non-number status or a
 *  non-text error is never stored or shown (the migration checks the same shape). */
export function reachOf(v: unknown): SeoRunReach | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const x = v as Record<string, unknown>
  if (!REACH_STATES.includes(x.state as SeoRunReach['state'])) return null
  if (!(x.status === null || x.status === undefined || (typeof x.status === 'number' && Number.isInteger(x.status)))) return null
  if (!(x.error === undefined || x.error === null || typeof x.error === 'string')) return null
  const out: SeoRunReach = { state: x.state as SeoRunReach['state'], status: typeof x.status === 'number' ? x.status : null }
  if (typeof x.error === 'string' && x.error !== '') out.error = cutBytes(x.error, 200)
  return out
}

/**
 * The answers that mean the database turned the call WITH a crawl down, so nothing was written:
 *   PGRST202  no seo_test_finish takes `p_crawl` (20261001120000 not pushed yet)
 *   42883     the same, from Postgres when PostgREST's schema cache is behind
 *   23514     a CHECK refused it (seo_test_runs_crawl: not an object, or over 64 KB)
 *   22P02 / 22P05  jsonb refused a character in it (a lone surrogate, a NUL)
 */
const CRAWL_REFUSED = new Set(['PGRST202', '42883', '23514', '22P02', '22P05'])

/**
 * Finish a running run with its results: one call to `seo_test_finish` (service role). `true`
 * back means a RUNNING run was finished; `false` (abandoned, pruned, already finished) is not
 * reported as saved.
 *
 * The crawl rides along as `p_crawl` (capped by `capCrawl`), and only when there is one: a
 * database from before 20261001120000 has no such argument. It is extra, never the run: when
 * the database REFUSES the call with a crawl (`CRAWL_REFUSED`: that migration not pushed yet, or
 * a crawl the table refuses), the run is finished again without it, so its results are never
 * lost to the crawl. A refused call changes nothing (the function is one statement), so the
 * second call is the only write. Any other error (a dropped connection, a timeout) is NOT
 * retried: the first call may have finished the run, and a second would find it no longer
 * running and report the results as lost.
 */
export async function finishRun(writer: SupabaseClient, runId: string, input: FinishInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const fail = { ok: false as const, error: 'The test finished but its results weren’t saved.' }
  try {
    const args = {
      p_run_id: runId,
      p_status: 'done',
      p_results: capResults(input.results),
      p_site_url: input.siteUrl,
      p_site_fresh: input.siteFresh,
      p_published_at: input.publishedAt,
      p_note: capNote(input.note),
      p_reach: reachOf(input.reach),
    }
    const crawl = capCrawl(input.crawl)
    let { data, error } = await writer.rpc('seo_test_finish', crawl ? { ...args, p_crawl: crawl } : args)
    if (error && crawl && CRAWL_REFUSED.has(error.code ?? '')) ({ data, error } = await writer.rpc('seo_test_finish', args))
    return !error && data === true ? { ok: true } : fail
  } catch {
    return fail
  }
}

/** Mark a running run failed, with one plain sentence (service role). Best effort: never
 *  throws. A run left running is marked failed by the next claim after 5 minutes anyway. */
export async function failRun(writer: SupabaseClient, runId: string, note: string): Promise<void> {
  try {
    await writer.rpc('seo_test_finish', {
      p_run_id: runId,
      p_status: 'failed',
      p_results: null,
      p_site_url: null,
      p_site_fresh: null,
      p_published_at: null,
      p_note: capNote(note),
      p_reach: null,
    })
  } catch {
    // swallowed on purpose: see above
  }
}

/* ── caps, in BYTES ─────────────────────────────────────────────────────────────────── */

/**
 * What one character costs in the stored text: UTF-8 bytes of its JSON-escaped form, which is
 * how Postgres writes a jsonb string (`"` and `\\` escaped, control characters as `\\uXXXX`).
 */
function charBytes(cp: number): number {
  if (cp === 0x22 || cp === 0x5c) return 2
  if (cp < 0x20) return cp === 0x08 || cp === 0x09 || cp === 0x0a || cp === 0x0c || cp === 0x0d ? 2 : 6
  if (cp < 0x80) return 1
  if (cp < 0x800) return 2
  if (cp < 0x10000) return 3
  return 4
}

/**
 * `s` in at most `max` bytes (its JSON form), cut on a CHARACTER boundary with "…". A lone
 * surrogate (half an emoji) becomes U+FFFD: Postgres refuses one inside jsonb, which would sink
 * the whole run.
 */
function cutBytes(s: unknown, max: number): string {
  const text = typeof s === 'string' ? s : s == null ? '' : String(s)
  let out = ''
  let used = 0
  let cut = false
  const room = max - 3 // "…" is three bytes
  let kept = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    // A lone surrogate or a NUL: Postgres refuses either inside jsonb (22P02 / 22P05).
    const c = (cp >= 0xd800 && cp <= 0xdfff) || cp === 0 ? '\uFFFD' : ch
    const b = charBytes(c.codePointAt(0)!)
    if (used + b > max) {
      cut = true
      break
    }
    if (used + b <= room) kept += c
    out += c
    used += b
  }
  return cut ? `${kept}…` : out
}
/** Bytes of `s` in its stored (JSON-escaped, UTF-8) form. */
function textBytes(s: string): number {
  let n = 0
  for (const ch of s) n += charBytes(ch.codePointAt(0)!)
  return n
}
const cutOpt = (s: unknown, max: number): string | undefined => (typeof s === 'string' && s !== '' ? cutBytes(s, max) : undefined)

/** The note: the table checks CHARACTERS here (char_length <= 300), so this does too. */
const capNote = (note: string | null | undefined): string | null => {
  if (!note) return null
  const flat = [...note.replace(/[\r\n]+/g, ' ').trim()].map((ch) => (/[\uD800-\uDFFF]/.test(ch) && ch.length === 1 ? '\uFFFD' : ch))
  return (flat.length > 300 ? `${flat.slice(0, 299).join('')}…` : flat.join('')) || null
}

/** Byte caps per field. 24 results at every cap are ~190 KB of the table's 256 KB. */
const CAP = { value: 120, sentence: 800, good: 400, todo: 400, limits: 400, label: 120, evLabel: 120, evValue: 600, evTotal: 4_000, href: 1_024 } as const
const MAX_EVIDENCE = 12

/** A https address, or null. An `outside` action is rendered as a link; nothing but https may
 *  reach an href from a stored run (a `javascript:` URL in a result would be a stored XSS). */
function httpsOnly(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const u = new URL(href)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * One result as it may be stored: every string capped in bytes, evidence at most 12 rows and
 * 4,000 bytes of plain text, an `outside` action kept only with a https href. The verdict itself
 * (`id`, `status`) is never changed here; the run validates it before this.
 */
export function capResult(r: SeoTestResult): SeoTestResult {
  const evidence: SeoTestResult['evidence'] = []
  let left: number = CAP.evTotal
  for (const e of (Array.isArray(r.evidence) ? r.evidence : []).slice(0, MAX_EVIDENCE)) {
    const label = cutBytes(e?.label, Math.min(CAP.evLabel, left))
    left -= textBytes(label)
    if (left < 8) break
    const value = cutBytes(e?.value, Math.min(CAP.evValue, left))
    left -= textBytes(value)
    evidence.push({ label, value })
  }
  const out: SeoTestResult = { id: r.id, status: r.status, value: cutBytes(r.value, CAP.value), sentence: cutBytes(r.sentence, CAP.sentence), evidence }
  if (r.lead === 'Almost') out.lead = 'Almost'
  const good = cutOpt(r.good, CAP.good)
  if (good) out.good = good
  const todo = cutOpt(r.todo, CAP.todo)
  if (todo) out.todo = todo
  const limits = cutOpt(r.limits, CAP.limits)
  if (limits) out.limits = limits
  const a = r.action
  if (a?.kind === 'edit') out.action = { kind: 'edit', target: a.target, label: cutBytes(a.label, CAP.label) }
  else if (a?.kind === 'fix') out.action = { kind: 'fix', fix: a.fix, label: cutBytes(a.label, CAP.label) }
  else if (a?.kind === 'outside') {
    const href = httpsOnly(a.href)
    if (href && href.length <= CAP.href) out.action = { kind: 'outside', href, label: cutBytes(a.label, CAP.label) }
  }
  return out
}

export function capResults(results: readonly SeoTestResult[]): SeoTestResult[] {
  return results.map(capResult)
}

/* ── the crawl: what a run saw (types.ts SeoCrawl) ──────────────────────────────────── */

/** The table's check on `crawl` (20261001120000): `octet_length(crawl::text) <= 65536`. */
export const CRAWL_MAX_BYTES = 65_536

type CrawlBot = SeoCrawl['robots']['bots'][number]
// Record<union, true>: a value added to the union is a compile error here until it is listed.
const VERDICT: Record<CrawlBot['verdict'], true> = { allowed: true, blocked: true, unknown: true }
const WHY: Record<CrawlBot['why'], true> = { rules: true, 'no-file': true, 'server-error': true, 'not-shown': true, 'slow-down': true, 'no-answer': true }

function must(ok: boolean): asserts ok {
  if (!ok) throw new Error('not a crawl')
}
const obj = (v: unknown): Row => (must(!!v && typeof v === 'object' && !Array.isArray(v)), v as Row)
const text = (v: unknown): string => (must(typeof v === 'string'), v as string)
const textOrNull = (v: unknown): string | null => (v === null ? null : text(v))
const flag = (v: unknown): boolean => (must(typeof v === 'boolean'), v as boolean)
/** An HTTP status (a whole number, three digits at most) or null. */
const statusOf = (v: unknown): number | null => (v === null ? null : (must(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 999), v as number))
const countOf = (v: unknown): number => (must(Number.isSafeInteger(v) && (v as number) >= 0), v as number)
const listOf = <T>(v: unknown, each: (x: Row) => T): T[] => (must(Array.isArray(v)), (v as unknown[]).map((x) => each(obj(x))))
const oneOf = <T extends string>(v: unknown, known: Record<T, true>): T => (must(typeof v === 'string' && Object.hasOwn(known, v)), v as T)

/**
 * A crawl in EXACTLY its shape (types.ts SeoCrawl, version 1), rebuilt from its known fields
 * only, or null. Anything else (another version, a missing or mistyped field anywhere, a
 * verdict the page does not know) is null as a whole: the page renders every field as text,
 * and a half-read crawl would say things the run never saw. Nullable fields must be present as
 * null (absent is not "none"). Used on the way in (`capCrawl`) and on the way out (the reader).
 */
export function crawlOf(v: unknown): SeoCrawl | null {
  try {
    const c = obj(v)
    must(c.v === 1)
    const robots = obj(c.robots)
    const sitemap = obj(c.sitemap)
    const listing = obj(c.listing)
    const other = c.otherHost === null ? null : obj(c.otherHost)
    return {
      v: 1,
      robots: {
        url: text(robots.url),
        status: statusOf(robots.status),
        text: textOrNull(robots.text),
        truncated: flag(robots.truncated),
        bots: listOf(robots.bots, (b) => ({
          key: text(b.key),
          who: text(b.who),
          token: text(b.token),
          visits: flag(b.visits),
          verdict: oneOf(b.verdict, VERDICT),
          why: oneOf(b.why, WHY),
          group: textOrNull(b.group),
          rule: textOrNull(b.rule),
        })),
      },
      sitemap: {
        url: textOrNull(sitemap.url),
        status: statusOf(sitemap.status),
        namedInRobots: flag(sitemap.namedInRobots),
        total: countOf(sitemap.total),
        pages: listOf(sitemap.pages, (p) => ({ path: text(p.path), lastmod: textOrNull(p.lastmod), status: statusOf(p.status) })),
        sameDates: flag(sitemap.sameDates),
      },
      pages: listOf(c.pages, (p) => {
        const canonical = obj(p.canonical)
        const noindex = obj(p.noindex)
        return {
          path: text(p.path),
          status: statusOf(p.status),
          canonical: { person: textOrNull(canonical.person), google: textOrNull(canonical.google), bing: textOrNull(canonical.bing) },
          noindex: { meta: flag(noindex.meta), header: flag(noindex.header) },
          visits: Object.fromEntries(Object.entries(obj(p.visits)).map(([key, status]) => [key, statusOf(status)])),
        }
      }),
      otherHost: other && { url: text(other.url), status: statusOf(other.status), to: textOrNull(other.to) },
      listing: {
        google: listing.google === null ? null : listOf(listing.google, (g) => ({ path: text(g.path), answered: g.answered === true, verdict: textOrNull(g.verdict), coverage: textOrNull(g.coverage), lastCrawl: textOrNull(g.lastCrawl) })),
        bing: listing.bing === null ? null : listOf(listing.bing, (b) => ({ path: text(b.path), answered: b.answered === true, lastCrawled: textOrNull(b.lastCrawled), status: statusOf(b.status) })),
      },
    }
  } catch {
    return null
  }
}

/** A NUL or half an emoji (a lone surrogate): Postgres refuses either inside jsonb (22P05 /
 *  22P02), which would sink the whole finish, results and all. Each becomes U+FFFD. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
const storableText = (s: string) => s.replace(LONE_SURROGATE, '�').replaceAll('\u0000', '�')
function storable<T>(v: T): T {
  if (typeof v === 'string') return storableText(v) as T
  if (Array.isArray(v)) return v.map(storable) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [storableText(k), storable(x)])) as T
  return v
}

/**
 * BYTES of `v` as Postgres writes jsonb as text (`crawl::text`, what the table's check counts):
 * `{"k": v, "k2": v}`, `[a, b]`, strings JSON-escaped in UTF-8 (charBytes). Numbers reach here
 * only as whole numbers (crawlOf), which both sides spell the same.
 */
function jsonbBytes(v: unknown): number {
  if (v === null) return 4
  if (typeof v === 'string') return textBytes(v) + 2
  if (typeof v === 'boolean') return v ? 4 : 5
  if (typeof v === 'number') return String(v).length
  const parts = Array.isArray(v) ? v.map(jsonbBytes) : Object.entries(v as Row).map(([k, x]) => textBytes(k) + 4 + jsonbBytes(x))
  return 2 + parts.reduce((n, b) => n + b, 0) + 2 * Math.max(0, parts.length - 1)
}

/** Take items off the END of `list` (inside a crawl of `bytes`) until the crawl fits or the
 *  list is empty. Each item but the first follows a ", ", which goes with it; the first one's
 *  removal ends the loop either way. */
function trimToFit<T>(list: T[], bytes: number): void {
  let n = bytes
  while (n > CRAWL_MAX_BYTES && list.length > 0) n -= jsonbBytes(list.pop()) + 2
}

/**
 * The crawl as it may be stored, or null. Null for anything that is not a whole v:1 crawl
 * (crawlOf). Every string made storable (`storable`). Kept under the table's 64 KB, in
 * bytes as Postgres counts them, by giving up the least useful part first:
 *   1. the robots.txt file's own text (`text: null`, `truncated: true`: read, but not kept);
 *   2. sitemap pages, from the end (`total` still says how many the list named);
 *   3. opened pages, from the end ("/" is first, so it goes last).
 * Every crawler's robots verdict is always kept: if the crawl still does not fit, it is null.
 */
export function capCrawl(v: unknown): SeoCrawl | null {
  const parsed = crawlOf(v)
  if (!parsed) return null
  const crawl = storable(parsed)
  if (jsonbBytes(crawl) > CRAWL_MAX_BYTES && crawl.robots.text !== null) {
    crawl.robots.text = null
    crawl.robots.truncated = true
  }
  trimToFit(crawl.sitemap.pages, jsonbBytes(crawl))
  trimToFit(crawl.pages, jsonbBytes(crawl))
  return jsonbBytes(crawl) <= CRAWL_MAX_BYTES ? crawl : null
}

/* ── readers ────────────────────────────────────────────────────────────────────────── */

/** A finished run as the page reads it: the contract's `SeoTestRun` plus what the run knew
 *  about itself. `siteUrl` is '' when no site was connected. */
export type StoredSeoRun = SeoTestRun & {
  finishedAt: string | null
  /** Derived by the database: the passes. */
  passed: number
  /** Derived by the database: every result but `na` (see `seoScore`). 0 when every test was
   *  `na`, which a run can store (it has results; none of them scored). */
  total: number
  /** true = the live site showed the latest publish; false = it showed an older one; null =
   *  couldn't tell. Anything but true: "your site may not have updated yet". */
  siteFresh: boolean | null
  publishedAt: string | null
  note: string | null
  /** What the run saw (types.ts SeoCrawl); null for a run from before 20261001 or one that
   *  couldn't look. Only the full-run reader fills it. */
  crawl?: SeoCrawl | null
}

/** A finished run without its results: what history dots and the timeline read. */
export type SeoRunSummary = Omit<StoredSeoRun, 'results'> & { statuses: Partial<Record<SeoTestId, SeoTestStatus>> }

const SUMMARY_COLS = 'id, artist_id, ran_at, finished_at, trigger, site_url, passed, total, summary, site_fresh, published_at, note, reach'
/** The full run adds its results and its crawl (the history reads neither). */
const RUN_COLS = `${SUMMARY_COLS}, results, crawl`
/** The same read on a table without the crawl column (before 20261001120000 is pushed). */
const RUN_COLS_NO_CRAWL = `${SUMMARY_COLS}, results`

/** Postgres's "no such column" (42703), as PostgREST passes it through. */
const missingColumn = (e: { code?: string | null; message?: string | null } | null) => !!e && (e.code === '42703' || /column .* does not exist/i.test(e.message ?? ''))

type Row = Record<string, unknown>

const TRIGGERS: readonly SeoRunTrigger[] = ['manual', 'publish', 'scheduled']

function summaryOf(row: Row): SeoRunSummary {
  const raw = row.summary && typeof row.summary === 'object' && !Array.isArray(row.summary) ? (row.summary as Record<string, unknown>) : {}
  const statuses: Partial<Record<SeoTestId, SeoTestStatus>> = {}
  for (const [id, status] of Object.entries(raw)) if (isTestId(id) && isStatus(status)) statuses[id] = status
  const trigger = TRIGGERS.find((t) => t === row.trigger) ?? 'manual'
  return {
    id: String(row.id),
    artistId: String(row.artist_id ?? ''),
    ranAt: String(row.ran_at ?? ''),
    finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
    trigger,
    siteUrl: typeof row.site_url === 'string' ? row.site_url : '',
    passed: Number(row.passed ?? 0),
    total: Number(row.total ?? 0),
    siteFresh: typeof row.site_fresh === 'boolean' ? row.site_fresh : null,
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
    note: typeof row.note === 'string' ? row.note : null,
    reach: reachOf(row.reach),
    statuses,
  }
}

const optText = (v: unknown) => v === undefined || typeof v === 'string'

/** The whole shape the page renders: a string where it expects text, rows of text as evidence. */
function isStoredResult(r: unknown): r is SeoTestResult {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false
  const x = r as Row
  return (
    isTestId(x.id) &&
    isStatus(x.status) &&
    typeof x.value === 'string' &&
    typeof x.sentence === 'string' &&
    Array.isArray(x.evidence) &&
    x.evidence.every((e) => !!e && typeof e === 'object' && typeof (e as Row).label === 'string' && typeof (e as Row).value === 'string') &&
    optText(x.good) &&
    optText(x.todo) &&
    optText(x.limits) &&
    (x.action === undefined || (!!x.action && typeof x.action === 'object'))
  )
}

/** Stored results, kept only when they have the whole shape, and re-capped (an action's href is
 *  re-checked) on the way out: a malformed entry is dropped, never shown. */
function resultsOf(raw: unknown): SeoTestResult[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isStoredResult).map(capResult)
}

function runOf(row: Row): StoredSeoRun {
  const { statuses: _statuses, ...rest } = summaryOf(row)
  void _statuses
  return { ...rest, results: resultsOf(row.results), crawl: crawlOf(row.crawl) }
}

/** The newest FINISHED run, or null when the artist has never been tested. Throws when the
 *  read fails: "never tested" and "couldn't read" must not look the same. */
export async function latestRun(supabase: SupabaseClient, artistId: string): Promise<StoredSeoRun | null> {
  const read = (cols: string) =>
    supabase.from('seo_test_runs').select(cols).eq('artist_id', artistId).eq('status', 'done').order('ran_at', { ascending: false }).limit(1).maybeSingle()
  let { data, error } = await read(RUN_COLS)
  // The crawl column arrives with a migration; until it is live, the page reads the run without it
  // rather than saying "couldn't read" (the code can run before the database has the column).
  if (missingColumn(error)) ({ data, error } = await read(RUN_COLS_NO_CRAWL))
  if (error) throw new Error(`seo_test_runs: ${error.message}`)
  return data ? runOf(data as unknown as Row) : null
}

/** The newest finished runs, newest first, without their results. Throws when the read fails. */
export async function recentRuns(supabase: SupabaseClient, artistId: string, limit = 10): Promise<SeoRunSummary[]> {
  const { data, error } = await supabase
    .from('seo_test_runs')
    .select(SUMMARY_COLS)
    .eq('artist_id', artistId)
    .eq('status', 'done')
    .order('ran_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`seo_test_runs: ${error.message}`)
  return ((data ?? []) as Row[]).map(summaryOf)
}

/**
 * Each test's last `limit` results, OLDEST first (the dots read left to right). Every test id
 * is present; a test a run did not record (it did not exist yet) is simply absent from that
 * run's dots, never shown as a fail.
 */
export async function historyFor(supabase: SupabaseClient, artistId: string, limit = 8): Promise<Record<SeoTestId, SeoTestHistory>> {
  const runs = (await recentRuns(supabase, artistId, limit)).slice().reverse()
  const out = Object.fromEntries(SEO_TEST_IDS.map((id) => [id, [] as SeoTestHistory])) as Record<SeoTestId, SeoTestHistory>
  for (const run of runs) {
    for (const id of SEO_TEST_IDS) {
      const status = run.statuses[id]
      if (status) out[id].push({ ranAt: run.ranAt, status })
    }
  }
  return out
}

/** The run in progress, if any (a publish's run waits for the site in the background). A
 *  running row older than 5 minutes is abandoned and not reported. Null when unreadable. */
export async function currentRun(supabase: SupabaseClient, artistId: string, nowMs: number = Date.now()): Promise<{ ranAt: string; trigger: SeoRunTrigger } | null> {
  try {
    const { data, error } = await supabase
      .from('seo_test_runs')
      .select('ran_at, trigger')
      .eq('artist_id', artistId)
      .eq('status', 'running')
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const row = data as Row
    const at = Date.parse(String(row.ran_at ?? ''))
    if (!Number.isFinite(at) || nowMs - at > 5 * 60_000) return null
    return { ranAt: String(row.ran_at), trigger: TRIGGERS.find((t) => t === row.trigger) ?? 'manual' }
  } catch {
    return null
  }
}

/* ── the Test tab's read, with "not switched on" as its own state ──────────────────── */

/** PostgREST's "no such table" (PGRST205) and Postgres's own (42P01): the seo_test_runs
 *  migration is not pushed yet. Anything else is a real read failure. */
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /could not find the table|relation .* does not exist/i.test(error.message ?? '')
}

/**
 * What the Test tab shows: `off` (testing isn't switched on: the table is not there yet),
 * `error` (couldn't read), or `ready` (`latest: null` there means never tested). Never throws.
 * RLS-scoped; the caller has already checked the manager owns the artist.
 */
export type SeoTestTab =
  | { state: 'off' }
  | { state: 'error' }
  | { state: 'ready'; latest: StoredSeoRun | null; history: Record<SeoTestId, SeoTestHistory>; running: { ranAt: string; trigger: SeoRunTrigger } | null }

export async function readTestTab(supabase: SupabaseClient, artistId: string): Promise<SeoTestTab> {
  try {
    // One tiny read tells "not switched on" from "couldn't read". Not a HEAD request: a HEAD
    // answer has no body, so it would carry no error code to tell by.
    const probe = await supabase.from('seo_test_runs').select('id').eq('artist_id', artistId).limit(1)
    if (probe.error) return isMissingTable(probe.error) ? { state: 'off' } : { state: 'error' }
    const [latest, history, running] = await Promise.all([latestRun(supabase, artistId), historyFor(supabase, artistId), currentRun(supabase, artistId)])
    return { state: 'ready', latest, history, running }
  } catch (e) {
    // latestRun / historyFor throw "seo_test_runs: <message>": a table dropped between the probe
    // and the read is still "off"; anything else is a failed read.
    return isMissingTable({ message: e instanceof Error ? e.message : String(e) }) ? { state: 'off' } : { state: 'error' }
  }
}
