import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Storage garbage collection: remove uploaded objects nothing points at anymore.
 *
 * Videos use the publish/revision model, so GC binds to PUBLISH, never delete: the
 * LEFT-JOIN visibility gate keeps serving a deleted-but-still-published video, which
 * works only because its object survives until its revision is tombstoned. After
 * `publishContent` runs, the working `videos` rows ARE the complete set of still-needed
 * objects — publish has just tombstoned every deletion and re-snapshotted current
 * working state — so anything in the bucket not referenced by a working row is a true
 * orphan (a deleted video, or a replaced-file's old object). Media is a live table
 * (no revisions), so its objects are GC'd at delete instead.
 */

/** Bucket paths present but no longer referenced → safe to remove. */
export function orphanedPaths(listed: string[], referenced: Iterable<string>): string[] {
  const keep = new Set(referenced)
  return listed.filter((p) => !keep.has(p))
}

/**
 * Remove an uploaded video's object at DELETE time — but ONLY if the video was never
 * published (no revision references it). A published video's object must survive until
 * its tombstone is published (the LEFT-JOIN gate keeps serving it), so those are left to
 * gcVideoObjects at the next publish. This makes the common case — upload a draft, then
 * delete it — clean up storage immediately. Best-effort.
 */
export async function gcDeletedVideoObject(
  client: SupabaseClient,
  videoId: string,
  storagePath: string | null,
): Promise<void> {
  if (!storagePath) return
  try {
    const { count } = await client
      .from('revisions')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'video')
      .eq('entity_id', videoId)
    if (!count) await client.storage.from('videos').remove([storagePath])
  } catch {
    // best-effort; the next publish's gcVideoObjects is the backstop
  }
}

/**
 * Remove orphaned objects from the `videos` bucket for one artist. Call AFTER
 * publishContent('video'). Best-effort: a GC failure must never fail the publish.
 */
export async function gcVideoObjects(client: SupabaseClient, artistId: string): Promise<void> {
  try {
    const { data: rows } = await client.from('videos').select('storage_path').eq('artist_id', artistId)
    const referenced = new Set<string>()
    for (const r of rows ?? []) if (r.storage_path) referenced.add(r.storage_path as string)

    const prefix = `${artistId}/videos`
    const { data: objs } = await client.storage.from('videos').list(prefix, { limit: 1000 })
    const listed = (objs ?? []).map((o) => `${prefix}/${o.name}`)

    const toRemove = orphanedPaths(listed, referenced)
    if (toRemove.length) await client.storage.from('videos').remove(toRemove)
  } catch {
    // swallow — GC is opportunistic cleanup, not part of the publish contract
  }
}
