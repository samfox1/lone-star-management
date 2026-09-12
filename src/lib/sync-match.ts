/**
 * THE CATALOG MERGE DECISION, on its own and free of the database.
 *
 * `syncTracks` (lib/sync) writes rows; these are the judgements it makes BEFORE writing —
 * is this incoming song one we already have, and on what evidence. They live here so they
 * can be mutation-tested: lib/sync also holds the provider adapters, which are only
 * exercised against the hosted project, and a module tested that way reports false
 * survivors and teaches everyone to ignore the report (AGENTS.md).
 */

/** The shape the match reads off an existing row: an id to claim it by, a title to key
 *  on, a length to weigh, and whatever platform-id columns the caller names. */
export type MatchRow = { id: string; title: string; duration_ms: number | null } & Record<string, unknown>

/** The shape it reads off an incoming song. */
export type MatchItem = { title: string; duration_ms: number | null }

/** Songs within ±3s of each other (same normalized title) are treated as the same. */
export const DURATION_TOLERANCE_MS = 3000

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
    let best: Row | undefined
    let bestDelta = Infinity
    for (const r of open) {
      if (r.duration_ms == null) continue
      const d = Math.abs(r.duration_ms - item.duration_ms)
      if (d <= DURATION_TOLERANCE_MS && d < bestDelta) {
        best = r
        bestDelta = d
      }
    }
    if (best) return { kind: 'match', row: best, byTitleOnly: false }
  }

  if (open.length === 1 && (open[0].duration_ms == null || item.duration_ms == null)) {
    return { kind: 'match', row: open[0], byTitleOnly: true }
  }
  return { kind: 'none', sawCandidate: true }
}
