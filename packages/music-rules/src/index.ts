/**
 * THE Released rule. One implementation, two consumers: the Next app (src/lib/music.ts
 * re-exports this) and lone-star-agent (a separately deployed Node service). It lived in
 * both for months as hand-kept twins, and the agent's twin spent four weeks running a
 * narrowing inheritance rule that SQL had explicitly reverted — reporting live songs as
 * Unreleased — because nothing connected the two files.
 *
 * ZERO DEPENDENCIES and no runtime imports, deliberately: this must resolve inside a
 * Next bundle, a Node ESM process, a nitro/rollup build, and vitest without dragging any
 * of them into each other's dependency graph.
 *
 * A third implementation survives in SQL (music_release_is_released /
 * music_track_on_platform) and cannot be deleted: the public doors are SECURITY DEFINER
 * functions that decide Released-only visibility inside Postgres, where anon never runs
 * our TypeScript. tests/music-mirror.test.ts feeds identical fixtures through this module
 * and those functions and fails the moment they disagree.
 *
 * Released vs Unreleased is the split of an artist's catalog. An item is Released iff it
 * has platform presence (a DSP source/id/link) OR was hand-added and marked released (the
 * stored `released` flag — amended 2026-07-09, so it's platform presence OR the flag, not
 * purely derived). Everything else is Unreleased (uploaded to Lone Star, not on
 * Spotify/Apple/etc.). See MUSIC_RESTRUCTURE.md. (Decided 2026-07-08: Unreleased is
 * dashboard-only for now.)
 *
 * A SOUNDCLOUD LINK IS NEVER PLATFORM PRESENCE — for a song OR a release (Sam, 2026-09-10
 * for songs; 2026-09-28 for releases: "A soundcloud song can be released or unreleased,
 * depends on the song"). Both rules read ONE definition, `urlIsPresence`, mirrored in SQL
 * as `music_url_is_presence` (migration 20260928160000).
 */

export type MusicBucket = 'released' | 'unreleased'

/**
 * A SoundCloud link, by its host: soundcloud.com or snd.sc, or any subdomain of them
 * (on.soundcloud.com, m.soundcloud.com). A lookalike (notsoundcloud.com,
 * soundcloud.com.evil.io) is not. Same hosts as lib/song-links `linkPlatform` — a test
 * holds the two to the same answers. A REGEX rather than `new URL`, on purpose: the SQL
 * mirror (`music_url_is_presence`) runs this exact pattern with `~*`, so the two cannot
 * disagree about how a URL is parsed. Change one, change both.
 */
