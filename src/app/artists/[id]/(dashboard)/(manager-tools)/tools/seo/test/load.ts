import type { SupabaseClient } from '@supabase/supabase-js'
import { readTestTab, type SeoTestTab } from '@/lib/seo-tests/store'

/**
 * What the Test tab reads: `store.readTestTab` ("not switched on" vs "couldn't read" vs "never
 * tested"), plus whether the newest attempt FAILED. That last read is local until the store has
 * one (the report asks); then this file can go.
 *
 * Only called after `requireArtist` (the ownership gate) on the page; every read is RLS-scoped.
 */
export type TestTabData =
  | Exclude<SeoTestTab, { state: 'ready' }>
  | (Extract<SeoTestTab, { state: 'ready' }> & {
      /** The newest attempt FAILED (after the latest finished run): said after a reload too
       *  (review N11: store.ts reads only finished runs, so a failure left no trace). */
      lastFailed?: { ranAt: string; note: string | null } | null
    })

export async function loadTestTab(supabase: SupabaseClient, artistId: string): Promise<TestTabData> {
  const [tab, lastFailed] = await Promise.all([readTestTab(supabase, artistId), newestFailure(supabase, artistId).catch(() => null)])
  return tab.state === 'ready' ? { ...tab, lastFailed } : tab
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
