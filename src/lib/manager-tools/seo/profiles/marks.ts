/**
 * Profile marks: which outside-profile jobs a manager has done for an artist (the SEO tool's
 * Profiles tab: "Mark as sent", and each outside bio's "updated" tick). One row in
 * `public.profile_marks` = done; no row = not done.
 *
 * PRIVATE to the artist's managers (supabase/migrations/20261001150000_profile_marks.sql,
 * 20261001160000_profile_marks_bios.sql): never published, never in get_public_site. Every
 * call here runs on the caller's own session, so RLS decides whose marks it can see or change.
 *
 * The database stamps `done_at` and `done_by` itself. A manager's role may only INSERT
 * `artist_id` and `item`, and only UPDATE `done_at`, which a trigger then overwrites with
 * now() and the caller (column grants + profile_marks_stamp). So nothing here can pick a date
 * or a name: a payload that tried would be refused (42501) or restamped.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingTable } from '@/lib/seo-tests/store'
import { BIO_ITEMS } from './bios'

/**
 * Every item a mark can be for: the AllMusic bio email, then one "updated" tick per outside bio
 * (bios.ts). The table's CHECK (profile_marks_item_check, newest migration) lists exactly these;
 * a unit test reads the migrations and fails if they drift. Widen both together.
 */
export const PROFILE_ITEMS = ['allmusic_bio', ...BIO_ITEMS] as const
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
 * The value sent as done_at on a re-confirm. Postgres reads the string 'now' as the current
 * time, so it means "now" even on its own, but it is never what decides the date: the table's
 * BEFORE UPDATE trigger (profile_marks_stamp) overwrites done_at and done_by on every update.
 */
const NOW = 'now'

/**
 * Mark an item done, or undo it.
 *
 * Done: first RE-CONFIRM, an update of this artist's row for this item, which the trigger
 * stamps with now() and the caller, so ticking "updated" again moves the date. If no row
 * matched, it is a first mark: insert artist_id + item with ON CONFLICT DO NOTHING (a double
 * click racing it is not an error). Undo: delete the row.
 *
 * Any failed re-confirm is a failure (20261001160000 is live, so a 42501 means the UPDATE grant
 * went missing: inserting then would report "done" for a stamp that did not move).
 *
 * A denied UPDATE or DELETE is row-filtered (no error, zero rows), so callers must check
 * ownership first; the server action does. (A denied update then tries the insert, which RLS
 * refuses with an error.)
 */
export async function setProfileMark(
  supabase: SupabaseClient,
  artistId: string,
  item: ProfileItem,
  done: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!isProfileItem(item)) return { ok: false, error: 'Unknown item.' }
  const fail = (error: { code?: string; message?: string }) =>
    isMissingTable(error)
      ? { ok: false, error: 'Marking is not switched on yet.' }
      : { ok: false, error: done ? 'Could not save the mark.' : 'Could not clear the mark.' }

  if (!done) {
    const { error } = await supabase.from('profile_marks').delete().eq('artist_id', artistId).eq('item', item)
    return error ? fail(error) : { ok: true }
  }

  const re = await supabase
    .from('profile_marks')
    .update({ done_at: NOW })
    .eq('artist_id', artistId)
    .eq('item', item)
    .select('item')
  if (re.error) return fail(re.error)
  if ((re.data?.length ?? 0) > 0) return { ok: true }

  const { error } = await supabase
    .from('profile_marks')
    .upsert({ artist_id: artistId, item }, { onConflict: 'artist_id,item', ignoreDuplicates: true })
  return error ? fail(error) : { ok: true }
}
