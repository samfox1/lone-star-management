/**
 * Released vs Unreleased — the provenance-based split of an artist's catalog. DERIVED,
 * not stored: an item is Unreleased iff it has no platform presence (uploaded to Lone
 * Star, not on Spotify/Apple/etc.); everything on a platform is Released. A track inside
 * a release inherits that release's bucket. This module is the single source of truth;
 * the SQL public doors mirror the same logic to expose Released-only. See
 * MUSIC_RESTRUCTURE.md. (Decided 2026-07-08: Unreleased is dashboard-only for now.)
 */

export type MusicBucket = 'released' | 'unreleased'

/** The release columns provenance depends on. */
export type ReleaseProvenance = {
  source: string | null
  spotify_id: string | null
  /** The DSP links jsonb array; a non-empty list means the release is on platforms. */
  links: unknown
}

/** A release is Unreleased iff it has NO platform presence at all. */
export function releaseBucket(r: ReleaseProvenance): MusicBucket {
  const hasLinks = Array.isArray(r.links) && r.links.length > 0
  const onPlatform = r.source !== 'manual' || r.spotify_id != null || hasLinks
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
}

/** True iff a loose track carries any platform linkage (source or an external id/url). */
function trackOnPlatform(t: TrackProvenance): boolean {
  return (
    t.source !== 'manual' ||
    t.spotify_id != null ||
    t.apple_id != null ||
    t.deezer_id != null ||
    t.provider_url != null ||
    t.stream_url != null ||
    t.apple_url != null
  )
}

/**
 * Classify a track. A track in a release inherits that release's bucket (pass
 * `releaseBucketOf`, e.g. a lookup into the artist's releases). A loose track — or one
 * whose release can't be resolved — is classified by its own provenance: Unreleased
 * unless it has platform linkage. `audio_path` alone does not make a track Released (a
 * Released track may carry an uploaded master; an uploaded demo with no platform link is
 * Unreleased).
 */
export function trackBucket(
  t: TrackProvenance,
  releaseBucketOf?: (releaseId: string) => MusicBucket | undefined,
): MusicBucket {
  if (t.release_id) {
    const inherited = releaseBucketOf?.(t.release_id)
    if (inherited) return inherited
  }
  return trackOnPlatform(t) ? 'released' : 'unreleased'
}
