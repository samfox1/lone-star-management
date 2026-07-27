/**
 * Released vs Unreleased — the split of an artist's catalog. An item is Released iff it
 * has platform presence (a DSP source/id/link) OR was hand-added and marked released
 * (the stored `released` flag on tracks/releases — amended 2026-07-09, so it's platform
 * presence OR the flag, not purely derived). Everything else is Unreleased (uploaded to
 * Lone Star, not on Spotify/Apple/etc.). Release membership is WIDEN-ONLY: a song is
 * Released if its own provenance OR its release is Released. This module is the single
 * source of truth; the SQL public doors mirror it to expose Released-only. See
 * MUSIC_RESTRUCTURE.md. (Decided 2026-07-08: Unreleased is dashboard-only for now.)
 */

export type MusicBucket = 'released' | 'unreleased'

/** The release columns provenance depends on. */
export type ReleaseProvenance = {
  source: string | null
  spotify_id: string | null
  /** The DSP links jsonb array; a non-empty list means the release is on platforms. */
  links: unknown
  /** The manual "this is released" flag — a hand-added album/EP with no links
   *  can still be public (its songs inherit this bucket). */
  released?: boolean | null
}

/** A release is Unreleased iff it has NO platform presence AND wasn't manually
 *  marked released. */
export function releaseBucket(r: ReleaseProvenance): MusicBucket {
  const hasLinks = Array.isArray(r.links) && r.links.length > 0
  const onPlatform = r.source !== 'manual' || r.spotify_id != null || hasLinks || r.released === true
  return onPlatform ? 'released' : 'unreleased'
}

/** The track columns provenance depends on. */
export type TrackProvenance = {
  release_id: string | null
  source: string | null
  audio_path: string | null
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
  provider_url: string | null
  stream_url: string | null
  /** Apple/iTunes store link from the union model — counts as platform presence. */
  apple_url: string | null
  /** SoundCloud link (no id column to rebuild from) — counts as platform presence. */
  soundcloud_url?: string | null
  /** Manager-entered Deezer link — a stored URL (the synced deezer_id is a separate id). */
  deezer_url?: string | null
  /** The manual "this song is released" toggle — a hand-added song with no links
   *  can still be public. Platform linkage implies released regardless. */
  released?: boolean | null
}

/** True iff a loose track counts as released: any platform linkage (source or an
 *  external id/url) OR the manual released flag. */
function trackOnPlatform(t: TrackProvenance): boolean {
  return (
    t.source !== 'manual' ||
    t.spotify_id != null ||
    t.apple_id != null ||
    t.deezer_id != null ||
    t.provider_url != null ||
    t.stream_url != null ||
    t.apple_url != null ||
    t.soundcloud_url != null ||
    t.deezer_url != null ||
    t.released === true
  )
}

/** The platform id/link columns a union-model track can carry (subset of TrackProvenance). */
export type TrackPlatformIds = {
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
  /** Apple's store link can't be rebuilt from apple_id, so it's stored. */
  apple_url: string | null
  /** SoundCloud link — stored (no id column). */
  soundcloud_url?: string | null
  /** Manager-entered Deezer link — stored; preferred over rebuilding from deezer_id. */
  deezer_url?: string | null
}

export type PlatformRef = { key: 'spotify' | 'apple' | 'deezer' | 'soundcloud'; label: string; url: string | null }

/**
 * Which platforms a union-model track lives on — one entry per non-null id/link,
 * for the per-platform badges on the Music cards. Spotify/Deezer links rebuild
 * from the id; Apple's and SoundCloud's come from their stored URLs.
 */
export function trackPlatforms(t: TrackPlatformIds): PlatformRef[] {
  const out: PlatformRef[] = []
  if (t.spotify_id) out.push({ key: 'spotify', label: 'Spotify', url: `https://open.spotify.com/track/${t.spotify_id}` })
  // Badge on the Apple URL alone (mirroring SoundCloud): an Apple-only add stores
  // apple_url and may not yield an apple_id, but it's still on the platform.
  if (t.apple_id || t.apple_url) out.push({ key: 'apple', label: 'Apple', url: t.apple_url })
  if (t.deezer_url || t.deezer_id)
    out.push({
      key: 'deezer',
      label: 'Deezer',
      url: t.deezer_url ?? (t.deezer_id ? `https://www.deezer.com/track/${t.deezer_id}` : null),
    })
  if (t.soundcloud_url) out.push({ key: 'soundcloud', label: 'SoundCloud', url: t.soundcloud_url })
  return out
}

