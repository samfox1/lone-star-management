/**
 * AUDIT: what a site SETS but the editor cannot SHOW.
 *
 * Sam's rule (2026-08-15): "everything that is set on the site should be seen in the
 * editor." A control reads the REGION's class string, so a value living anywhere else —
 * on a child element, in a CSS var fallback, or in a class the site's palette never
 * declared — leaves the control blank while the site is plainly styled. That has now
 * caused four separate bugs (icon size, hover colour, icon colour, footer background),
 * so this asks the question of every region at once.
 *
 * Driven by the EDITOR'S OWN control code, not a re-description of it: buildStyleControls
 * + controlsForRegion + readStyleValue are exactly what the panel runs, so a control this
 * says is blank is blank in the panel.
 *
 * HOW TO RUN. Each site prints its own regions + palette (its registry is the truth, and
 * it lives in that repo), then this reads the dumps:
 *
 *   # in each site repo, a throwaway that prints JSON:
 *   #   import { editList } from './lib/manifest'   (juniper / operator)
 *   #   import { STYLE_REGIONS } from './lib/styles' + EDIT_LIST  (skeen)
 *   npm run audit:regions -- /tmp/juniper.json /tmp/operator.json /tmp/skeen.json
 *
 * Clean at 0 findings across 46 regions (2026-08-15). A NEW finding means a site started
 * wearing something its own manifest never told the editor about.
 */
import { readFileSync } from 'node:fs'
import {
  buildStyleControls,
  controlsForRegion,
  readStyleValue,
  type StyleControl,
} from '../src/lib/site-editor/style-controls'
import type { ManifestStyleRegion } from '../src/lib/site-editor/manifest'

type Dump = {
  site: string
  regions: { key: string; label: string; base?: string; scope?: string }[]
  textColors: string[]
  bgColors: string[]
}

/**
 * Is this `text-*` token a COLOUR? Everything else sharing the prefix — sizes, alignment,
 * wrapping, transform — belongs to other controls, which DO show it, so flagging those
 * buried the four real findings in 250 lines of noise on the first run.
 */
const NON_COLOR_TEXT =
  /^text-(xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[)/
const isColorToken = (t: string): 'textColor' | 'bgColor' | 'borderColor' | null => {
  const bare = t.replace(/^!/, '')
  if (bare.startsWith('bg-') && !bare.startsWith('bg-[url')) return 'bgColor'
  if (/^border-(?!\d|\[|solid|dashed|dotted|none|t|b|l|r|x|y)/.test(bare)) return 'borderColor'
  if (/^text-\[#[0-9a-fA-F]{3,8}\]$/.test(bare)) return 'textColor' // an arbitrary hex IS a colour
  if (bare.startsWith('text-') && !NON_COLOR_TEXT.test(bare)) return 'textColor'
  return null
}

/** Sliders where "nothing in the base to measure" was a REAL bug: the handle rests on a
 *  guess instead of on what is on screen. An effect that is simply off (shadow, glow,
 *  outline) is not in this set — resting at None is correct there. */
const MUST_MEASURE = new Set(['iconSize', 'gap', 'pad', 'sectionSpacing', 'contentWidth'])

function audit(dump: Dump) {
  const controls = buildStyleControls({
    fonts: [],
    textColors: dump.textColors.map((v) => ({ value: v, label: v })),
    bgColors: dump.bgColors.map((v) => ({ value: v, label: v })),
  })
  const declared = new Set([...dump.textColors, ...dump.bgColors])
  const findings: string[] = []

  for (const r of dump.regions) {
    const base = r.base ?? ''
    const region = { key: r.key, label: r.label, base, scope: r.scope } as ManifestStyleRegion
    const offered: StyleControl[] = controlsForRegion(controls, region)
    const tokens = base.split(/\s+/).filter(Boolean)

    // 1. A colour the site WEARS that no control can recognise — the picker reads blank
    //    while the element is plainly coloured (skeen's `text-white/80` icons).
    for (const t of tokens) {
      const kind = isColorToken(t)
      if (!kind) continue
      const bare = t.replace(/^!/, '')
      if (/^(text|bg|border)-\[#[0-9a-fA-F]{3,8}\]$/.test(bare)) continue // arbitrary hex: readable
      if (declared.has(bare)) continue
      if (!offered.some((c) => c.id === kind)) continue
      findings.push(`${r.key} · wears ${bare}, which the palette never declares → ${kind} reads blank`)
    }

    // 2. An ICON GROUP that hasn't declared what its icons actually look like.
    if (r.scope === 'icons') {
      if (!tokens.some((t) => t.startsWith('iconsize-['))) findings.push(`${r.key} · icon group declares no iconsize-[…]`)
      if (!tokens.some((t) => t.startsWith('hovercolor-['))) findings.push(`${r.key} · icon group declares no hovercolor-[…]`)
      if (!tokens.some((t) => isColorToken(t) === 'textColor')) findings.push(`${r.key} · icon group declares no icon colour`)
    }

    // 3. A measuring slider with nothing to measure.
    for (const c of offered) {
      if (c.kind !== 'slider' || !c.rank || !MUST_MEASURE.has(c.id)) continue
      if (c.id === 'pad' && r.scope !== 'chrome') continue // only a bar's padding is its height
      if (tokens.some((t) => c.owns(t) && c.rank!(t) != null)) continue
      findings.push(`${r.key} · ${c.label} slider has nothing in the base to measure`)
    }
  }
  return findings
}

const files = process.argv.slice(2)
let total = 0
for (const f of files) {
  const dump = JSON.parse(readFileSync(f, 'utf8')) as Dump
  const findings = audit(dump)
  console.log(`\n=== ${dump.site} — ${dump.regions.length} regions, ${findings.length} findings`)
  for (const line of findings) console.log(`  • ${line}`)
  total += findings.length
}
console.log(`\n${total} findings across ${files.length} sites.`)
