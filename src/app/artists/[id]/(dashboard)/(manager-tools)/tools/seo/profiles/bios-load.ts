import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntegrationArtist } from '@/lib/integrations-registry'
import { readProfileMarks, type ProfileMarks } from '@/lib/manager-tools/seo/profiles/marks'
import {
  BIO_FACTS,
  bioReads,
  connectedBios,
  factChanges,
  mergeChanges,
  photoChanges,
  type BiosInput,
  type PhotoRevision,
  type ProfileRevision,
} from '@/lib/manager-tools/seo/profiles/bio-state'
import { PROFILE_PHOTO } from '@/lib/profile-photo'

/** The newest profile Publishes read. A Publish only writes the profile when it changed, so this
 *  is years of history; the oldest row of a full window is never taken for the first (factChanges). */
const REVISION_CAP = 300

/** The newest profile-photo snapshots read. One per photo Published, so years of history too. */
const PHOTO_CAP = 300

/**
 * The profile photo's published history (photoChanges): every snapshot of a profile-photo media
 * row, with ONLY its file (`data->>storage_path`), and the tombstones that took those rows off the
 * site. A tombstone carries no purpose (`{ _deleted: true }`), so it is found by the row ids the
 * snapshots named. Null when either read failed: the rows then say "couldn't check".
 */
async function readPhotoHistory(supabase: SupabaseClient, artistId: string): Promise<{ rows: PhotoRevision[]; complete: boolean } | null> {
  const snaps = await supabase
    .from('revisions')
    .select('entity_id, published_at, path:data->>storage_path')
    .eq('artist_id', artistId)
    .eq('entity_type', 'media')
    .eq('data->>purpose', PROFILE_PHOTO)
    .order('published_at', { ascending: false })
    .limit(PHOTO_CAP)
  if (snaps.error) return null
  const named = (snaps.data ?? []) as unknown as { entity_id: string; published_at: string; path: string | null }[]
  if (named.length === 0) return { rows: [], complete: true }
  const tombs = await supabase
    .from('revisions')
    .select('entity_id, published_at')
    .eq('artist_id', artistId)
    .eq('entity_type', 'media')
    .in('entity_id', [...new Set(named.map((r) => r.entity_id))])
    .eq('data->>_deleted', 'true')
  if (tombs.error) return null
  const rows: PhotoRevision[] = [
    ...named.map((r) => ({ entity_id: String(r.entity_id), published_at: String(r.published_at), path: r.path ?? null })),
    ...((tombs.data ?? []) as { entity_id: string; published_at: string }[]).map((r) => ({ entity_id: String(r.entity_id), published_at: String(r.published_at), path: null })),
  ]
  return { rows, complete: named.length < PHOTO_CAP }
}

/** One row's facts, read back from their JSON text. A fact the snapshot doesn't carry (SQL null)
 *  is LEFT OUT, never null: factChanges compares a fact only when both snapshots carry it. */
function factsOf(row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const f of BIO_FACTS) {
    const raw = row[f]
    if (typeof raw !== 'string') continue
    try {
      data[f] = JSON.parse(raw)
    } catch {
      data[f] = raw
    }
  }
  return data
}

/**
 * What the Outside bios rows are built from (lib/manager-tools/seo/profiles/bio-state.ts): the
 * artist's links (which platforms are connected), the "updated" ticks, the published profiles,
 * newest first, reading ONLY the fact fields out of each snapshot, the profile photo's
 * published history (readPhotoHistory), so a new photo counts as a fact change, and the newest
 * AI test run's results, for the bios the test reads itself (bioReads: YouTube's description).
 * Only `results` is read from the run, never the crawl.
 *
 * Every read runs on the manager's own session after the page's ownership gate, so RLS decides
 * (`revisions_rw`, `links`, `profile_marks`, `seo_test_runs`: the artist's managers). NEVER
 * THROWS: a read that fails leaves its part null, and the rows say "couldn't check" (bioRows); a
 * run that can't be read is no read, and the rows keep their manual state.
 *
 * `artist` is the gate's row (requireArtist), which carries the source id columns. `marks`: the
 * page's own read of profile_marks, when it makes one (the Profiles page), so it is read once.
 */
export async function loadOutsideBios(
  supabase: SupabaseClient,
  artist: IntegrationArtist & { id: string },
  marksRead?: Promise<ProfileMarks | null>,
): Promise<BiosInput> {
  const id = artist.id
  const [links, marks, revisions, photos, results] = await Promise.all([
    supabase
      .from('links')
      .select('id, label, url, role')
      .eq('artist_id', id)
      .then(
        (r) => (r.error ? null : ((r.data ?? []) as { id: string; label: string | null; url: string | null; role: string | null }[])),
        () => null,
      ),
    marksRead ?? readProfileMarks(supabase, id).catch(() => null),
    supabase
      .from('revisions')
      // `name:data->name::text, …`: the facts only, never the whole snapshot (the press kit rides
      // it), each as its JSON TEXT so a missing key (SQL null) is not a present null (the text
      // 'null'). `data->name` alone answers null for both.
      .select(['published_at', ...BIO_FACTS.map((f) => `${f}:data->${f}::text`)].join(', '))
      .eq('artist_id', id)
      .eq('entity_type', 'artist')
      .order('published_at', { ascending: false })
      .limit(REVISION_CAP)
      .then(
        (r) => (r.error ? null : ((r.data ?? []) as unknown as Record<string, unknown>[])),
        () => null,
      ),
    readPhotoHistory(supabase, id).catch(() => null),
    supabase
      .from('seo_test_runs')
      .select('results')
      .eq('artist_id', id)
      .eq('status', 'done')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(
        (r) => (r.error ? null : ((r.data as { results?: unknown } | null)?.results ?? null)),
        () => null,
      ),
  ])
  const rows: ProfileRevision[] | null = revisions?.map((r) => ({ published_at: String(r.published_at), data: factsOf(r) })) ?? null
  // Both halves or neither: a photo history that failed to read could hide the change that
  // makes a bio out of date, so the rows say "couldn't check" rather than "updated".
  const known = rows !== null && photos !== null
  return {
    bios: links ? connectedBios(links, artist) : null,
    marks,
    factsKnown: known,
    changes: known
      ? mergeChanges(factChanges(rows, { complete: rows.length < REVISION_CAP }), photoChanges(photos.rows, { complete: photos.complete }))
      : [],
    reads: bioReads(results),
  }
}
