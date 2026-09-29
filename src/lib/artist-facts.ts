/**
 * The artist FACT columns a manager may set from the Site tab (SEO_GEO_PLAN B6), and the
 * one rule for each. Pure, so the allowlist is a tested boundary rather than a parameter
 * type: a server action's TS signature is not a runtime guard.
 */
import { factText } from '@samfox1/site-bridge/seo'
import { CITY_MAX_LENGTH, factTextError } from '@/lib/seo-facts'

export const ARTIST_FACT_COLUMNS = ['genre', 'location', 'schema_type'] as const
export type ArtistFactColumn = (typeof ARTIST_FACT_COLUMNS)[number]
export const SCHEMA_TYPES = ['MusicGroup', 'Person'] as const

export function artistFactUpdate(
  column: string,
  value: string,
): { error: string } | { column: ArtistFactColumn; value: string | null } {
  if (!(ARTIST_FACT_COLUMNS as readonly string[]).includes(column)) return { error: 'Unknown field.' }
  // The CITY ("Based in") is one of the place facts (lib/seo-facts.ts): the same text rule
  // as its region and country — no markup, no control characters, hidden marks stripped.
  if (column === 'location') {
    const bad = factTextError(value)
    if (bad) return { error: bad }
    const city = factText(value)
    if (Array.from(city).length > CITY_MAX_LENGTH) return { error: `Keep it under ${CITY_MAX_LENGTH} characters.` }
    return { column, value: city || null }
  }
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (column === 'schema_type') {
    if (!(SCHEMA_TYPES as readonly string[]).includes(trimmed)) return { error: 'Unknown artist type.' }
    return { column, value: trimmed }
  }
  if (trimmed.length > 120) return { error: 'Keep it under 120 characters.' }
  return { column: column as ArtistFactColumn, value: trimmed || null }
}
