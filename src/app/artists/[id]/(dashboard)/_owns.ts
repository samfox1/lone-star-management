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
