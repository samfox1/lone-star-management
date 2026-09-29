import type { SupabaseClient } from '@supabase/supabase-js'
import { currentRun, historyFor, latestRun, type StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoRunTrigger, SeoTestHistory, SeoTestId } from '@/lib/seo-tests/types'

/**
 * What the Test tab reads, with the one distinction test-actions.ts `readSeoTestsAction` cannot
 * make: "testing isn't switched on yet" (the seo_test_runs migration is not pushed, so the table
 * is not there) versus "couldn't read" versus "never tested". That action answers the first two
 * with the same sentence, and a manager must not see "couldn't read the results" on a feature
 * that simply isn't on yet. A THIN LOCAL WRAPPER over the same store readers; the report asks
 * for this state in the action so this file can go.
 *
 * Only called after `requireArtist` (the ownership gate) on the page; every read is RLS-scoped.
 */
export type TestTabData =
  | { state: 'off' }
  | { state: 'error' }
  | {
      state: 'ready'
      latest: StoredSeoRun | null
      history: Record<SeoTestId, SeoTestHistory>
      running: { ranAt: string; trigger: SeoRunTrigger } | null
      /** The newest attempt FAILED (after the latest finished run): said after a reload too
       *  (review N11: store.ts reads only finished runs, so a failure left no trace). */
      lastFailed?: { ranAt: string; note: string | null } | null
    }

/** PostgREST's "no such table" (PGRST205, and PGRST202's cousin for relations) and
 *  Postgres's own (42P01). Anything else is a real read failure. */
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /could not find the table|relation .* does not exist/i.test(error.message ?? '')
}

export async function loadTestTab(supabase: SupabaseClient, artistId: string): Promise<TestTabData> {
  try {
    // The probe: one tiny read. It is what tells "not switched on" from "couldn't read". Not a
    // HEAD request: a HEAD answer has no body, so it would carry no error code to tell by.
    const probe = await supabase.from('seo_test_runs').select('id').eq('artist_id', artistId).limit(1)
    if (probe.error) return isMissingTable(probe.error) ? { state: 'off' } : { state: 'error' }
    const [latest, history, running, lastFailed] = await Promise.all([
      latestRun(supabase, artistId),
      historyFor(supabase, artistId),
      currentRun(supabase, artistId),
      newestFailure(supabase, artistId),
    ])
    return { state: 'ready', latest, history, running, lastFailed }
  } catch (e) {
    // latestRun / historyFor throw "seo_test_runs: <message>"; a table dropped between the
    // probe and the read is still "not on", anything else is a failed read.
    return isMissingTable({ message: e instanceof Error ? e.message : String(e) }) ? { state: 'off' } : { state: 'error' }
  }
}

/** The newest ENDED attempt, if it failed. A local reader until the store has one (the report
 *  asks); a read that fails says nothing rather than something false. */
async function newestFailure(supabase: SupabaseClient, artistId: string): Promise<{ ranAt: string; note: string | null } | null> {
  const { data, error } = await supabase
    .from('seo_test_runs')
    .select('ran_at, status, note')
    .eq('artist_id', artistId)
    .in('status', ['done', 'failed'])
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { ran_at?: unknown; status?: unknown; note?: unknown }
  if (row.status !== 'failed' || typeof row.ran_at !== 'string') return null
  return { ranAt: row.ran_at, note: typeof row.note === 'string' ? row.note : null }
}
