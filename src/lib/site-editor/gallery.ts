import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Gallery ordering for the visual editor (SITE_EDITOR_PLAN.md phase 2). `reorderList`
 * is the pure move used for the optimistic in-panel update; `reorderGallery` persists
 * the new order by writing each `media` row's `sort_order` to its index. Both the
 * server action and tests inject the Supabase client so the write path is testable
 * (RLS scopes every update to the caller's tenant).
 */

/** A gallery photo's orientation slot. Horizontal photos display 3:2, vertical 2:3. */
export type Orientation = 'horizontal' | 'vertical'

/** Classify an image by its pixel dimensions: a square counts as horizontal (its 1:1
 *  fits a landscape slot without portrait letterboxing). Used to WARN when a photo
 *  dropped into a slot doesn't match that slot's orientation. Returns null for
 *  degenerate sizes (0), where there's nothing to judge. */
export function orientationOf(width: number, height: number): Orientation | null {
  if (!(width > 0) || !(height > 0)) return null
  return width >= height ? 'horizontal' : 'vertical'
}

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
 *  `orderedIds`, ATOMICALLY (one `reorder_rows` RPC = one statement/transaction, so a
 *  partial failure can't half-renumber the table). RLS-scoped (SECURITY INVOKER). */
export async function reorderGallery(
  supabase: SupabaseClient,
  artistId: string,
  orderedIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('reorder_rows', {
    p_table: 'media',
    p_artist: artistId,
    p_ids: orderedIds,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
