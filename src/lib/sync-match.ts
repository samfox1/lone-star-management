/**
 * THE CATALOG MERGE DECISION, on its own and free of the database.
 *
 * `syncTracks` / `syncReleases` (lib/sync) write rows; these are the judgements they make
 * BEFORE writing — is this incoming song (or release) one we already have, and on what
 * evidence; what type of release is it; which songs belong to which release. They live
 * here so they can be mutation-tested: lib/sync also holds the provider adapters, which
 * are only exercised against the hosted project, and a module tested that way reports
 * false survivors and teaches everyone to ignore the report (AGENTS.md).
 */
import type { ReleaseType } from '@/lib/releases'

/** The shape the match reads off an existing row: an id to claim it by, a title to key
 *  on, a length to weigh, and whatever platform-id columns the caller names. */
export type MatchRow = { id: string; title: string; duration_ms: number | null } & Record<string, unknown>

/** The shape it reads off an incoming song. `album_name` only ever breaks a tie (see
 *  matchTrackCandidate); a row or song without one is judged exactly as before. */
export type MatchItem = { title: string; duration_ms: number | null; album_name?: string | null }

/** Songs within ±3s of each other (same normalized title) are treated as the same. */
const DURATION_TOLERANCE_MS = 3000

/**
 * Parenthetical qualifiers that name a DIFFERENT recording of the same composition.
 * They are part of a song's identity: "Rain (Live)" is not "Rain", and the app already
 * models `remix` as its own release_type. Folding them into the base title made an
 * alternate take get absorbed into the studio row on import — the take was never
 * inserted, so it simply vanished from the catalog.
 *
 * Deliberately narrow. A qualifier NOT listed here ("(feat. X)", "[Explicit]",
 * "(Deluxe)") is still dropped, because those name the same recording.
 */
const VERSION_MARKER = /\b(?:live|acoustic|unplugged|remix(?:ed|es)?|demo|edit|instrumental|radio|extended|reprise)\b/g

/**
 * Normalize a title for cross-platform matching: lowercase, drop apostrophes, drop
 * non-version qualifiers and punctuation, collapse whitespace — so "Don't Look Back"
 * and "Dont look  back" match. Any version marker found inside a qualifier is
 * appended as a sorted, deduped suffix, so marked takes key apart from the base title
 * and from each other while still matching their own counterpart on another platform.
 * Scoped per-artist.
 */
export function normalizeTitle(t: string): string {
  const markers = new Set<string>()
  const base = t
    .toLowerCase()
    .replace(/[’ʼ']/g, '')
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_m, paren?: string, bracket?: string) => {
      for (const found of (paren ?? bracket ?? '').match(VERSION_MARKER) ?? []) markers.add(found)
      return ' '
    })
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  if (markers.size === 0) return base
  return `${base} ~${[...markers].sort().join('+')}`
}

/**
 * An album name for the tie-break: casing, apostrophes and punctuation folded, but EVERY
 * word kept. Unlike a song title, an album's qualifier is identity — "(Deluxe Edition)"
 * is a different release from the standard one, and normalizeTitle would drop it and let
 * their copies of each song cross.
 */
function albumKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’ʼ']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** What the match decided, and whether it is worth telling the manager about. */
export type TrackMatch<Row extends MatchRow> =
  | { kind: 'match'; row: Row; byTitleOnly: boolean }
  | { kind: 'none'; sawCandidate: boolean }

/**
 * Pick an existing row that is the SAME song as `item` but not yet on this platform.
 * Rows already claimed this run, or already carrying this platform's id, are out of the
 * running — the title bucket is the starting point, never the answer on its own.
 *
 * TWO TIERS, because the evidence comes in two strengths:
 *
 *  1. Both sides know the length → the closest within tolerance wins. Strong evidence,
 *     and it discriminates between several rows sharing a title (an album track and its
 *     single, two takes).
 *  2. Neither side can offer a length → merge only when the title leaves EXACTLY ONE
 *     candidate. This is the case Sam described (2026-09-12): a song added by hand,
 *     with no duration, whose Apple/Spotify link arrives on a later pull; refusing it
 *     left a twin the manager had to merge by hand every time. With more than one
 *     candidate there is nothing to choose between them, so it still refuses.
 *
 * Disagreeing durations are EVIDENCE, not missing evidence: tier 2 must not rescue them,
 * which is why it only applies when a duration is absent.
 *
 * THE ALBUM BREAKS A TIE INSIDE TIER 1 (2026-09-28). One row per release means a song out
 * as a single AND on its album is two rows with the same title and the same length, and
 * the other platform's pull brings two copies of its own. Length cannot pair them, so the
 * first row created took whichever copy came first — crossing them, and (once releases are
 * grouped from their songs) dragging the single into the album's release. Within the
 * tolerance, a row on the same album as the incoming song wins (albumKey: qualifiers kept,
 * so a deluxe edition is not the standard one); the length
 * still decides among rows that share (or all lack) that album. It never reaches outside
 * the tolerance: a different length is a different recording, whatever the album says.
 *
 * The caller reports both a tier-2 merge and a refusal-with-candidates by name
 * (SyncNote), because the asymmetry that once justified refusing outright — a wrong
 * merge is silent while a duplicate is visible — was the SILENCE.
 */