const SOUNDCLOUD_URL =
  /^\s*(?:[a-z][a-z0-9+.-]*:)?(?:\/\/)?(?:[^/?#@\s]*@)?(?:[^/?#@:\s]*\.)?(?:soundcloud\.com|snd\.sc)(?::[0-9]*)?(?:[/?#]|\s*$)/i

/** A release link filed in the SoundCloud slot (`release.links[].label`). */
const SOUNDCLOUD_LABEL = /^\s*soundcloud\s*$/i

/** True iff `url` is a string pointing at SoundCloud. */
export function isSoundCloudUrl(url: unknown): boolean {
  return typeof url === 'string' && SOUNDCLOUD_URL.test(url)
}

/**
 * THE definition of platform presence for a stored LINK — a song's link column or a
 * release's link: there is one, and it is not SoundCloud's. SoundCloud is where demos
 * and live sets live, so a link there proves nothing about release; the manager's
 * `released` flag decides those. Mirrored in SQL as `music_url_is_presence`.
 */
export function urlIsPresence(url: unknown): boolean {
  return url != null && !isSoundCloudUrl(url)
}

/** One entry of `release.links` (`{ label, url }`) counts as platform presence iff it is
 *  not in the SoundCloud slot and its URL is presence. Mirrored in SQL as
 *  `music_release_link_is_presence`. */
export function releaseLinkIsPresence(link: unknown): boolean {
  if (typeof link !== 'object' || link === null) return false
  const { label, url } = link as { label?: unknown; url?: unknown }
  if (typeof label === 'string' && SOUNDCLOUD_LABEL.test(label)) return false
  return urlIsPresence(url)
}

/** The release columns provenance depends on. */
export type ReleaseProvenance = {
  source: string | null
  spotify_id: string | null
  /** The DSP links jsonb array (`{ label, url }[]`). Any entry that is platform presence
   *  (releaseLinkIsPresence — so never a SoundCloud one) makes the release Released. */
  links: unknown
  /** The manual "this is released" flag — a hand-added album/EP with no links
   *  can still be public (its songs inherit this bucket). */
  released?: boolean | null
}

/** The track columns provenance depends on. */
export type TrackProvenance = {
  release_id: string | null
  source: string | null
  audio_path?: string | null
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
  provider_url: string | null
  stream_url: string | null
  /** Apple/iTunes store link from the union model — counts as platform presence. */
  apple_url: string | null
  /** SoundCloud link (no id column to rebuild from) — NOT platform presence (see
   *  trackOnPlatform); a badge and a link only. */
  soundcloud_url?: string | null
  /** Manager-entered Deezer link — a stored URL (the synced deezer_id is a separate id). */
  deezer_url?: string | null
  /** The manual "this song is released" toggle — a hand-added song with no links
   *  can still be public. Platform linkage implies released regardless. */
  released?: boolean | null
}

/**
 * A release is Released iff it has platform presence OR the manual released flag. A link
 * counts only when it is presence (releaseLinkIsPresence): until 2026-09-28 ANY link did,
 * so a record whose only link was SoundCloud's read Released while the same rule for a
 * song (trackOnPlatform) had already dropped SoundCloud. Now the two agree.
 */
export function releaseIsReleased(r: ReleaseProvenance): boolean {
  const onPlatform = Array.isArray(r.links) && r.links.some(releaseLinkIsPresence)
  return r.source !== 'manual' || r.spotify_id != null || onPlatform || r.released === true
}

/**
 * True iff a track counts as released on its OWN provenance: any platform linkage
 * (source or an external id/url) OR the manual released flag. Every column listed here
 * must also appear in the SQL mirror and in tests/music.test.ts's per-column table —
 * `deezer_url` was once missing from both and its check was provably dead code.
 *
 * SOUNDCLOUD IS NOT ON THIS LIST (Sam, 2026-09-10: "the point of the release tag is some
 * tracks are considered 'unreleased'. These are ones that often aren't on any services").
 * SoundCloud is where demos and live sets live, so a link there proves nothing about
 * release. A SoundCloud-only song is Released iff its `released` flag says so — the flag
 * a manager can set, and the only source besides a manual upload where the "Unreleased"
 * toggle is offered at all. `soundcloud_url` still counts as a PLATFORM for badges and
 * links (trackPlatforms); it just stops deciding the bucket. Mirrored in SQL by
 * 20260910120000.
 *
 * The link columns go through `urlIsPresence` (2026-09-28), so a SoundCloud URL sitting
 * in ANY of them (a paste into the Spotify row before that row checked its platform)
 * does not release the song either. The ids are ids, never SoundCloud's.
 */
export function trackOnPlatform(t: TrackProvenance): boolean {
  return (
    t.source !== 'manual' ||
    t.spotify_id != null ||
    t.apple_id != null ||
    t.deezer_id != null ||
    urlIsPresence(t.provider_url) ||
    urlIsPresence(t.stream_url) ||
    urlIsPresence(t.apple_url) ||
    urlIsPresence(t.deezer_url) ||
    t.released === true
  )
}

/**
 * A track is Released iff its OWN provenance says so OR its release is Released.
 * WIDEN-ONLY: membership can only ever promote a song. `inherited ?? own` would NARROW —
 * a platform-linked song inside an Unreleased album would be reported Unreleased — which
 * is precisely what 20260710160000 reverted in SQL, and what the agent's deleted copy
 * shipped anyway.
 */
export function trackIsReleased(t: TrackProvenance, releaseIsRel?: boolean): boolean {
  return trackOnPlatform(t) || releaseIsRel === true
}

/** A release is Unreleased iff it has NO platform presence AND wasn't manually
 *  marked released. */
export function releaseBucket(r: ReleaseProvenance): MusicBucket {
  return releaseIsReleased(r) ? 'released' : 'unreleased'
}

/**
 * Classify a track — WIDEN-ONLY (see trackIsReleased). Two consequences, both intended:
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
  return trackIsReleased(t, releaseReleased) ? 'released' : 'unreleased'
}
