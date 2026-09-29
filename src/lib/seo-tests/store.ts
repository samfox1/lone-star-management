/**
 * The SEO / GEO test runs, kept (supabase/migrations/20260929140000_seo_test_runs.sql).
 *
 * The page reads these; it never decides a result itself (types.ts). The DATABASE owns the
 * lifecycle: a claim (INSERT) is refused while a run is running ("busy") and, for a manual run,
 * within 60 s of the last one ("cooldown"); a finish (UPDATE of the running row) is the only
 * write that carries results, and the database derives `passed`, `total` and `summary` from
 * them. So nothing here counts anything the page shows.
 *
 * Every string written is capped here first (`capResult`), so the table's 256 KB size check is
 * a backstop that should never fire.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEO_TEST_IDS, SEO_TEST_STATUSES, isScored, type SeoRunTrigger, type SeoTestHistory, type SeoTestId, type SeoTestResult, type SeoTestRun, type SeoTestStatus } from './types'

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

/* ── claim / finish ─────────────────────────────────────────────────────────────────── */

export type SeoClaim =
  | { ok: true; runId: string; ranAt: string }
  | { ok: false; reason: 'busy' | 'cooldown' | 'denied' | 'error'; retryInS: number | null; error: string }

/**
 * Start a run: one INSERT, which the database accepts or refuses. Never throws.
 * `busy`: a run is already going for this artist. `cooldown`: a manual run inside 60 s of the
 * last run (`retryInS` says how long). `denied`: not this artist's manager.
 */
export async function claimRun(supabase: SupabaseClient, artistId: string, trigger: SeoRunTrigger): Promise<SeoClaim> {
  try {
    const { data, error } = await supabase
      .from('seo_test_runs')
      .insert({ artist_id: artistId, trigger })
      .select('id, ran_at')
      .single()
    if (error) {
      const message = error.message ?? ''
      if (message.includes('seo_test_cooldown')) {
        const m = /(\d+)\s*s\b/.exec(message.slice(message.indexOf('seo_test_cooldown')))
        const retryInS = m ? Number(m[1]) : null
        return { ok: false, reason: 'cooldown', retryInS, error: `Tested a moment ago. Try again in ${retryInS ?? SEO_MANUAL_COOLDOWN_S} seconds.` }
      }
      // 23505: the one-running-per-artist index, if a writer ever got past the trigger.
      if (message.includes('seo_test_busy') || error.code === '23505') {
        return { ok: false, reason: 'busy', retryInS: null, error: 'A test is already running. It will show here when it finishes.' }
      }
      if (error.code === '42501') return { ok: false, reason: 'denied', retryInS: null, error: 'Artist not found.' }
      return { ok: false, reason: 'error', retryInS: null, error: 'Couldn’t start the test.' }
    }
    const row = data as { id?: unknown; ran_at?: unknown } | null
    if (!row || typeof row.id !== 'string') return { ok: false, reason: 'error', retryInS: null, error: 'Couldn’t start the test.' }
    return { ok: true, runId: row.id, ranAt: String(row.ran_at ?? '') }
  } catch {
    return { ok: false, reason: 'error', retryInS: null, error: 'Couldn’t start the test.' }
  }
}

export type FinishInput = {
  results: SeoTestResult[]
  siteUrl: string | null
  siteFresh: boolean | null
  publishedAt: string | null
  note?: string | null
}

/**
 * Finish a running run with its results. The row must still be RUNNING (a run marked failed as
 * abandoned, or pruned, is not resurrected), and the write is checked by the row it returns —
 * a row-filtered UPDATE answers "no error" with nothing changed (AGENTS.md rule 3).
 */
export async function finishRun(supabase: SupabaseClient, runId: string, input: FinishInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase
      .from('seo_test_runs')
      .update({
        status: 'done',
        results: capResults(input.results),
        site_url: input.siteUrl,
        site_fresh: input.siteFresh,
        published_at: input.publishedAt,
        note: capNote(input.note),
      })
      .eq('id', runId)
      .eq('status', 'running')
      .select('id')
      .maybeSingle()
    if (error || !data) return { ok: false, error: 'The test finished but its results weren’t saved.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'The test finished but its results weren’t saved.' }
  }
}

/** Mark a running run failed, with one plain sentence. Best effort: never throws. A run left
 *  running is marked failed by the next claim after 5 minutes anyway. */
export async function failRun(supabase: SupabaseClient, runId: string, note: string): Promise<void> {
  try {
    await supabase.from('seo_test_runs').update({ status: 'failed', note: capNote(note) }).eq('id', runId).eq('status', 'running')
  } catch {
    // swallowed on purpose: see above
  }
}

/* ── caps ───────────────────────────────────────────────────────────────────────────── */

const cut = (s: unknown, max: number): string => {
  const text = typeof s === 'string' ? s : s == null ? '' : String(s)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
const cutOpt = (s: unknown, max: number): string | undefined => (typeof s === 'string' && s !== '' ? cut(s, max) : undefined)

const capNote = (note: string | null | undefined): string | null => {
  if (!note) return null
  return cut(note.replace(/[\r\n]+/g, ' ').trim(), 300) || null
}

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
 * One result as it may be stored: every string capped, evidence at most 12 rows of plain
 * text, an `outside` action kept only with a https href. The verdict itself (`id`, `status`)
 * is never changed here; the run validates it before this.
 */
export function capResult(r: SeoTestResult): SeoTestResult {
  const out: SeoTestResult = {
    id: r.id,
    status: r.status,
    value: cut(r.value, 60),
    sentence: cut(r.sentence, 500),
    evidence: (Array.isArray(r.evidence) ? r.evidence : []).slice(0, MAX_EVIDENCE).map((e) => ({
      label: cut(e?.label, 80),
      value: cut(e?.value, 500),
    })),
  }
  if (r.lead === 'Almost') out.lead = 'Almost'
  const good = cutOpt(r.good, 300)
  if (good) out.good = good
  const todo = cutOpt(r.todo, 300)
  if (todo) out.todo = todo
  const limits = cutOpt(r.limits, 300)
  if (limits) out.limits = limits
  const a = r.action
  if (a?.kind === 'edit') out.action = { kind: 'edit', target: a.target, label: cut(a.label, 60) }
  else if (a?.kind === 'fix') out.action = { kind: 'fix', fix: a.fix, label: cut(a.label, 60) }
  else if (a?.kind === 'outside') {
    const href = httpsOnly(a.href)
    if (href && href.length <= 2048) out.action = { kind: 'outside', href, label: cut(a.label, 60) }
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

const SUMMARY_COLS = 'id, artist_id, ran_at, finished_at, trigger, site_url, passed, total, summary, site_fresh, published_at, note'
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
    statuses,
  }
}

/** Stored results, kept only when they are results: a malformed entry is dropped, never shown. */
function resultsOf(raw: unknown): SeoTestResult[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is SeoTestResult => !!r && typeof r === 'object' && isTestId((r as Row).id) && isStatus((r as Row).status))
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