export function matchTrackCandidate<Row extends MatchRow>(
  cands: Row[] | undefined,
  item: MatchItem,
  idCol: string,
  claimed: Set<string>,
): TrackMatch<Row> {
  const sawCandidate = (cands?.length ?? 0) > 0
  const open = (cands ?? []).filter((r) => !claimed.has(r.id) && r[idCol] == null)
  if (open.length === 0) return { kind: 'none', sawCandidate }

  if (item.duration_ms != null) {
    const album = item.album_name ? albumKey(item.album_name) : null
    const sameAlbum = (r: Row) => album != null && typeof r.album_name === 'string' && albumKey(r.album_name) === album
    let best: Row | undefined
    let bestDelta = Infinity
    let bestSame = false
    for (const r of open) {
      if (r.duration_ms == null) continue
      const d = Math.abs(r.duration_ms - item.duration_ms)
      if (d > DURATION_TOLERANCE_MS) continue
      const same = sameAlbum(r)
      if ((same && !bestSame) || (same === bestSame && d < bestDelta)) {
        best = r
        bestDelta = d
        bestSame = same
      }
    }
    if (best) return { kind: 'match', row: best, byTitleOnly: false }
  }

  if (open.length === 1 && (open[0].duration_ms == null || item.duration_ms == null)) {
    return { kind: 'match', row: open[0], byTitleOnly: true }
  }
  return { kind: 'none', sawCandidate: true }
}

// ── Releases ───────────────────────────────────────────────────────────────────────
// Sam, 2026-09-28: songs pulled from Apple Music or Deezer get grouped into albums, EPs
// and singles the way Spotify's always were. Three platforms creating releases means the
// type law and the grouping have to be ONE implementation each, not three that drift.

/**
 * What a platform says about a release, before our type law reads it.
 *
 *  'album' / 'ep' / 'single'  the platform named it explicitly — Deezer's `record_type`,
 *                             Apple's store suffix ("… - Single", "… - EP", none = album),
 *                             Spotify's `album_type: 'album'`. Trusted as given.
 *  'single-or-ep'             the platform cannot tell the two apart: Spotify has no EP
 *                             group, so its `album_type: 'single'` covers both.
 *
 * Compilations and appearances on someone else's record are not a kind: they are not the
 * artist's release at all, and each client leaves them out (Spotify's pull only ever asks
 * for the `album,single` groups; Apple and Deezer mirror that).
 */
export type PlatformReleaseKind = 'album' | 'ep' | 'single' | 'single-or-ep'

/** A 'single-or-ep' release with this many tracks or more is an EP (Spotify's rule). */
export const EP_MIN_TRACKS = 4

/**
 * THE RELEASE-TYPE LAW. An explicit type is taken as the platform gives it; only where the
 * platform cannot tell a single from an EP does the track count decide — the rule Spotify's
 * pull has always used. An unknown count reads as one track: a single, never an EP nobody
 * said it was.
 */
export function classifyRelease(kind: PlatformReleaseKind, trackCount: number | null): ReleaseType {
  if (kind === 'single-or-ep') return (trackCount ?? 1) >= EP_MIN_TRACKS ? 'ep' : 'single'
  return kind
}

/** The release one incoming song came from, as its platform reports it. Every song of one
 *  release carries the same ref (the same `id`), except its date — see groupReleases. */
export type CatalogReleaseRef = {
  /** The platform's own id for the release (album id / collection id). */
  id: string
  title: string
  release_type: ReleaseType
  cover_url: string | null
  /** YYYY-MM-DD, or null when the platform does not say. */
  release_date: string | null
  /** The release's page on the platform — seeds the one DSP link a NEW release gets. */
  url: string | null
}

/** One release as the release sync consumes it: the ref, plus its member songs. */
export type CatalogRelease = Omit<CatalogReleaseRef, 'id'> & {
  externalId: string
  /** Member songs, by the platform's own track id, in the platform's order. */
  trackIds: string[]
}

/**
 * Fold a flat song list back into the releases the songs came from, keyed by the
 * platform's release id, in first-seen order.
 *
 * THE DATE IS THE LATEST SONG'S. Apple dates each song, and an album's songs that went out
 * ahead as singles keep their own earlier dates (Skeen's "Heatwaves & Horizons": 03-21,
 * 04-18, 04-25, then everything else 05-09). The album dropped on the last of them.
 */
export function groupReleases(songs: { trackId: string; release?: CatalogReleaseRef | null }[]): CatalogRelease[] {
  const byId = new Map<string, CatalogRelease>()
  for (const { trackId, release } of songs) {
    if (!release) continue
    let rel = byId.get(release.id)
    if (!rel) {
      const { id, ...meta } = release
      rel = { ...meta, externalId: id, trackIds: [] }
      byId.set(id, rel)
    }
    if (!rel.trackIds.includes(trackId)) rel.trackIds.push(trackId)
    if (release.release_date != null && (rel.release_date == null || release.release_date > rel.release_date)) {
      rel.release_date = release.release_date
    }
  }
  return [...byId.values()]
}
