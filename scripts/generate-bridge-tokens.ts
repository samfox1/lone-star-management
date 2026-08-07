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
 * HOW IT DERIVES THE LIST — nothing here is hand-written:
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
import {
  buildStyleControls,
  buildTextItemStyleControls,
  buildItemStyleControls,
  buildVideoItemStyleControls,
} from '@/lib/site-editor/style-controls'
import { LEGACY_TO_FLUID, resolveRegionStyle, resolveStyle } from '@lone-star/site-bridge/styles'

type Origin = 'section' | 'item'

/** Every class token the editor can emit, TAGGED with the context it applies in —
 *  section overrides lift only colours to inline style, item overlays lift the whole
 *  owned vocabulary, so the same token can need CSS in one context and none in the
 *  other (2026-08-07 review: a shadow option added to a SECTION control would have
 *  been dropped from the sheet while sections kept it as an uncompiled class). */
function emittedTokens(): [string, Origin][] {
  const tagged: [ReturnType<typeof buildStyleControls>, Origin][] = [
    [buildStyleControls(), 'section'],
    [buildTextItemStyleControls(), 'item'],
    [buildItemStyleControls(), 'item'],
    [buildVideoItemStyleControls('embed'), 'item'],
    [buildVideoItemStyleControls('file'), 'item'],
  ]
  const out = new Map<string, Origin>()
  for (const [controls, origin] of tagged) {
    for (const c of controls) {
      const values: string[] = []
      if ('options' in c) for (const o of c.options) if (o.value) values.push(o.value)
      if ('steps' in c) for (const s of c.steps) if (s.value) values.push(s.value)
      if ('onClass' in c && c.onClass) values.push(c.onClass)
      // A token used in BOTH contexts keeps 'section' — the stricter judge (less lifts).
      for (const v of values) if (out.get(v) !== 'section') out.set(v, origin)
    }
  }
  return [...out.entries()]
}

/** Does this token survive AS A CLASS in the context it is emitted for? */
function survivesAsClass(token: string, origin: Origin): boolean {
  if (origin === 'item') return resolveStyle(token).className === token
  // The section path: a plain (colon-free) key routes through merge + the colour-only
  // lift — exactly what a site's server render does with a stored section override.
  return resolveRegionStyle('generator_probe', '', token).className === token
}

/** The tokens that survive resolution AS CLASSES — the set a site must compile. */
export function classVocabulary(): string[] {
  const vocab = new Set<string>()
  for (const [token, origin] of emittedTokens()) {
    // Multi-class values (none today) split defensively; each part judged alone.
    for (const part of token.split(/\s+/).filter(Boolean)) {
      if (survivesAsClass(part, origin)) vocab.add(part)
    }
  }
  for (const legacy of Object.keys(LEGACY_TO_FLUID)) vocab.add(legacy)
  return [...vocab].sort()
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
 *   @import "@lone-star/site-bridge/tokens.css";
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
