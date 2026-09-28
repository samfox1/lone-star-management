/**
 * Merging two duplicate song rows into one.
 *
 * WHY DUPLICATES EXIST: `syncTracks` matches a song across platforms by normalized title
 * plus duration, and REFUSES the match when either side has no duration. That refusal is
 * deliberate — title alone cannot separate two recordings, and the outcomes are not
 * symmetric: a wrong merge absorbs the incoming song so it is never inserted (silent,
 * permanent loss), while a refusal leaves a duplicate the manager can resolve in seconds.
 * This module is that resolution.
 *
 * The same asymmetry governs every rule below. Where the evidence is ambiguous this
 * refuses and leaves both rows standing, because a duplicate is a nuisance and a lost
 * song is unrecoverable.
 *
 * `planSongMerge` is PURE — it decides every field's winner with no client and no I/O, so
 * the resolution table is testable exhaustively. `mergeSongs` is the wiring: it applies a
 * plan over an injected client, inside the caller's RLS scope.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeTitle, type PlatformReleaseKind } from '@/lib/sync-match'
import { RELEASE_TYPES, type ReleaseType } from '@/lib/releases'

/** Enough of a song to tell whether another one is its duplicate. */
type TwinCandidate = { id: string; title: string; release_id?: string | null }

/**
 * The songs `song` could be merged into: its likely DUPLICATES, never the whole catalogue.
 * "Merge" offers only these, wherever a song opens (the song modal, a release's tracklist).
 *
 * A twin is another song whose title normalises to this one's (the sync's own match rule)
 * AND that is not the same song on ANOTHER release — a single that is also an album track
 * is two rows on purpose (Sam, 2026-09-11), not a duplicate. A twin on the same release,
 * or with no release (a stray upload, a refused sync match), is one. Offering every song
 * put a delete-this-song button beside songs that had nothing to do with it.
 */
export function mergeTwins<T extends TwinCandidate>(song: TwinCandidate, targets: readonly T[]): T[] {
  const key = normalizeTitle(song.title)
  const ours = song.release_id || null
  return targets.filter((t) => {
    if (t.id === song.id || normalizeTitle(t.title) !== key) return false
    const theirs = t.release_id || null
    return theirs === null || ours === null || theirs === ours
  })
}

/**
 * The platform handles. Two rows carrying DIFFERENT non-null values for the same one are
 * two different recordings, and merging them would delete a real song — so a difference
 * here refuses the whole merge (see `planSongMerge`).
 *
 * URLs are listed alongside ids, not treated as softer: `soundcloud_url` is SoundCloud's
 * ONLY handle (there is no id column), and an Apple/Deezer link identifies a track just as
 * an id does. `stream_url` and `provider_url` are the legacy per-source link columns and
 * carry the same weight.
 */
export const PLATFORM_IDENTITY = [
  { field: 'spotify_id', platform: 'Spotify' },
  { field: 'apple_id', platform: 'Apple' },
  { field: 'deezer_id', platform: 'Deezer' },
  { field: 'apple_url', platform: 'Apple' },
  { field: 'deezer_url', platform: 'Deezer' },
  { field: 'soundcloud_url', platform: 'SoundCloud' },
  { field: 'stream_url', platform: 'Spotify' },
  { field: 'provider_url', platform: 'the provider' },
] as const

/** Cross-platform FACTS that no one platform owns. Several providers report them and
 *  they disagree harmlessly (encoder padding, per-storefront art), so a difference is
 *  never evidence of a different song — it fills only where the kept row is empty. */
export const ENRICHMENT_FIELDS = ['album_name', 'cover_url', 'duration_ms', 'release_date'] as const

/** Manager-owned, but nullable: the kept row wins unless it has nothing there, in which
 *  case taking the duplicate's value is strictly better than dropping it. */
export const CURATED_FILLABLE_FIELDS = [
  'title',
  'release_id',
  'audio_path',
] as const

