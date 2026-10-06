/**
 * The artist FACT columns a manager may set from the Site tab (SEO_GEO_PLAN B6), and the
 * one rule for each. Pure, so the allowlist is a tested boundary rather than a parameter
 * type: a server action's TS signature is not a runtime guard.
 */
import { factText } from '@samfox1/site-bridge/seo'
import { cityError, factTextError } from '@/lib/seo-facts'

export const ARTIST_FACT_COLUMNS = ['genre', 'location', 'schema_type'] as const
export type ArtistFactColumn = (typeof ARTIST_FACT_COLUMNS)[number]
export const SCHEMA_TYPES = ['MusicGroup', 'Person'] as const

/** The genre column's cap, on the genres as stored: joined by ", ", spaces folded. */
export const GENRE_MAX = 120

/** Spaces folded and trimmed: the genre as it is stored. */
const foldSpaces = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * THE GENRE'S RULE, one copy for Profile's genre list (refused before it is sent) and the save
 * below: the fact text rule (no markup, no control characters), then the cap. The server once
 * checked only the cap, so a `<` that Profile refused was still stored by a direct call.
 */
export function genreError(raw: string): string | null {
  return factTextError(raw) ?? (foldSpaces(raw).length > GENRE_MAX ? `Keep it under ${GENRE_MAX} characters.` : null)
}

export function artistFactUpdate(
  column: string,
  value: string,
): { error: string } | { column: ArtistFactColumn; value: string | null } {
  if (!(ARTIST_FACT_COLUMNS as readonly string[]).includes(column)) return { error: 'Unknown field.' }
  // The CITY ("Based in") is one of the place facts (lib/seo-facts.ts cityError): the same text
  // rule as its region and country — no markup, no control characters, hidden marks stripped.
  if (column === 'location') {
    const bad = cityError(value)
    if (bad) return { error: bad }
    return { column, value: factText(value) || null }
  }
  if (column === 'schema_type') {
    const type = foldSpaces(value)
    if (!(SCHEMA_TYPES as readonly string[]).includes(type)) return { error: 'Unknown artist type.' }
    return { column, value: type }
  }
  const bad = genreError(value)
  if (bad) return { error: bad }
  return { column: 'genre', value: foldSpaces(value) || null }
}