/**
 * Classify a track — WIDEN-ONLY: a track is Released if it has its OWN platform
 * linkage OR its release is Released. Two consequences, both intended:
 *   - a song on a Released album is Released (album membership wins), even a
 *     hand-added one marked "unreleased";
 *   - a platform-linked song stays Released even inside an Unreleased album (it
 *     doesn't vanish — the release only ever widens the bucket, never narrows it).
 * A loose track — or one whose release can't be resolved — is classified by its own
 * provenance. `audio_path` alone does not make a track Released (a Released track may
 * carry an uploaded master; an uploaded demo with no platform link is Unreleased).
 */
export function trackBucket(
  t: TrackProvenance,
  releaseBucketOf?: (releaseId: string) => MusicBucket | undefined,
): MusicBucket {
  const releaseReleased = t.release_id ? releaseBucketOf?.(t.release_id) === 'released' : false
  return trackOnPlatform(t) || releaseReleased ? 'released' : 'unreleased'
}

/**
 * Group songs into PROJECTS — the SINGLE grouping seam for the editor's Music panel and
 * the assets Music page. This is the whole grouping law, in one place.
 *
 * A project is the set of songs sharing a PARENT release (`tracks.release_id`, a stable
 * FK — 20260727120000 backfilled it). The parent is the source of truth for membership;
 * NOT the album name (rename-unsafe, title-collision-prone) and NOT cover art (a heuristic
 * that mis-groups variant covers / same-cover singles). A song with NO parent (a
 * SoundCloud single/remix that created no release) stands alone as its own one-song
 * project, keyed by its id.
 *
 * The parent RELEASE row supplies the project's title + date. Its TYPE comes from the
 * songs' own `release_type` tag (per-song, 20260726120000), which agree within a release.
 * `released` is a per-song LIBRARY label and is NOT consulted here — visibility is the
 * songs' `on_site`, surfaced as `anyOnSite` for the panel's toggle.
 */
export type ProjectTrack = {
  id: string
  /** The parent release this song belongs to, or null for a standalone single. */
  release_id: string | null
  /** The song's own type tag (single/ep/album/remix/featured) — 20260726120000. */
  release_type: string | null
  /** Fallback display title for a standalone song (no parent release to name it). */
  title: string | null
  on_site: boolean | null
}
export type ReleaseMeta = {
  title: string | null
  release_date: string | null
}
export type MusicProject = {
  /** Stable key: `release:<id>` for a parented project, `track:<id>` for a standalone. */
  key: string
  title: string
  /** The project's type. Its songs agree within a release; the first is representative. */
  releaseType: string
  releaseDate: string | null
  trackIds: string[]
  anyOnSite: boolean
}

export function groupTracksIntoProjects(
  tracks: ProjectTrack[],
  releaseById: (id: string) => ReleaseMeta | undefined,
): MusicProject[] {
  type G = { key: string; releaseId: string | null; type: string; title: string | null; ids: string[]; anyOnSite: boolean }
  const groups = new Map<string, G>()
  for (const t of tracks) {
    // The parent release groups; a parent-less song is its own project. The two key
    // spaces (`release:` vs `track:`) are disjoint, so keys can never collide.
    const key = t.release_id ? `release:${t.release_id}` : `track:${t.id}`
    const g =
      groups.get(key) ??
      { key, releaseId: t.release_id ?? null, type: t.release_type ?? 'single', title: t.title ?? null, ids: [], anyOnSite: false }
    g.ids.push(t.id)
    if (t.on_site ?? false) g.anyOnSite = true
    groups.set(key, g)
  }

  return [...groups.values()]
    .map((g) => {
      const r = g.releaseId ? releaseById(g.releaseId) : undefined
      return {
        key: g.key,
        title: r?.title ?? g.title ?? 'Untitled',
        releaseType: g.type,
        releaseDate: r?.release_date ?? null,
        trackIds: g.ids,
        anyOnSite: g.anyOnSite,
      }
    })
    .sort((a, b) => {
      // Newest first; a project with no date sorts last (a stable, if arbitrary, tail).
      if (!a.releaseDate && !b.releaseDate) return 0
      if (!a.releaseDate) return 1
      if (!b.releaseDate) return -1
      return b.releaseDate.localeCompare(a.releaseDate)
    })
}