/**
 * Filled like CURATED_FILLABLE_FIELDS (the kept row's value stands; the duplicate's fills
 * an empty one), but the duplicate HOLDS the value under a unique index —
 * `(artist_id, drive_file_id)` — until it is deleted, so writing it with the rest of the
 * patch would be refused. The plan hands these over separately (`afterDelete`) and
 * `mergeSongs` writes them once the duplicate is gone.
 *
 * `drive_file_id` is what badges a Drive file "imported". Until 2026-09-28 the merge left
 * it on the duplicate, so it died with that row and the file read as never imported.
 */
const HANDED_OVER_FIELDS = ['drive_file_id'] as const

/**
 * Hand-edited LISTS that UNION: the merged song carries every entry either row had, the
 * kept row's first. `featured_artists` — collaborators live on the SONG and are edited by
 * hand (Sam, 2026-09-11); a pull only seeds an empty list. Two rows of one song each hold
 * credits someone chose, so keeping only one row's list deletes the other's.
 */
const UNION_LIST_FIELDS = ['featured_artists'] as const

/** What a platform sync stamps onto a song's type (sync-match classifyRelease). A Record
 *  over the platform kinds, so a new kind is a compile error here until it is placed. */
const SYNC_STAMPED: Record<Exclude<PlatformReleaseKind, 'single-or-ep'>, true> = { album: true, ep: true, single: true }

/**
 * The type tags only a MANAGER sets — every registry type a sync never stamps: Remix,
 * Live set, Featured. Derived from RELEASE_TYPES, so a new hand-only type joins by itself.
 */
export const HAND_SET_TYPES: readonly ReleaseType[] = RELEASE_TYPES.filter(
  (t) => (SYNC_STAMPED as Partial<Record<ReleaseType, true>>)[t] !== true,
)

/**
 * The song's TYPE tag. A hand-set tag beats a platform-stamped one, whichever row has it:
 * the column defaults to 'single', so the kept row always "has" a type, and treating it
 * like a title (kept row wins) turned a hand-tagged Remix or Live set back into a Single
 * (reviewer, 2026-09-28). Two hand-set tags, or two stamped ones: the kept row's stands.
 */
const TAG_FIELDS = ['release_type'] as const

/**
 * Columns of `tracks` a merge deliberately does NOT read or write, each with its reason.
 * Every live column must be here or in a rule above: tests/unit/music/song-merge.test.ts
 * checks the content registry, and tests/integration/music/song-merge.db.test.ts checks
 * the REAL table, so a new column cannot slip past a merge unnoticed.
 */
export const NOT_MERGED = {
  artist_id: 'both rows are the same artist (the pair is re-read scoped to it)',
  created_at: 'bookkeeping; the kept row keeps its own',
  updated_at: 'bookkeeping; the kept row keeps its own',
  sort_order: "the kept row's place in the catalog, which the manager may have dragged",
  source: "the kept row's provenance; the duplicate's platform handles union in above",
  parent_release_id: 'retired 2026-09-11 (nulled, never read)',
} as const satisfies Record<string, string>

/**
 * Manager-owned booleans where `false` is a DECISION, not an absence — so the kept row
 * wins outright and they are never OR-ed. OR-ing `on_site` would put a song back on the
 * public site that the manager had taken off it, and OR-ing `released` would relabel a
 * demo, both as a side effect of tidying a duplicate. Nothing is lost that a click can't
 * restore, and the merged row's Released bucket can only ever WIDEN anyway: it inherits
 * the union of both rows' platform links.
 */
export const CURATED_ABSOLUTE_FIELDS = ['on_site', 'released'] as const

/** Every column the merge reads. */
export type MergeableSong = {
  id: string
  title: string | null
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
  apple_url: string | null
  deezer_url: string | null
  soundcloud_url: string | null
  stream_url: string | null
  provider_url: string | null
  album_name: string | null
  cover_url: string | null
  duration_ms: number | null
  release_date: string | null
  on_site: boolean | null
  released: boolean | null
  release_type: string | null
  release_id: string | null
  audio_path: string | null
  featured_artists: string[] | null
  drive_file_id: string | null
}

