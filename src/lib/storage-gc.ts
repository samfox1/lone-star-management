import type { SupabaseClient } from '@supabase/supabase-js'
import { BRAND_FOLDER } from '@/lib/brand'
import { FONTS_BUCKET, FONT_FOLDER } from '@/lib/fonts'

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
 * Remove an uploaded song's audio object once nothing points at it — but ONLY if that
 * song was never published (no revision references it). `audio_path_for_play` resolves
 * the path out of the PUBLISHED revision, not the live row, so a published song's object
 * must survive until its tombstone is published or the player 404s on a file that cannot
 * be recovered. Mirrors gcDeletedMediaObject.
 *
 * Called by BOTH row-deleting paths: the song MERGE (whichever master the merged song
 * does not adopt is referenced by nothing afterwards) and plain song deletion
 * (deleteContentAction('track')). The audio bucket is paid storage, so an unreferenced
 * master must not outlive its row. Best-effort: never fails the operation that
 * triggered it.
 */
export async function gcDeletedAudioObject(
  client: SupabaseClient,
  trackId: string,
  audioPath: string | null,
): Promise<void> {
  if (!audioPath) return
  try {
    const { count } = await client
      .from('revisions')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'track')
      .eq('entity_id', trackId)
    if (!count) await client.storage.from('audio').remove([audioPath])
  } catch {
    // best-effort cleanup; a leaked object costs storage, a thrown error costs the merge
  }
}

/** Every folder the `media` bucket stores an artist's objects under — one per
 *  `media.purpose` (20260624140000). The GC must know ALL of them: it once swept only
 *  `gallery`, so replacing a hero video or profile photo stranded the old object in a
 *  PUBLIC bucket forever, referenced by nothing and collected by no one. skeen carried
 *  6 such strays (~17.6MB) from a single hero change. Add a purpose → add it here.
 *
 *  `brand` holds the logos AND the generated favicon (20260804160000). It matters more
 *  than the others: the favicon is REGENERATED on every save, so re-framing the tab icon
 *  three times leaves three strays. Live objects are kept because their media row still
 *  references them — only superseded ones are swept.
 *
 *  FONTS ARE NOT IN THIS LIST, on purpose: they live in their own `fonts` bucket (2 MB
 *  cap, four font mime types), not in `media`. Adding the folder here would sweep a
 *  path in the wrong bucket and quietly do nothing. Their sweep is `gcFontObjects`. */
export const MEDIA_FOLDERS = ['gallery', 'hero-videos', 'profile', BRAND_FOLDER] as const

/**
 * Remove orphaned objects from the `media` bucket for one artist. Call AFTER publishing
 * media (once a deleted photo's revision is tombstoned, its object is a true orphan).
 * Sweeps every folder in MEDIA_FOLDERS and keeps anything still referenced by a media
 * row. Scoped to `{artistId}/…`, so it can never reach another tenant's objects.
 * Best-effort: never fails the publish.
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

    // One round-trip per folder, CONCURRENTLY: they're independent, and this runs
    // inside publish. Sweeping them in series made publish ~3x slower on the network
    // and pushed the publishAll tests past their timeout.
    const perFolder = await Promise.all(
      MEDIA_FOLDERS.map(async (folder) => {
        const prefix = `${artistId}/${folder}`
        const { data: objs } = await client.storage.from('media').list(prefix, { limit: 1000 })
        return (objs ?? []).map((o) => ({
          path: `${prefix}/${o.name}`,
          createdAt: (o as { created_at?: string | null }).created_at,
        }))
      }),
    )
    const listed = perFolder.flat()

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

/**
 * Remove orphaned objects from the `fonts` bucket for one artist.
 *
 * Fonts are the case the brand folder taught us about: replacing a font uploads a new
 * object and repoints the row, and the old file sits in a PUBLIC bucket referenced by
 * nothing, collected by no one, forever. The brand folder leaked exactly this way.
 *
 * `referenced` is the union of the WORKING rows and every path in a live PUBLISHED
 * revision, which makes this safe to call from either place: at delete time (the common
 * case — upload the wrong file, remove it) and after a fonts publish. A font that is
 * still live on the published site keeps its object even though its working row is gone,
 * because the published stylesheet still names that URL and a fan's browser will still
 * ask for it. Take that away and the site loses its typeface with no error anywhere.
 *
 * The GC_MIN_AGE_MS floor still applies, so an object uploaded moments ago survives a
 * sweep triggered before its row lands. Best-effort, like every other GC here.
 */
export async function gcFontObjects(
  client: SupabaseClient,
  artistId: string,
  minAgeMs: number = GC_MIN_AGE_MS,
): Promise<void> {
  try {
    const [working, published] = await Promise.all([
      client.from('artist_fonts').select('storage_path').eq('artist_id', artistId),
      client
        .from('revisions')
        .select('data')
        .eq('artist_id', artistId)
        .eq('entity_type', 'artist_font'),
    ])

    const referenced = new Set<string>()
    for (const r of working.data ?? []) if (r.storage_path) referenced.add(r.storage_path as string)
    for (const r of published.data ?? []) {
      const path = (r.data as { storage_path?: string } | null)?.storage_path
      if (path) referenced.add(path)
    }

    const prefix = `${artistId}/${FONT_FOLDER}`
    const { data: objs } = await client.storage.from(FONTS_BUCKET).list(prefix, { limit: 1000 })
    const listed = (objs ?? []).map((o) => ({
      path: `${prefix}/${o.name}`,
      createdAt: (o as { created_at?: string | null }).created_at,
    }))

    const toRemove = collectablePaths(listed, referenced, Date.now(), minAgeMs)
    if (toRemove.length) await client.storage.from(FONTS_BUCKET).remove(toRemove)
  } catch {
    // swallow — GC is opportunistic cleanup, never part of the write's contract
  }
}
