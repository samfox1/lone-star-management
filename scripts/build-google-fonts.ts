/**
 * Builds src/data/google-fonts.json — the Google Fonts families the Brand page's font menu
 * offers ("Google Fonts…", BRAND_SYNC_PLAN.md). Run ONCE and commit the output; re-run to
 * pick up new families.
 *
 *   npx tsx scripts/build-google-fonts.ts [path-to-metadata.json]
 *
 * With no path it downloads https://fonts.google.com/metadata/fonts — the catalogue
 * fonts.google.com itself reads. The Google Fonts Developer API needs a key we do not have;
 * this endpoint does not. Output rows: [family, category letter], MOST POPULAR FIRST (Google's
 * own `popularity` rank), so an empty search shows the families people actually use.
 *
 * Every family must match the shape the database stores (lib/google-fonts.ts GOOGLE_FAMILY_RE, the
 * CHECK in 20260925120000): the script FAILS rather than dropping one silently, because a
 * family the list offers and the database refuses is a picker that errors on click.
 *
 * A family with no UPRIGHT style (Molle: italic only) is left out, and named in the output:
 * css2 never serves it for the upright request sites and the picker make (hasUprightStyle).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { CATEGORY_CODE, GOOGLE_FAMILY_RE, MAX_GOOGLE_FAMILY, hasUprightStyle, type GoogleFontRow } from '../src/lib/google-fonts'

const SOURCE = 'https://fonts.google.com/metadata/fonts'
const OUT = 'src/data/google-fonts.json'

type Family = { family: string; category: string; popularity: number; fonts?: Record<string, unknown> }

async function main() {
  const path = process.argv[2]
  const text = path ? readFileSync(path, 'utf8') : await (await fetch(SOURCE)).text()
  // The endpoint has served a `)]}'` XSSI guard line before the JSON; strip it if present.
  const json = JSON.parse(text.replace(/^\)\]\}'\s*/, '')) as { familyMetadataList: Family[] }
  const families = json.familyMetadataList
  if (!Array.isArray(families) || families.length < 1000) throw new Error(`expected the full catalogue, got ${families?.length}`)

  const bad = families.filter((f) => !GOOGLE_FAMILY_RE.test(f.family) || f.family.length > MAX_GOOGLE_FAMILY)
  if (bad.length) throw new Error(`families the database would refuse: ${bad.map((f) => f.family).join(', ')}`)
  const unknown = [...new Set(families.map((f) => f.category))].filter((c) => !(c in CATEGORY_CODE))
  if (unknown.length) throw new Error(`categories with no code in lib/google-fonts.ts: ${unknown.join(', ')}`)

  const italicOnly = families.filter((f) => !hasUprightStyle(f.fonts))
  const upright = families.filter((f) => hasUprightStyle(f.fonts))
  // Checked again AFTER the filter: metadata that stopped carrying `fonts` would drop
  // everything, and that must fail, not write an empty picker.
  if (upright.length < 1000) throw new Error(`only ${upright.length} families have an upright style — has the metadata changed?`)

  const rows: GoogleFontRow[] = upright
    .sort((a, b) => a.popularity - b.popularity || a.family.localeCompare(b.family))
    .map((f) => [f.family, CATEGORY_CODE[f.category as keyof typeof CATEGORY_CODE]])
  writeFileSync(OUT, JSON.stringify(rows) + '\n')
  console.log(`google fonts: ${rows.length} families → ${OUT}`)
  if (italicOnly.length) console.log(`left out, no upright style: ${italicOnly.map((f) => f.family).join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
