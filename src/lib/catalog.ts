/**
 * Per-artist catalog source (Phase 2). An artist imports tracks from exactly one
 * source. The selector is config (instant), but its tracks are content
 * (draft → publish). Switching source replaces that source's imported set:
 * delete the working tracks for the OLD importer source — manual tracks are
 * always preserved (the don't-clobber rule) — then the next publish tombstones
 * the old source's live revisions so nothing stale lingers on the public site.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const CATALOG_SOURCES = ['manual', 'spotify', 'apple', 'deezer'] as const
export type CatalogSource = (typeof CATALOG_SOURCES)[number]

/** The importer sources whose imported tracks are replaced on a switch. */
const IMPORTER_SOURCES = new Set<CatalogSource>(['spotify', 'apple', 'deezer'])

export async function setCatalogSource(
  supabase: SupabaseClient,
  artistId: string,
  next: CatalogSource,
): Promise<void> {
  const { data: artist, error } = await supabase
    .from('artists')
    .select('catalog_source')
    .eq('id', artistId)
    .single()
  if (error || !artist) throw new Error(error?.message ?? 'artist not found')

  const current = artist.catalog_source as CatalogSource
  if (current === next) return

  // Drop the previous importer's tracks (manual is never touched). RLS scopes
  // the delete to the caller's tenant.
  if (IMPORTER_SOURCES.has(current)) {
    const { error: delErr } = await supabase
      .from('tracks')
      .delete()
      .eq('artist_id', artistId)
      .eq('source', current)
    if (delErr) throw new Error(delErr.message)
  }

  const { error: upErr } = await supabase
    .from('artists')
    .update({ catalog_source: next })
    .eq('id', artistId)
  if (upErr) throw new Error(upErr.message)
}
