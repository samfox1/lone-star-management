/**
 * Generate `packages/site-bridge/tokens.css` — the editor's CLASS vocabulary as
 * `@source inline()` directives a site imports into its Tailwind build.
 *
 * WHY THIS EXISTS (SITE_BRIDGE_PLAN.md, the third mirror): Tailwind compiles only the
 * classes it can see in source, and a class the editor applies at runtime never appears
 * in a site's own markup — so every site had to hand-maintain a safelist of everything
 * the editor might emit. skeen's globals.css carried ~40 hand-synced lines with a
 * "keep this list in sync" comment, and it had already drifted: the weight slider
 * offers nine weights, skeen compiled six, and the three light ones silently no-opped.
 *
 * HOW IT DERIVES THE LIST — nothing here is hand-written (post-deepening, the tables
 * live in the package's vocabulary module; the editor's controls BUILD from them):
 *   1. Ask the editor's own control builders for every option/step/toggle they emit
 *      (with no site styleOptions, so site-declared fonts/colours — the SITE's own
 *      vocabulary, its own safelisting duty — are excluded).
 *   2. Filter each token through the package's OWN resolveStyle: a token that lifts to
 *      inline style (colours, scale, opacity, px borders/corners, shadows, speed)
 *      needs no CSS and is dropped; a token that stays a class must compile.
 *   3. Add the legacy named sizes (text-xs..text-9xl). fluidizeSizes translates them
 *      at resolve time so they should never reach a DOM class list anymore — they stay
 *      as a belt against any path that skips resolution, at zero real cost.
 *
 * Run: `npm run tokens` (tsx). tests/site-bridge-tokens.test.ts regenerates in memory
 * and diffs the committed file, so a vocabulary change that forgets to regenerate is a
 * red build, not a manager staring at a slider that does nothing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// The derivation lives IN the package now (vocabulary.ts, the 2026-08-07 deepening):
// the tables that generate an append-only-forever artifact belong beside it, versioned
// with it. This script is the CLI shell — @source wrapping, the baseline ratchet, file
// writes — around the package's own classVocabulary().
import { classVocabulary as packageVocabulary } from '@samfox1/site-bridge/vocabulary'
import { LEGACY_TO_FLUID } from '@samfox1/site-bridge/styles'

/** The compilable class set: the package's derivation plus the legacy-size belt. */
export function classVocabulary(): string[] {
  return packageVocabulary(Object.keys(LEGACY_TO_FLUID))
}

/** The generated stylesheet, deterministic for the sync test. */
export function buildTokensCss(): string {
  const vocab = classVocabulary()
  for (const t of vocab) {
    // @source inline() treats {} as brace expansion and the value is double-quoted —
    // a token containing either would emit a malformed or silently-expanding line.
    if (/["{}]/.test(t)) throw new Error(`token not representable in @source inline(): ${t}`)
  }
  const lines = vocab.map((t) => `@source inline("${t}");`)
  return `/*
 * GENERATED — do not edit. \`npm run tokens\` in the lone-star repo rebuilds this from
 * the editor's own control definitions (scripts/generate-bridge-tokens.ts explains how).
 *
 * WHAT THIS IS: every class the lone-star editor can apply to a region at runtime, as
 * \`@source inline()\` directives. A site imports this file in its main CSS —
 *   @import "@samfox1/site-bridge/tokens.css";
 * — so Tailwind v4 compiles the whole editor vocabulary. Without it, an applied class
 * has no CSS behind it and silently no-ops (the drift bug of 2026-08-05, three times).
 *
 * NOT INCLUDED, deliberately: the site's OWN fonts and colours (declared via
 * styleOptions — the site's markup or safelist already compiles them) and every token
 * the bridge lifts to inline style (arbitrary colours, scale, opacity, px borders,
 * corners, shadows, playback speed), which need no CSS at all.
 *
 * APPEND-ONLY, FOREVER (SITE_BRIDGE_PLAN.md P5): stored styles reference these tokens
 * at runtime, but sites compile CSS at build time. Removing a line orphans every stored
 * style using it, on every site, at that site's next build. A control may leave the
 * editor; its token never leaves this file.
 */
${lines.join('\n')}
`
}

/** Repo root, from THIS file's location — `process.cwd()` writes to the wrong place
 *  when tsx is invoked from a subdirectory. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE_PATH = join(ROOT, 'tests/fixtures/bridge-token-baseline.json')

/**
 * The ratchet baseline: every token EVER shipped, as a committed union. The union is
 * the load-bearing detail — rebuilt from the current vocabulary alone, a regeneration
 * would launder a removal straight into the baseline and the append-only test could
 * never fire. As written, removing a token leaves it in the baseline and the test goes
 * red; only a hand edit (a deliberate, reviewable act) can silence it.
 */
export function unionedBaseline(): string[] {
  const prior: string[] = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : []
  return [...new Set([...prior, ...classVocabulary()])].sort()
}

// CLI entry: regenerate the committed file AND grow (never shrink) the baseline.
const isMain = process.argv[1]?.endsWith('generate-bridge-tokens.ts')
if (isMain) {
  const dest = join(ROOT, 'packages/site-bridge/tokens.css')
  writeFileSync(dest, buildTokensCss())
  writeFileSync(BASELINE_PATH, JSON.stringify(unionedBaseline(), null, 2) + '\n')
  console.log(`wrote ${dest} (${classVocabulary().length} tokens; baseline ${unionedBaseline().length})`)
}
