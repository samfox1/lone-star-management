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
import { SEO_TEST_IDS, SEO_TEST_STATUSES, isScored, type SeoRunReach, type SeoRunTrigger, type SeoTestHistory, type SeoTestId, type SeoTestResult, type SeoTestRun, type SeoTestStatus } from './types'

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
 * Finish a running run with its results: one call to `seo_test_finish` (service role). `true`
 * back means a RUNNING run was finished; `false` (abandoned, pruned, already finished) is not
 * reported as saved.
 */
export async function finishRun(writer: SupabaseClient, runId: string, input: FinishInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const fail = { ok: false as const, error: 'The test finished but its results weren’t saved.' }
  try {
    const { data, error } = await writer.rpc('seo_test_finish', {
      p_run_id: runId,
      p_status: 'done',
      p_results: capResults(input.results),
      p_site_url: input.siteUrl,
      p_site_fresh: input.siteFresh,
      p_published_at: input.publishedAt,
      p_note: capNote(input.note),
      p_reach: reachOf(input.reach),
    })
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
    const c = cp >= 0xd800 && cp <= 0xdfff ? '\uFFFD' : ch
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
}

/** A finished run without its results: what history dots and the timeline read. */
export type SeoRunSummary = Omit<StoredSeoRun, 'results'> & { statuses: Partial<Record<SeoTestId, SeoTestStatus>> }

const SUMMARY_COLS = 'id, artist_id, ran_at, finished_at, trigger, site_url, passed, total, summary, site_fresh, published_at, note, reach'
const RUN_COLS = `${SUMMARY_COLS}, results`

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
  return { ...rest, results: resultsOf(row.results) }
}

/** The newest FINISHED run, or null when the artist has never been tested. Throws when the
 *  read fails: "never tested" and "couldn't read" must not look the same. */
export async function latestRun(supabase: SupabaseClient, artistId: string): Promise<StoredSeoRun | null> {
  const { data, error } = await supabase
    .from('seo_test_runs')
    .select(RUN_COLS)
    .eq('artist_id', artistId)
    .eq('status', 'done')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`seo_test_runs: ${error.message}`)
  return data ? runOf(data as Row) : null
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
