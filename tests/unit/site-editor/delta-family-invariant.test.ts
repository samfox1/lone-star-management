// Every style token the editor can emit belongs to a family, and removing one round-trips.
/**
 * THE DERIVED INVARIANT both review agents independently demanded (AGENTS.md rule 4):
 * hand-listed family tables are how the two HIGH bugs hid — `border-t` (no family, so
 * the divider toggle could not diff) and `lse-not-[textColor]` (camelCase id the
 * removal grammar refused) were exactly the tokens the hand-picked fixture omitted.
 *
 * So this derives the whole surface from the CONTROL BUILDERS — every value a control
 * can EMIT, across every builder and era flag — and asserts, for each:
 *   1. familyOf recognises it (a delta can carry it and strip its predecessors);
 *   2. its family's removal token parses and round-trips through familyOf;
 *   3. the removal survives the save validator.
 * A control added later joins this sweep the moment it exists.
 */
import { describe, expect, it } from 'vitest'
import { familyOf } from '@samfox1/site-bridge/styles'
import { mergeStyle } from '@samfox1/site-bridge'
import { cleanClassText } from '@/lib/site-editor/save'
import {
  buildItemStyleControls,
  buildStyleControls,
  buildTextItemStyleControls,
  buildVideoItemStyleControls,
  controlsForRegion,
  sliderSteps,
  withStyleVars,
  type StyleControl,
} from '@/lib/site-editor/style-controls'

const OPTS = withStyleVars(
  {
    fonts: [{ value: 'font-momo', label: 'Momo', css: '"Momo", serif' }],
    textColors: [{ value: 'text-foreground', label: 'Fg', hex: '#f4f1ea' }],
    bgColors: [{ value: 'bg-black', label: 'Black', hex: '#000000' }],
  },
  '0.24.0',
)
const PHONE = { ...OPTS, mobileView: true }

/** Every control the editor can render, both device scopes, section + item + region. */
function allControls(): StyleControl[] {
  const region = {
    key: 'bar', label: 'Bar', scope: 'chrome' as const,
    base: 'flex px-6 py-16 gap-6 border-t max-w-6xl justify-center iconsize-[18px]',
  }
  return [
    ...buildStyleControls(OPTS),
    ...buildStyleControls(PHONE),
    ...buildTextItemStyleControls(OPTS),
    ...buildTextItemStyleControls(PHONE),
    ...buildItemStyleControls(OPTS),
    ...buildItemStyleControls(PHONE),
    ...buildVideoItemStyleControls('embed', OPTS),
    ...buildVideoItemStyleControls('file', OPTS),
    ...controlsForRegion(buildStyleControls(OPTS), region),
    ...controlsForRegion(buildStyleControls(PHONE), region),
  ]
}

/** Every token a control can WRITE. Colour controls emit runtime hexes; sampled. */
function emittedTokens(c: StyleControl): string[] {
  if (c.kind === 'select') return c.options.map((o) => o.value)
  if (c.kind === 'slider') return sliderSteps(c).map((s) => s.value)
  if (c.kind === 'toggle') return [c.onClass]
  if (c.kind === 'color' && c.toToken) return [c.toToken('#12ab34', '')]
  if (c.kind === 'color') return ['text-[#12ab34]'] // the plain border/colour form
  return []
}

describe('every emittable token has a family, and its removal round-trips', () => {
  for (const c of allControls()) {
    for (const token of emittedTokens(c).filter(Boolean).flatMap((v) => v.split(/\s+/))) {
      const key = `${c.id}:${token}`
      it(key, () => {
        const fam = familyOf(token)
        expect(fam, `${token} (control ${c.id}) has no family — a delta cannot carry it`).not.toBeNull()
        const not = `lse-not-[${fam}]`
        expect(familyOf(not), `${not} does not parse — a removal of ${fam} would ship as a junk class`).toBe(fam)
        expect(cleanClassText(`lse-delta ${not} ${token}`)).not.toBeNull()
        // The removal actually strips: a base wearing the token loses it.
        const rendered = mergeStyle('r', `grid ${token}`, `lse-delta ${not}`)
        expect(rendered.split(/\s+/), `${not} failed to strip ${token}`).not.toContain(token)
      })
    }
  }

  it('the sweep was not vacuous: it covered a real spread of families', () => {
    // Guards the walker itself — an emittedTokens bug returning [] everywhere would pass
    // every generated case above by generating none of them.
    //
    // DERIVED HERE, from the same walker. It used to read a `seen` Map that the generated
    // `it`s above filled as they ran, which made this assertion depend on every one of
    // them having already executed. True in declaration order, false under
    // `--sequence.shuffle`: it failed about one run in three, and standalone
    // (`-t "the sweep was not vacuous"`) it read `expected 0 to be >= 20` because no
    // sibling had run at all. A guard against vacuity that is itself order-dependent is
    // worse than no guard, and it hid for weeks because nothing ran the suite twice in
    // two different orders (2026-09-04, found by shuffled repeat passes).
    const families = new Set<string>()
    for (const c of allControls())
      for (const token of emittedTokens(c).filter(Boolean).flatMap((v) => v.split(/\s+/))) {
        const fam = familyOf(token)
        if (fam) families.add(fam)
      }
    expect(families.size).toBeGreaterThanOrEqual(20)
    expect([...families]).toEqual(expect.arrayContaining(['size', 'divider', 'textColor', 'pad', 'sizesm']))
  })
})
