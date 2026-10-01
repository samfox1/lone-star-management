/**
 * Profile marks: which outside-profile jobs a manager has done for an artist (the SEO tool's
 * Profiles tab, "Mark as sent"). One row in `public.profile_marks` = done; no row = not done.
 *
 * PRIVATE to the artist's managers (supabase/migrations/20261001150000_profile_marks.sql):
 * never published, never in get_public_site. Every call here runs on the caller's own
 * session, so RLS decides whose marks it can see or change.
 *
 * The database stamps `done_at` and `done_by` itself. A manager's role may only INSERT
 * `artist_id` and `item` (column grant), so nothing here sends either stamp: a payload that
 * did would be refused with 42501.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingTable } from '@/lib/seo-tests/store'

/** Mirrors the table's CHECK (profile_marks_item_check). Widen both together. */
export const PROFILE_ITEMS = ['allmusic_bio'] as const
export type ProfileItem = (typeof PROFILE_ITEMS)[number]

/** When each done item was marked (ISO timestamp), by item. A missing key = not done. */
export type ProfileMarks = Partial<Record<ProfileItem, string>>

export function isProfileItem(x: unknown): x is ProfileItem {
  return (PROFILE_ITEMS as readonly unknown[]).includes(x)
}

/**
 * The artist's marks. `{}` while the migration is not pushed (the table is missing: PostgREST
 * PGRST205, or Postgres 42P01), so the Profiles tab works before the push and just shows
 * nothing marked. Any other failure THROWS: "couldn't read" must not look like "not sent".
 */
export async function readProfileMarks(supabase: SupabaseClient, artistId: string): Promise<ProfileMarks> {
  const { data, error } = await supabase.from('profile_marks').select('item, done_at').eq('artist_id', artistId)
  if (error) {
    if (isMissingTable(error)) return {}
    throw new Error(`profile_marks: ${error.message}`)
  }
  const marks: ProfileMarks = {}
  // done_at is NOT NULL with a default, so every row carries one.
  for (const row of (data ?? []) as { item: unknown; done_at: string }[]) {
    if (isProfileItem(row.item)) marks[row.item] = row.done_at
  }
  return marks
}

/**
 * Mark an item done, or undo it.
 *
 * Done: insert with ON CONFLICT DO NOTHING, so marking twice keeps the FIRST stamp and needs
 * no UPDATE grant (managers have none). Undo: delete the row.
 *
 * A denied DELETE is row-filtered (no error, zero rows), so callers must check ownership
 * first; the server action does.
 */
export async function setProfileMark(
  supabase: SupabaseClient,
  artistId: string,
  item: ProfileItem,
  done: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!isProfileItem(item)) return { ok: false, error: 'Unknown item.' }
  const { error } = done
    ? await supabase
        .from('profile_marks')
        .upsert({ artist_id: artistId, item }, { onConflict: 'artist_id,item', ignoreDuplicates: true })
    : await supabase.from('profile_marks').delete().eq('artist_id', artistId).eq('item', item)
  if (!error) return { ok: true }
  if (isMissingTable(error)) return { ok: false, error: 'Marking is not switched on yet.' }
  return { ok: false, error: done ? 'Could not save the mark.' : 'Could not clear the mark.' }
}
