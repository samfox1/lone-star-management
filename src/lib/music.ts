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

/** The platform id columns a union-model track can carry (subset of TrackProvenance). */
export type TrackPlatformIds = {
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
  /** Apple's store link can't be rebuilt from apple_id, so it's stored. */
  apple_url: string | null
}

export type PlatformRef = { key: 'spotify' | 'apple' | 'deezer'; label: string; url: string | null }

/**
 * Which platforms a union-model track lives on — one entry per non-null id, for the
 * per-platform badges on the Music cards. Spotify/Deezer links rebuild from the id;
 * Apple's comes from the stored apple_url (null if the link was never captured).
 */
export function trackPlatforms(t: TrackPlatformIds): PlatformRef[] {
  const out: PlatformRef[] = []
  if (t.spotify_id) out.push({ key: 'spotify', label: 'Spotify', url: `https://open.spotify.com/track/${t.spotify_id}` })
  if (t.apple_id) out.push({ key: 'apple', label: 'Apple', url: t.apple_url })
  if (t.deezer_id) out.push({ key: 'deezer', label: 'Deezer', url: `https://www.deezer.com/track/${t.deezer_id}` })
  return out
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
