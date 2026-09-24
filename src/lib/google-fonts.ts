/**
 * Google Fonts: the catalogue the Brand page's font menu offers ("Google Fonts…",
 * BRAND_SYNC_PLAN.md, Sam 2026-09-24: "pick any Google family by name").
 *
 * The list is BUNDLED, not fetched: the Google Fonts Developer API needs a key we do not
 * have, so `scripts/build-google-fonts.ts` read Google's own catalogue once and checked it in
 * as `src/data/google-fonts.json` — `[family, category]`, most popular first. It is loaded
 * with a dynamic import (`loadGoogleFonts`), so ~60 KB of names reach a browser only when the
 * picker opens, never in the pages that merely import this module.
 *
 * The same list is the SERVER's allowlist: `addGoogleFont` (lib/fonts.ts) stores only a
 * family found here, in Google's own spelling, so the database never holds a name Google
 * would answer with an error.
 *
 * No other imports, on purpose: lib/fonts.ts imports the name rule from here, and the
 * script imports it too.
 */

/**
 * A Google family name as the database stores it (`artist_fonts.google_family`): words of
 * ASCII letters and digits, one space between. The migration's CHECK (20260925120000) and
 * the bridge's allowlist say the same; every family in Google's catalogue fits (1,946 on
 * 2026-09-25, the longest 32 characters). It goes into a css2 URL and a quoted CSS string,
 * and this shape leaves nothing to escape.
 */
export const GOOGLE_FAMILY_RE = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/
export const MAX_GOOGLE_FAMILY = 64

export function isGoogleFamilyName(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length <= MAX_GOOGLE_FAMILY && GOOGLE_FAMILY_RE.test(raw)
}

/** Google's categories, as one letter each in the bundled list. */
export const CATEGORY_CODE = {
  'Sans Serif': 's',
  Serif: 'e',
  Display: 'd',
  Handwriting: 'h',
  Monospace: 'm',
} as const
export type GoogleCategory = (typeof CATEGORY_CODE)[keyof typeof CATEGORY_CODE]

/** What the picker prints beside a family. Keyed by every code, so a new category is a
 *  compile error here until it has a word. */
export const CATEGORY_LABEL: Record<GoogleCategory, string> = {
  s: 'Sans serif',
  e: 'Serif',
  d: 'Display',
  h: 'Handwriting',
  m: 'Mono',
}

/** One family in the bundled list. */
export type GoogleFontRow = [family: string, category: GoogleCategory]

/** The bundled catalogue, most popular first. A dynamic import: see the top of the file. */
export async function loadGoogleFonts(): Promise<GoogleFontRow[]> {
  const mod = await import('@/data/google-fonts.json')
  return (mod.default ?? mod) as unknown as GoogleFontRow[]
}

/** A typed name as a comparison key: case and runs of spaces do not matter. */
const keyOf = (raw: string) => raw.replace(/\s+/g, ' ').trim().toLowerCase()

/** Google's own spelling of a family the list holds, or null. "archivo  black" finds
 *  "Archivo Black". */
export function findGoogleFamily(rows: readonly GoogleFontRow[], name: unknown): string | null {
  if (typeof name !== 'string') return null
  const want = keyOf(name)
  if (!want) return null
  return rows.find(([family]) => family.toLowerCase() === want)?.[0] ?? null
}

/**
 * The families matching what was typed, best first, at most `limit`:
 *   1. the name itself,
 *   2. names STARTING with it,
 *   3. names with a WORD starting with it ("sans" finds "Noto Sans"),
 *   4. names containing it anywhere.
 * Within each group the list's own order stands — most popular first. An empty query is
 * simply the most popular families.
 */
export function searchGoogleFonts(rows: readonly GoogleFontRow[], query: string, limit = 60): GoogleFontRow[] {
  const q = keyOf(query)
  if (!q) return rows.slice(0, limit)
  const groups: GoogleFontRow[][] = [[], [], [], []]
  for (const row of rows) {
    const name = row[0].toLowerCase()
    const rank = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(` ${q}`) ? 2 : name.includes(q) ? 3 : -1
    if (rank >= 0) groups[rank].push(row)
  }
  return groups.flat().slice(0, limit)
}

/**
 * The css2 stylesheet that lets the PICKER show each listed family in its own face — the
 * regular weight only (a site's stylesheet asks for all nine; a preview needs one), with
 * `display=swap` so a row shows its name at once and swaps when the face lands. Declaring a
 * face downloads nothing: a font file is fetched only for text that uses it, so a listed
 * family costs one small file, for the rows on screen. Names failing the shape are left
 * out rather than escaped. Null when none is left.
 */
export function googlePreviewHref(families: readonly string[]): string | null {
  const names = [...new Set(families.filter(isGoogleFamilyName))]
  if (!names.length) return null
  return `https://fonts.googleapis.com/css2?${names.map((n) => `family=${n.replace(/ /g, '+')}`).join('&')}&display=swap`
}