/** The columns `mergeSongs` must SELECT for a plan to be complete. A column missing here
 *  reads as null, which silently makes the kept row look empty and lets the duplicate
 *  overwrite it. */
export const MERGE_COLUMNS = [
  'id',
  ...PLATFORM_IDENTITY.map((p) => p.field),
  ...ENRICHMENT_FIELDS,
  ...CURATED_FILLABLE_FIELDS,
  ...HANDED_OVER_FIELDS,
  ...UNION_LIST_FIELDS,
  ...TAG_FIELDS,
  ...CURATED_ABSOLUTE_FIELDS,
].join(', ')

type MergeConflict = { field: string; platform: string; keep: string; drop: string }

type MergePlan =
  | {
      ok: true
      /** Columns to write onto the kept row. Only genuinely-changing values appear. */
      patch: Record<string, unknown>
      /** HANDED_OVER_FIELDS to write onto the kept row once the duplicate is deleted. */
      afterDelete: Record<string, unknown>
      /** The duplicate's audio object when the merged row does NOT adopt it — paid
       *  storage that nothing will reference once the duplicate row is deleted. */
      orphanedAudioPath: string | null
    }
  | { ok: false; conflicts: MergeConflict[] }

/** Null, undefined and '' are all "nothing here". `false` and `0` are values. */
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === ''
}

const isHandSet = (t: string | null) => (HAND_SET_TYPES as readonly (string | null)[]).includes(t)

/** The type tag to write onto the kept row, or undefined to leave it. See TAG_FIELDS. */
function pickTag(keep: string | null, drop: string | null): string | undefined {
  if (isHandSet(keep)) return undefined
  if (isHandSet(drop)) return drop!
  return isEmpty(keep) && !isEmpty(drop) ? drop! : undefined
}

/** A's names, then B's that A lacks. Same name = same after trimming, in any case; A's
 *  spelling wins. Blank entries are dropped. */
