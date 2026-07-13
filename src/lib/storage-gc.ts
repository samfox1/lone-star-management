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

/** Default: never collect an object younger than this. performUpload writes the object
 *  BEFORE its row, so a just-uploaded object briefly looks unreferenced — the age gate
 *  stops a concurrent publish's GC from deleting it (and the replaced-file race) before
 *  its row lands. Well above any realistic upload+write time. */
export const GC_MIN_AGE_MS = 15 * 60 * 1000

/** Objects that are BOTH unreferenced AND old enough to not be mid-upload → collectable. */
export function collectablePaths(
  listed: { path: string; createdAt?: string | null }[],
  referenced: Iterable<string>,
  nowMs: number,
  minAgeMs: number = GC_MIN_AGE_MS,
): string[] {
  const keep = new Set(referenced)
  return listed
    .filter((o) => !keep.has(o.path))
    .filter((o) => {
      const age = o.createdAt ? nowMs - new Date(o.createdAt).getTime() : 0 // no timestamp → treat as fresh, skip
      return age >= minAgeMs
    })
    .map((o) => o.path)
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
 * Remove a gallery image's object at DELETE time — but ONLY if the media was never
 * published (no revision references it). Media is served on the public site from its
 * revision SNAPSHOT (get_public_site reads `storage_path` out of published_revisions),
 * so a published photo's object MUST survive until its tombstone is published, or the
 * live site 404s and the file is unrecoverable. The next publish's gcMediaObjects is
 * the backstop for those. Mirrors gcDeletedVideoObject. Best-effort.
 */
export async function gcDeletedMediaObject(
  client: SupabaseClient,
  mediaId: string,
  storagePath: string | null,
): Promise<void> {
  if (!storagePath) return
  try {
    const { count } = await client
      .from('revisions')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'media')
      .eq('entity_id', mediaId)
    if (!count) await client.storage.from('media').remove([storagePath])
  } catch {
    // best-effort; the next publish's gcMediaObjects is the backstop
  }
}

/**
 * Remove orphaned gallery objects from the `media` bucket for one artist. Call AFTER
 * publishing media (once a deleted photo's revision is tombstoned, its object is a true
 * orphan). Sweeps the `{artistId}/gallery` folder — the editor's gallery domain — and
 * keeps anything still referenced by a media row. Best-effort: never fails the publish.
 */
export async function gcMediaObjects(
  client: SupabaseClient,
  artistId: string,
  minAgeMs: number = GC_MIN_AGE_MS,
): Promise<void> {
  try {
    const { data: rows } = await client.from('media').select('storage_path').eq('artist_id', artistId)
    const referenced = new Set<string>()
    for (const r of rows ?? []) if (r.storage_path) referenced.add(r.storage_path as string)

    const prefix = `${artistId}/gallery`
    const { data: objs } = await client.storage.from('media').list(prefix, { limit: 1000 })
    const listed = (objs ?? []).map((o) => ({
      path: `${prefix}/${o.name}`,
      createdAt: (o as { created_at?: string | null }).created_at,
    }))

    const toRemove = collectablePaths(listed, referenced, Date.now(), minAgeMs)
    if (toRemove.length) await client.storage.from('media').remove(toRemove)
  } catch {
    // swallow — GC is opportunistic cleanup, not part of the publish contract
  }
}

/**
 * Remove orphaned objects from the `videos` bucket for one artist. Call AFTER
 * publishContent('video'). Best-effort: a GC failure must never fail the publish.
 */
export async function gcVideoObjects(
  client: SupabaseClient,
  artistId: string,
  minAgeMs: number = GC_MIN_AGE_MS,
): Promise<void> {
  try {
    const { data: rows } = await client.from('videos').select('storage_path').eq('artist_id', artistId)
    const referenced = new Set<string>()
    for (const r of rows ?? []) if (r.storage_path) referenced.add(r.storage_path as string)

    const prefix = `${artistId}/videos`
    const { data: objs } = await client.storage.from('videos').list(prefix, { limit: 1000 })
    const listed = (objs ?? []).map((o) => ({
      path: `${prefix}/${o.name}`,
      createdAt: (o as { created_at?: string | null }).created_at,
    }))

    const toRemove = collectablePaths(listed, referenced, Date.now(), minAgeMs)
    if (toRemove.length) await client.storage.from('videos').remove(toRemove)
  } catch {
    // swallow — GC is opportunistic cleanup, not part of the publish contract
  }
}
