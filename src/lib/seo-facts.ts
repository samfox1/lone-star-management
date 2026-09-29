/**
 * The artist's FACTS beyond genre and city: region, country, other names ("Also known as")
 * and the year they started ("Active since"). AI_VISIBILITY_AUDIT.md §2 item 7 / code pass
 * F13: "Portland" alone is ambiguous, and a crowded name needs more to be told apart.
 *
 * WHERE EACH ONE LIVES (no migration):
 *   city         `artists.location`, the "Based in" column it always was (saveArtistFactAction,
 *                lib/artist-facts.ts). It publishes with the profile.
 *   the rest     `site_content` rows under the bridge's FACT_CONTENT_KEYS (`fact_region`,
 *                `fact_country`, `fact_aliases`, `fact_active_since`), written ONLY through
 *                saveSeoField (lib/site-editor/save.ts). They publish with the site text.
 *   The SEO page's Publish (`publishSite`) ships the profile and the site text as one moment,
 *   so the city and its region/country go live together.
 *
 * Pure. Two halves:
 *   • the WRITE rules (`cleanFactValue`): what the save gate stores, or why it refuses;
 *   • the READ (`readFacts`, `factErrors`): what the page shows. It is the BRIDGE's reading
 *     (`siteFacts`, `artistPlace`), not a copy of it, so the page describes exactly what
 *     the site's fact card states — tests/unit/manager-tools/seo/seo-facts.test.ts checks
 *     that against `jsonLdGraph` itself.
 */
import {
  EARLIEST_ACTIVE_YEAR,
  FACT_CONTENT_KEYS,
  MAX_ALIASES,
  MAX_ALIAS_LENGTH,
  MAX_PLACE_PART_LENGTH,
  artistPlace,
  countryOf,
  factText,
  siteFacts,
  type SiteFacts,
} from '@samfox1/site-bridge/seo'

export type FactField = keyof typeof FACT_CONTENT_KEYS
export type FactKey = (typeof FACT_CONTENT_KEYS)[FactField]

/** The site_content keys, derived from the bridge's registry (never hand-listed). */
export const FACT_KEYS: readonly FactKey[] = Object.values(FACT_CONTENT_KEYS)

export function isFactKey(key: string): key is FactKey {
  return (FACT_KEYS as readonly string[]).includes(key)
}

/** The city's cap: the one `artistFactUpdate` has always applied to `location`. */
export const CITY_MAX_LENGTH = 120

const HIDDEN = 'That has hidden characters in it. Type it again.'
const MARKUP = 'Leave out < and >.'

/**
 * Why raw text can never be a fact, or null. Markup is refused (no fact needs `<` or `>`,
 * and a value that could close a tag is not stored even though every sink escapes it), and
 * so are control characters and lone surrogate halves, which nobody types on purpose and a
 * manager cannot see. Tab and newline are only whitespace (the cleaner folds them).
 *
 * Invisible direction marks and zero-width spaces are NOT refused: the cleaner strips them
 * (`factText`), because a manager who pasted one cannot see it to remove it.
 */
export function factTextError(raw: string): string | null {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(raw)) return HIDDEN
  if (/[\uD800-\uDFFF]/u.test(raw)) return HIDDEN
  if (/[<>]/.test(raw)) return MARKUP
  return null
}

/**
 * "This year" for the Active since cap: the year at UTC+14, the first time zone to reach a
 * new year. A manager whose new year has begun is not refused it; the cost is that for a
 * few hours on Dec 31 a manager elsewhere could enter next year.
 */
export function thisYearAt(now: Date): number {
  return new Date(now.getTime() + 14 * 3_600_000).getUTCFullYear()
}

const chars = (s: string) => Array.from(s).length
const sameName = (s: string) => factText(s).toLowerCase()

export type FactContext = {
  /** The artist's CURRENT name: an alias may not repeat it. */
  artistName: string
  /** From `thisYearAt`. */
  thisYear: number
}

/** The alias list as it is stored: one name per line. */
export function joinAliases(list: readonly string[]): string {
  return list.map(factText).filter(Boolean).join('\n')
}

/**
 * What the save gate stores for a fact key, or why it refuses. A blank value is
 * `{ value: '' }`, which the gate turns into a delete (= not stated).
 *
 *  region       one line of plain text, at most MAX_PLACE_PART_LENGTH characters.
 *  country      the same; a country the bridge's table knows is stored in the table's
 *               spelling ("usa" → "United States"), anything else as typed.
 *  aliases      one name per line: each one line of plain text, at most MAX_ALIAS_LENGTH
 *               characters; at most MAX_ALIASES; no repeats and never the artist's name
 *               (ignoring case). Blank lines are dropped.
 *  activeSince  a four-digit year from EARLIEST_ACTIVE_YEAR to `ctx.thisYear`.
 *
 * Never cuts: a value over a cap is refused with the cap in the message.
 */
