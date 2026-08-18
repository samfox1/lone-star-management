/**
 * The app's Music module: the Released/Unreleased rule (RE-EXPORTED, never redefined)
 * plus the app-only derivations built on top of it — platform badges and project grouping.
 *
 * The rule itself lives in `@lone-star/music-rules`, a zero-dependency workspace package,
 * because lone-star-agent is a separately deployed Node service that cannot import
 * `../src/lib/music` without escaping its build root. It kept a hand-written twin instead,
 * and that twin ran a REVERTED narrowing rule in production for four weeks. Import the
 * package here rather than restating the rule: tests/music-mirror.test.ts asserts these
 * exports are the package's own function objects, so a re-copied rule fails immediately.
 *
 * This file stays the app's entry point — every call site imports `@/lib/music` — so the
 * extraction cost zero churn outside these two modules.
 */
export {
  releaseBucket,
  trackBucket,
  releaseIsReleased,
  trackIsReleased,
  trackOnPlatform,
  type MusicBucket,
  type ReleaseProvenance,
  type TrackProvenance,
} from '@lone-star/music-rules'

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
  /** The library position — the Music panel's drag order. Optional so older callers
   *  (and tests) that never number tracks keep the date sort below. */
  sort_order?: number | null
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
  type G = { key: string; releaseId: string | null; type: string; title: string | null; ids: string[]; anyOnSite: boolean; minSort: number }
  const groups = new Map<string, G>()
  for (const t of tracks) {
    // The parent release groups; a parent-less song is its own project. The two key
    // spaces (`release:` vs `track:`) are disjoint, so keys can never collide.
    const key = t.release_id ? `release:${t.release_id}` : `track:${t.id}`
    const g =
      groups.get(key) ??
      { key, releaseId: t.release_id ?? null, type: t.release_type ?? 'single', title: t.title ?? null, ids: [], anyOnSite: false, minSort: Number.MAX_SAFE_INTEGER }
    g.ids.push(t.id)
    g.minSort = Math.min(g.minSort, t.sort_order ?? 0)
    // A null on_site is OFF here. This is the OPPOSITE of every SQL door, which does
    // `coalesce(on_site, true)` — a published snapshot whose live row is gone must keep
    // serving there, whereas the panel must never claim a song is live when it has no
    // live row to read. `tracks.on_site` is NOT NULL, so the two can't diverge in
    // practice; the disagreement is pinned (tests/music.test.ts) so it stays deliberate.
    if (t.on_site ?? false) g.anyOnSite = true
    groups.set(key, g)
  }

  // MANUAL MODE, the tour-dates rule (2026-08-18): a drag in the editor's Music panel
  // renumbers every track, so DISTINCT project minimums mean the manager ordered them —
  // their order IS the order. A never-dragged catalog (synced rows all sort_order 0,
  // or one project) keeps the newest-first date sort below.
  const mins = [...groups.values()].map((g) => g.minSort)
  const manual = new Set(mins).size > 1
  const ordered = manual
    ? [...groups.values()].sort((a, b) => a.minSort - b.minSort)
    : [...groups.values()]
  return ordered
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
      if (manual) return 0 // dragged order already applied above; keep it stable
      // Newest first; a project with no date sorts last (a stable, if arbitrary, tail).
      if (!a.releaseDate && !b.releaseDate) return 0
      if (!a.releaseDate) return 1
      if (!b.releaseDate) return -1
      return b.releaseDate.localeCompare(a.releaseDate)
    })
}
