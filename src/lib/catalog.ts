/**
 * Per-artist catalog source (Phase 2). An artist imports tracks from exactly one
 * source. The selector is config (instant), but its tracks are content
 * (draft → publish). Switching source replaces that source's imported set:
 * delete the working tracks for the OLD importer source — manual tracks are
 * always preserved (the don't-clobber rule) — then the next publish tombstones
 * the old source's live revisions so nothing stale lingers on the public site.
 *
 * The switch runs in the `switch_catalog_source` SECURITY INVOKER function so the
 * delete + source update are ATOMIC and RLS-scoped to the caller's tenant.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const CATALOG_SOURCES = ['manual', 'spotify', 'apple', 'deezer'] as const
export type CatalogSource = (typeof CATALOG_SOURCES)[number]

export async function setCatalogSource(
  supabase: SupabaseClient,
  artistId: string,
  next: CatalogSource,
): Promise<void> {
  if (!CATALOG_SOURCES.includes(next)) throw new Error(`invalid catalog source: ${next}`)
  const { error } = await supabase.rpc('switch_catalog_source', {
    p_artist_id: artistId,
    p_next: next,
  })
  if (error) throw new Error(error.message)
}
