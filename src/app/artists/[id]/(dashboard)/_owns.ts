import type { createClient } from '@/lib/supabase/server'

/**
 * Can the caller see this artist at all?
 *
 * RLS already BLOCKS a non-owner's write — but a row-filtered UPDATE or DELETE matches
 * zero rows and returns no error, so without this an action answers `{}` and an
 * authorization failure is indistinguishable from success. That is the "defaults to
 * allow" shape: it hides nothing today, and it would hide an RLS regression completely.
 *
 * The read is RLS-scoped too, so a non-owner sees no row and gets a real failure.
 *
 * NOT in `_data.ts` next to `requireArtist`, deliberately: the action tests stub
 * `next/cache` down to `revalidatePath`, and `_data.ts` calls `unstable_cache` at module
 * scope — importing it from an actions file would crash every one of those tests.
 */
export async function callerOwns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  artistId: string,
): Promise<boolean> {
  const { data } = await supabase.from('artists').select('id').eq('id', artistId).maybeSingle()
  return !!data
}

export type OwnedArtist<T extends Record<string, unknown> = { id: string }> =
  | { ok: true; artist: T }
  | { ok: false; error: string }

/**
 * Auth + ownership in ONE call, for every server action that writes to one artist's
 * rows (Sam, 2026-09-18: add the explicit check everywhere, don't lean on RLS alone).
 * Six actions used to hand-roll `auth.getUser()` → `if (!user) …` → refetch the artist
 * → `if (!artist) …`, and four more skipped the check entirely — this replaces all of
 * them with one call whose result is a discriminated union, so a caller can't reach
 * `.artist` without first narrowing on `.ok` (TypeScript refuses it), which means the
 * failure case can't be silently ignored the way an unchecked RLS no-op is.
 *
 * `columns` lets a caller fetch the same row it needs anyway (template / site_kind /
 * …) in this one request instead of a second read after the check passes.
 */
export async function requireOwnedArtist<T extends Record<string, unknown> = { id: string }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  artistId: string,
  columns = 'id',
): Promise<OwnedArtist<T>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase.from('artists').select(columns).eq('id', artistId).single()
  if (!artist) return { ok: false, error: 'Artist not found.' }
  // `.select(columns)` with a runtime string widens supabase-js's row type to
  // GenericStringError, which overlaps nothing — the double cast is the only way through.
  return { ok: true, artist: artist as unknown as T }
}
