/**
 * Saving a kind's NAME and DESCRIPTION (Settings › Email; 20261002220000).
 *
 * Takes the caller's client rather than making one, so the server action and the integration
 * test run the SAME write: tests/integration/enquiries/enquiry-kind-description.test.ts calls it
 * signed in as another artist's manager and reads the row back through the service client.
 *
 * WHO MAY is the database's call: `enquiry_kinds_write` scopes the UPDATE to the artist's
 * managers. A refused update is row-filtered (no error, zero rows; AGENTS.md rule 3), so the
 * `.select('id')` is what tells a refused or stale save apart from a real one. The action adds
 * `requireOwnedArtist` in front, belt to these braces.
 *
 * Not in kinds.ts: that module is pure and mutation-tested; this one talks to the database.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { kindDetailsUpdate, type KindDetails } from './kinds'

/** What a save, rename or delete of a kind says when it matched no row. */
export const KIND_GONE = 'That kind is no longer there — refresh the page.'

/**
 * The column is not there yet: 42703 from Postgres (a read naming it), PGRST204 from PostgREST
 * (a write naming it). True only before 20261002220000 is pushed. DELETE at push time.
 */
export function missingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

/**
 * Write the fields the manager changed, after `kindDetailsUpdate` has checked them. Returns what
 * was stored (trimmed, an empty description as null), for the row to show.
 *
 * Only `id` is selected back: selecting `description` would fail before the push even for a
 * name-only save, which works today and must keep working.
 */
export async function saveEnquiryKind(
  supabase: SupabaseClient,
  artistId: string,
  kindId: string,
  input: KindDetails,
): Promise<{ error?: string; saved?: { label?: string; description?: string | null } }> {
  const checked = kindDetailsUpdate(input)
  if (!checked.ok) return { error: checked.error }

  const { data, error } = await supabase
    .from('enquiry_kinds')
    .update(checked.update)
    .eq('id', kindId)
    .eq('artist_id', artistId)
    .select('id')
  if (error) {
    // Before the push a description cannot be stored anywhere; a name still can.
    if (missingColumn(error)) return { error: 'Descriptions can’t be saved yet.' }
    return { error: error.message }
  }
  if (!data?.length) return { error: KIND_GONE }
  return { saved: checked.update }
}
