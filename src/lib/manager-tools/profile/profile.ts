import { COUNTRIES } from '@samfox1/site-bridge/seo'
import type { BioRow } from '../seo/profiles/bio-state'
import { plural } from '../format'

/**
 * THE PROFILE TOOL'S PURE PARTS (PROFILE_TOOL_PLAN.md, 2026-10-02). Moved out of the SEO / GEO
 * Facts tab (tools/seo/facts/facts-tab.tsx) and Settings › General when both moved here. No DB,
 * no React: the page reads, these decide, the view renders.
 */

/** Musician = MusicGroup, Visual artist = Person: the app's one wording (site-tools.tsx). */
export const SCHEMA_TYPES = [
  { value: 'MusicGroup', label: 'Musician' },
  { value: 'Person', label: 'Visual artist' },
] as const
export type SchemaType = (typeof SCHEMA_TYPES)[number]['value']

/** The countries a manager picks from: exactly the bridge's table (the save gate accepts only
 *  those), A to Z, with "—" to clear. */
export const COUNTRY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: '—' },
  ...[...COUNTRIES].map((c) => ({ value: c.name, label: c.name })).sort((a, b) => a.label.localeCompare(b.label, 'en')),
]

/** The genre column's cap, from the save's own rule (lib/artist-facts.ts `genreError`). */
export { GENRE_MAX } from '@/lib/artist-facts'

/** The name's cap (artists.name), as the name action enforces it. */
export const ARTIST_NAME_MAX = 200

/**
 * The name's rule, one copy for the row (refused before it is sent) and the action (refused
 * again on the server): something, and not too long. Was Settings' `saveArtistNameAction` body.
 */
export function artistNameError(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'Give the artist a name.'
  if (trimmed.length > ARTIST_NAME_MAX) return `That name is too long (${ARTIST_NAME_MAX} characters at most).`
  return null
}

/**
 * THE NUDGE under the Bio row (PROFILE_TOOL_PLAN.md): after a Publish changed the name, bio, city
 * or genre, how many of the artist's outside bios may now be out of date ("stale" in
 * bio-state.ts, the same rows SEO / GEO › Profiles lists). '' when none, or when they couldn't be
 * read: the row then says nothing rather than something false.
 */
export function outsideBiosNudge(rows: readonly BioRow[] | null): string {
  const n = (rows ?? []).filter((r) => r.state === 'stale').length
  return n ? `${plural(n, 'outside bio', 'outside bios')} may be out of date` : ''
}