function unionNames(a: readonly string[], b: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...a, ...b]) {
    const name = raw.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Decide every field of a merge of `drop` into `keep`, or refuse.
 *
 * Refuses iff the two rows carry different non-null handles for the same platform. That
 * check runs over ALL fields before anything else, so a refusal reports every conflicting
 * platform at once and the manager can resolve them in one pass instead of one retry each.
 */
export function planSongMerge(keep: MergeableSong, drop: MergeableSong): MergePlan {
  const conflicts: MergeConflict[] = []
  for (const { field, platform } of PLATFORM_IDENTITY) {
    const a = keep[field]
    const b = drop[field]
    if (a != null && b != null && a !== b) conflicts.push({ field, platform, keep: a, drop: b })
  }
  if (conflicts.length) return { ok: false, conflicts }

  const patch: Record<string, unknown> = {}

  // Platform handles UNION: the kept row gains every platform it was missing. A tie needs
  // no write, and a value only the kept row has must never be nulled back out.
  for (const { field } of PLATFORM_IDENTITY) {
    if (keep[field] == null && drop[field] != null) patch[field] = drop[field]
  }

  for (const field of ENRICHMENT_FIELDS) {
    if (isEmpty(keep[field]) && !isEmpty(drop[field])) patch[field] = drop[field]
  }

  for (const field of CURATED_FILLABLE_FIELDS) {
    if (isEmpty(keep[field]) && !isEmpty(drop[field])) patch[field] = drop[field]
  }

  const afterDelete: Record<string, unknown> = {}
  for (const field of HANDED_OVER_FIELDS) {
    if (isEmpty(keep[field]) && !isEmpty(drop[field])) afterDelete[field] = drop[field]
  }

  for (const field of UNION_LIST_FIELDS) {
    const own = unionNames(keep[field] ?? [], [])
    const merged = unionNames(own, drop[field] ?? [])
    // Written only when the duplicate brings a name the kept row lacks.
    if (merged.length > own.length) patch[field] = merged
  }

  for (const field of TAG_FIELDS) {
    const tag = pickTag(keep[field], drop[field])
    if (tag !== undefined) patch[field] = tag
  }

  // CURATED_ABSOLUTE_FIELDS are intentionally absent: the kept row's value stands, so
  // there is nothing to write.

  // The duplicate's master is orphaned only when the merged row ends up pointing
  // somewhere else. If the kept row adopted it (above), or both rows already pointed at
  // the same object, it is still live and deleting it would break the surviving song.
  const survivingAudio = (patch.audio_path as string | undefined) ?? keep.audio_path
  const orphanedAudioPath =
    drop.audio_path && drop.audio_path !== survivingAudio ? drop.audio_path : null

  return { ok: true, patch, afterDelete, orphanedAudioPath }
}

/** Manager-facing wording for a refusal. Names the platforms so the fix is obvious:
 *  clear the wrong handle on one row, or accept that these are two different songs. */
function mergeConflictMessage(conflicts: MergeConflict[]): string {
  const platforms = [...new Set(conflicts.map((c) => c.platform))]
  const list =
    platforms.length === 1
      ? platforms[0]
      : `${platforms.slice(0, -1).join(', ')} and ${platforms[platforms.length - 1]}`
  return `These songs have different ${list} links, so they're probably not the same song. Clear the wrong one first, then merge.`
}

type MergeResult =
  | { ok: true; orphanedAudioPath: string | null }
  | { ok: false; error: string }

/**
 * Merge `dropId` into `keepId` for one artist.
 *
 * BOTH ids are re-read scoped to `artistId` under the caller's RLS. That is the whole
 * cross-artist defence: an id belonging to another tenant matches nothing, so the pair
 * fails to resolve and the merge never starts. Passing the artist id from the client is
 * therefore harmless — it can only ever NARROW what this can touch, never widen it.
 *
 * ORDER MATTERS: the kept row is updated BEFORE the duplicate is deleted. If the delete
 * then fails, the merged data is already safe on the kept row and the duplicate simply
 * survives to be merged again — the failure leaves a redundant row, never a lost one.
 * Deleting first would open a window where both the data and the row are gone.
 */
export async function mergeSongs(
  client: SupabaseClient,
  artistId: string,
  keepId: string,
  dropId: string,
): Promise<MergeResult> {
  if (keepId === dropId) return { ok: false, error: 'Pick two different songs to merge.' }

  const { data, error } = await client
    .from('tracks')
    .select(MERGE_COLUMNS)
    .eq('artist_id', artistId)
    .in('id', [keepId, dropId])
  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []) as unknown as MergeableSong[]
  const keep = rows.find((r) => r.id === keepId)
  const drop = rows.find((r) => r.id === dropId)
  // Fewer than two rows means one id is gone, or belongs to another artist, or is hidden
  // by RLS. All three are the same answer to the caller: there is no such pair here.
  if (!keep || !drop) return { ok: false, error: 'Those songs are no longer both here.' }

  const plan = planSongMerge(keep, drop)
  if (!plan.ok) return { ok: false, error: mergeConflictMessage(plan.conflicts) }

  if (Object.keys(plan.patch).length > 0) {
    const { error: uErr } = await client.from('tracks').update(plan.patch).eq('id', keepId)
    if (uErr) return { ok: false, error: uErr.message }
  }

  const { error: dErr } = await client.from('tracks').delete().eq('id', dropId)
  if (dErr) return { ok: false, error: dErr.message }

  // Only now is the duplicate's Drive file id free to move (HANDED_OVER_FIELDS). The merge
  // is already done, so a failure here does not fail it: the worst case is the Drive file
  // reading "not imported", which is what every merge did before this was carried.
  if (Object.keys(plan.afterDelete).length > 0) {
    await client.from('tracks').update(plan.afterDelete).eq('id', keepId)
  }

  return { ok: true, orphanedAudioPath: plan.orphanedAudioPath }
}