export function cleanFactValue(key: FactKey, raw: string, ctx: FactContext): { value: string } | { error: string } {
  if (key === FACT_CONTENT_KEYS.aliases) return cleanAliases(raw, ctx.artistName)
  const bad = factTextError(raw)
  if (bad) return { error: bad }
  const v = factText(raw)
  if (!v) return { value: '' }
  if (key === FACT_CONTENT_KEYS.activeSince) {
    if (!/^\d{4}$/.test(v)) return { error: 'Use a four-digit year, like 2014.' }
    const year = Number(v)
    if (year < EARLIEST_ACTIVE_YEAR || year > ctx.thisYear) return { error: `Use a year from ${EARLIEST_ACTIVE_YEAR} to ${ctx.thisYear}.` }
    return { value: v }
  }
  if (chars(v) > MAX_PLACE_PART_LENGTH) return { error: `Keep it under ${MAX_PLACE_PART_LENGTH} characters.` }
  if (key === FACT_CONTENT_KEYS.country) return { value: countryOf(v)?.name ?? v }
  return { value: v }
}

function cleanAliases(raw: string, artistName: string): { value: string } | { error: string } {
  const lines = raw.split(/\r\n?|\n/)
  for (const line of lines) {
    const bad = factTextError(line)
    if (bad) return { error: bad }
  }
  const names = lines.map(factText).filter(Boolean)
  if (names.length > MAX_ALIASES) return { error: `Up to ${MAX_ALIASES} names.` }
  const own = sameName(artistName)
  const seen = new Set<string>()
  for (const n of names) {
    if (chars(n) > MAX_ALIAS_LENGTH) return { error: `Keep each name under ${MAX_ALIAS_LENGTH} characters.` }
    const key = sameName(n)
    if (own && key === own) return { error: `"${n}" is the artist's name already.` }
    if (seen.has(key)) return { error: `"${n}" is listed twice.` }
    seen.add(key)
  }
  return { value: names.join('\n') }
}

/* ----------------------------------------------------------------------------------
 * The page's reading
 * -------------------------------------------------------------------------------- */

export type FactsArtist = { name: string | null; location: string | null; schema_type?: string | null }
export type FactsContent = Readonly<Record<string, string | null | undefined>>

export type FactsView = SiteFacts & {
  /** The place the fact card states ("Chicago, Illinois, United States"), '' for none. */
  place: string
  /** Whether the card states the year. False for a Person: schema.org has no start date
   *  for a person (`foundingDate` is Organization-only), so the year is kept, not stated. */
  activeSinceStated: boolean
}

/** The facts as the SEO page shows them: exactly what the site's fact card reads from the
 *  same values (see the module note). */
export function readFacts(content: FactsContent, artist: FactsArtist): FactsView {
  const src = { artist: { name: artist.name, location: artist.location }, site_content: content }
  const facts = siteFacts(src)
  const place = artistPlace(src)
  return {
    ...facts,
    place: typeof place?.name === 'string' ? place.name : '',
    activeSinceStated: facts.activeSince !== null && artist.schema_type !== 'Person',
  }
}

/**
 * What is STORED that the gate would refuse today, by field: a value written before a
 * rule existed, by a script, or an alias that became the name after a rename. Each one is
 * either dropped from the fact card already (the bridge re-applies the rules) or, for the
 * city, still stated as typed. Empty object = nothing to fix.
 */
export function factErrors(content: FactsContent, artist: FactsArtist, thisYear: number): Partial<Record<'city' | FactField, string>> {
  const out: Partial<Record<'city' | FactField, string>> = {}
  const city = artist.location ?? ''
  const cityBad = factTextError(city) ?? (chars(factText(city)) > CITY_MAX_LENGTH ? `Keep it under ${CITY_MAX_LENGTH} characters.` : null)
  if (cityBad) out.city = cityBad
  const ctx = { artistName: artist.name ?? '', thisYear }
  for (const field of Object.keys(FACT_CONTENT_KEYS) as FactField[]) {
    const raw = content[FACT_CONTENT_KEYS[field]]
    if (typeof raw !== 'string' || !raw.trim()) continue
    const r = cleanFactValue(FACT_CONTENT_KEYS[field], raw, ctx)
    if ('error' in r) out[field] = r.error
  }
  return out
}
