import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Gallery ordering for the visual editor (SITE_EDITOR_PLAN.md phase 2). `reorderList`
 * is the pure move used for the optimistic in-panel update; `reorderGallery` persists
 * the new order by writing each `media` row's `sort_order` to its index. Both the
 * server action and tests inject the Supabase client so the write path is testable
 * (RLS scopes every update to the caller's tenant).
 */

/** Move the item at `from` to `to`, returning a new array (a copy, unchanged on a
 *  no-op or out-of-range index). */
export function reorderList<T>(list: T[], from: number, to: number): T[] {
  const n = list.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return list.slice()
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Persist gallery order: set each media row's `sort_order` to its index in
 *  `orderedIds`. RLS-scoped; the `artist_id` filter is a belt-and-suspenders guard. */
export async function reorderGallery(
  supabase: SupabaseClient,
  artistId: string,
  orderedIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('media')
      .update({ sort_order: i })
      .eq('id', orderedIds[i])
      .eq('artist_id', artistId)
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true }
}
