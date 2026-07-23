import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A SLOT is a named single-occupancy position on the site: a hero video background, a
 * polaroid photo/handwriting. An item is bound to it by `site_role`, guarded by a partial
 * unique index on `(artist_id, site_role)` so a role can hold at most one item.
 *
 * `placeInSlot` is the ONE operation that fills a slot, used by every slot-placement
 * action (hero video, polaroid photo). It VACATES whoever holds the role first, then
 * fills it — so the unique index can never see two claimants mid-write — and carries
 * `on_site` with the role: a placed item is on the site, a vacated one is off. Passing a
 * null item just vacates.
 *
 * `SlotTable` is deliberately a closed union of LIVE-TOGGLE tables (ADR 0009). on_site here
 * is a LIVE-toggle write; a slot must never target a publish-reconcile table (`releases`,
 * `merch`), or a placement would be silently reverted at the next publish. The type makes
 * that a compile error, and `tests/on-site-paths.test.ts` asserts it against the registry.
 */
export type SlotTable = 'media' | 'videos'

export async function placeInSlot(
  supabase: SupabaseClient,
  table: SlotTable,
  artistId: string,
  role: string,
  itemId: string | null,
): Promise<{ error?: string }> {
  // Vacate: whoever holds this role leaves it and the site.
  const cleared = await supabase
    .from(table)
    .update({ site_role: null, on_site: false })
    .eq('artist_id', artistId)
    .eq('site_role', role)
  if (cleared.error) return { error: cleared.error.message }

  if (itemId) {
    const { error } = await supabase
      .from(table)
      .update({ site_role: role, on_site: true })
      .eq('id', itemId)
      .eq('artist_id', artistId)
    if (error) return { error: error.message }
  }
  return {}
}
