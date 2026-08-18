/**
 * The no-code style controls (lib/site-editor/style-controls): each control owns a slice
 * of a Tailwind class string, reads the current utility, and swaps it on apply while
 * PRESERVING everything it doesn't own (layout, spacing, z-index).
 */
import { describe, expect, it } from 'vitest'
import { clampMaxRem } from './helpers/clamp'
import { sizeLength } from '@samfox1/site-bridge/styles'
import {
  applyStyleValue,
  buildItemStyleControls,
  buildStyleControls,
  buildVideoItemStyleControls,
  readStyleValue,
  sliderIndex,
  sliderSteps,
  withUploadedFonts,
  buildTextItemStyleControls,
  controlsForRegion,
  type SiteStyleOptions,
  type StyleControl,
} from '@/lib/site-editor/style-controls'

const PALETTE: SiteStyleOptions = {
  fonts: [
    { value: 'font-display', label: 'Display' },
    { value: 'font-momo', label: 'Momo' },
  ],
  textColors: [
    { value: 'text-flash-1', label: 'Flash', hex: '#2563eb' },
    { value: 'text-foreground', label: 'Foreground' },
  ],
  bgColors: [
    { value: 'bg-background', label: 'Background' },
    { value: 'bg-black', label: 'Black', hex: '#000000' },
  ],
}

const controls = buildStyleControls(PALETTE)
const byId = (id: string) => controls.find((c) => c.id === id)!

describe('controlsForRegion — a site-wide region styles the SURFACE only', () => {
  it('CRITICAL: the page BACKGROUND offers ONE color and nothing else — no padding', () => {
    // Sam, 2026-08-12: "just one color, no gradient"; text Size + frost left as reads-as-
    // doing-nothing. Vertical padding followed on 2026-08-14 — it had no useful effect on
    // a full-bleed band around a centred column, so the page keeps only its colour.
    const page = controlsForRegion(controls, { key: 'page', label: 'Page', scope: 'site' })
    expect(page.map((c) => c.id).sort()).toEqual(['bgColor'])
  })

  it('CRITICAL: chrome bars keep NORMAL all-sides padding — the page has none', () => {
    // The header/footer padding must be unchanged from an element region's: all-sides,
    // emitting `pad-[Npx]` (Sam, 2026-08-14: "I didn't want the padding set up to change for
    // the footer and header bars … normal padding on all directions"). The page has no pad.
    const bar = controlsForRegion(controls, { key: 'masthead', label: 'Masthead', scope: 'chrome' })
    const pad = bar.find((c) => c.id === 'pad')!
    if (pad.kind !== 'slider') throw new Error('unreachable')
    expect(pad.label).toBe('Padding') // NOT "Vert padding"
    expect(pad.steps.some((s) => s.value.startsWith('pad-['))).toBe(true) // all-sides token
    expect(pad.steps.every((s) => !s.value.startsWith('pady-['))).toBe(true) // never vertical-only
    // It is the SAME control an element region gets — nothing special-cased for chrome.
    expect(pad).toBe(controls.find((c) => c.id === 'pad'))
    const page = controlsForRegion(controls, { key: 'page', label: 'Page', scope: 'site' })
    expect(page.find((c) => c.id === 'pad')).toBeUndefined()
  })

  it('CRITICAL: a region whose base declares an alignable justify gets a Left/Center/Right control', () => {
    // The hero row opts in by wearing `justify-center`; the control writes `just-[…]`
    // inline over it (Sam, 2026-08-13).
    const hero = controlsForRegion(controls, {
      key: 'hero', label: 'Hero', base: 'grid md:grid-cols-[auto_260px] justify-center', scope: 'site',
    })
    const align = hero.find((c) => c.id === 'justify')
    expect(align?.kind).toBe('select')
    if (align?.kind !== 'select') throw new Error('unreachable')
    expect(align.options.map((o) => o.value)).toEqual(['', 'just-[start]', 'just-[center]', 'just-[end]'])
    expect(applyStyleValue('grid justify-center', align, 'just-[end]')).toBe('grid justify-center just-[end]')
  })

  it("CRITICAL: a bar's intrinsic justify-between does NOT sprout the Alignment control", () => {
    // The masthead spreads wordmark ↔ socials with justify-between; that is layout, not
    // an orientation to flip — the control must stay off it.
    const bar = controlsForRegion(controls, {
      key: 'masthead', label: 'Masthead', base: 'flex justify-between px-6 py-4', scope: 'chrome',
    })
    expect(bar.find((c) => c.id === 'justify')).toBeUndefined()
  })

  it('CRITICAL: Icon size starts ON the row\'s real size, never at the far-left end', () => {
    // Sam, 2026-08-14: "it starts far left and when I move it to the right it gets
    // smaller. Have the slider start on its current size." Same shape as the text-size
    // bug of 2026-08-12: an unset value matched the '' step sitting at INDEX 0, so the
    // handle pinned left and the first nudge right applied 12px over a real 18/24px.
    const socials = controlsForRegion(controls, {
      key: 'socials', label: 'Social icons', base: 'flex gap-4 iconsize-[18px] text-ink/60', scope: 'icons',
    })
    const size = socials.find((c) => c.id === 'iconSize')!
    if (size.kind !== 'slider') throw new Error('unreachable')
    // The site DECLARES its size in the base, so the handle can sit exactly on it.
    const parked = sliderIndex(size, readStyleValue(size, 'flex gap-4 iconsize-[18px] text-ink/60'))
    expect(sliderSteps(size)[parked.idx].label).toBe('18px')
    expect(parked.exact).toBe(true)
    // Dragging right is BIGGER than what is on screen. This is the assertion the bug broke.
    expect(sliderSteps(size)[parked.idx + 1].label).toBe('20px')
    // And "Default" is never a position on the scale — no step may be the empty value,
    // or an unset row pins left again for the next site that forgets to declare a size.
    expect(sliderSteps(size).every((s) => s.value !== '')).toBe(true)
  })

  it('an icon row that declares NO size rests mid-scale, not at either end', () => {
    // The safety net for a site that never declared one: mid-scale is honest about
    // "unset", and both ends are lies.
    const socials = controlsForRegion(controls, {
      key: 'socials', label: 'Social icons', base: 'flex gap-4 text-ink/60', scope: 'icons',
    })
    const size = socials.find((c) => c.id === 'iconSize')!
    if (size.kind !== 'slider') throw new Error('unreachable')
    const { idx, label } = sliderIndex(size, readStyleValue(size, 'flex gap-4 text-ink/60'))
    expect(idx).toBeGreaterThan(0) // NOT the far-left end
    expect(idx).toBeLessThan(sliderSteps(size).length - 1)
    expect(label).toBe('Default')
  })

  it('CRITICAL: an icon group SHOWS the colours the site already sets', () => {
    // Sam, 2026-08-15: "these buttons already have an on hover color change, can you set
    // that in the editor. Everything that is set on the site should be seen in the
    // editor." The control can only show what the REGION declares — a colour living on a
    // child anchor, or in a CSS var fallback, is invisible to it and the picker reads
    // empty while the site is plainly coloured. Same lesson as the icon-size slider.
    const base = 'flex gap-4 iconsize-[18px] text-ink/60 hovercolor-[#9c4221]'
    // Built with the SITE'S palette, because a colour control can only recognise an
    // arbitrary hex or a colour the site declared. A base wearing `text-ink/60` that the
    // palette never mentions reads as unset — the site is coloured, the picker is blank.
    const juniper = buildStyleControls({
      fonts: [{ value: 'font-serif', label: 'Serif' }],
      textColors: [{ value: 'text-ink/60', label: 'Muted ink', hex: '#1a171499' }],
      bgColors: [{ value: 'bg-paper', label: 'Paper', hex: '#faf8f4' }],
    })
    const socials = controlsForRegion(juniper, {
      key: 'socials', label: 'Social icons', base, scope: 'icons',
    })
    const hover = socials.find((c) => c.id === 'hoverColor')!
    const color = socials.find((c) => c.id === 'textColor')!
    if (hover.kind !== 'color') throw new Error('the hover control must be a colour picker')
    expect(hover.hexOf!(base)).toBe('#9c4221') // the site's real hover colour, shown
    expect(readStyleValue(color, base)).toBe('text-ink/60') // and its real icon colour
    // Picking a new hover colour REPLACES the declared one rather than stacking a second.
    expect(applyStyleValue(base, hover, hover.toToken!('#123456', base)))
      .toBe('flex gap-4 iconsize-[18px] text-ink/60 hovercolor-[#123456]')
  })

  it('CRITICAL: a site-scope region whose base sets vertical padding gets a Spacing slider', () => {
    // The vertical rhythm BETWEEN sections (Juniper's `py-12` on every section block).
    // It must emit `pady-` (top/bottom only): the all-sides `pad-` token would invent
    // horizontal padding a full-width band never had.
    const block = controlsForRegion(controls, {
      key: 'section_block', label: 'Section spacing', base: 'border-t border-ink/15 py-12', scope: 'site',
    })
    const spacing = block.find((c) => c.id === 'sectionSpacing')
    expect(spacing?.kind).toBe('slider')
    if (spacing?.kind !== 'slider') throw new Error('unreachable')
    expect(spacing.rank!('py-12')).toBe(48) // measures the base's own Tailwind rhythm
    expect(spacing.rank!('pady-[64px]')).toBe(64)
    expect(spacing.steps.every((s) => !s.value.startsWith('pad-['))).toBe(true) // never all-sides
    // Applying REPLACES the base's py-* and keeps everything it does not own.
    expect(applyStyleValue('border-t border-ink/15 py-12', spacing, 'pady-[64px]')).toBe(
      'border-t border-ink/15 pady-[64px]',
    )
    // A site-scope region with no vertical padding in its base does not get it.
    const page = controlsForRegion(controls, { key: 'page', label: 'Page', base: 'bg-paper', scope: 'site' })
    expect(page.find((c) => c.id === 'sectionSpacing')).toBeUndefined()
  })

  it('CRITICAL: Spacing never eats a band\'s SIDE gutters', () => {
    // skeen's bands wear `px-6 pb-24 pt-16`. A vertical control that owned every padding
    // utility would strip `px-6` on the first drag and shove the content to the window
    // edge — a silent regression with nothing on screen to explain it.
    const band = controlsForRegion(controls, {
      key: 'shows_section', label: 'Tour section', base: 'mx-auto max-w-6xl px-6 pb-24 pt-16', scope: 'site',
    })
    const spacing = band.find((c) => c.id === 'sectionSpacing')!
    expect(spacing.owns('px-6')).toBe(false)
    expect(spacing.owns('p-4')).toBe(false) // all-sides is the other control's business
    expect(spacing.owns('pt-16')).toBe(true)
    expect(spacing.owns('pb-24')).toBe(true)
    expect(applyStyleValue('mx-auto max-w-6xl px-6 pb-24 pt-16', spacing, 'pady-[48px]')).toBe(
      'mx-auto max-w-6xl px-6 pady-[48px]',
    )
  })

  it('CRITICAL: a CHROME bar keeps all-sides Padding and never grows a second spacing slider', () => {
    // The bars wear `py-4`, which the Spacing control would also claim — two controls
    // owning one token fight over it. Sam's 2026-08-14 call stands: bars keep NORMAL
    // all-sides padding, so the vertical control is site-scope only.
    const bar = controlsForRegion(controls, {
      key: 'masthead', label: 'Masthead', base: 'flex border-b px-6 py-4', scope: 'chrome',
    })
    expect(bar.find((c) => c.id === 'sectionSpacing')).toBeUndefined()
    expect(bar.find((c) => c.id === 'pad')).toBeTruthy()
  })

  it('CRITICAL: a region whose base caps its width (max-w-*) gets a Width slider that MEASURES the cap', () => {
    // The content column (mx-auto max-w-3xl px-6). The slider must park ON the base's own
    // compiled cap — max-w-3xl is 768px — so the first drag right is always WIDER than
    // what's on screen, never a jump to the scale's far end (the size-slider lesson).
    const content = controlsForRegion(controls, {
      key: 'content', label: 'Content', base: 'mx-auto max-w-3xl px-6', scope: 'site',
    })
    const width = content.find((c) => c.id === 'contentWidth')
    expect(width?.kind).toBe('slider')
    if (width?.kind !== 'slider') throw new Error('unreachable')
    expect(width.rank!('max-w-3xl')).toBe(768) // measures the compiled base cap
    expect(width.rank!('maxw-[1120px]')).toBe(1120) // measures its own token
    expect(width.rank!('maxw-full')).toBeGreaterThan(1440) // Full ranks past every px step
    // Applying REPLACES the base cap — two max-widths on one element is a fight.
    expect(applyStyleValue('mx-auto max-w-3xl px-6', width, 'maxw-[1120px]')).toBe('mx-auto px-6 maxw-[1120px]')
    // A site-scope region with no width cap (the page band) gets no Width control.
    const page = controlsForRegion(controls, { key: 'page', label: 'Page', base: 'bg-paper', scope: 'site' })
    expect(page.find((c) => c.id === 'contentWidth')).toBeUndefined()
  })

  it('a region whose base sets a gap gets a Gap slider that MEASURES that gap; one without does not', () => {
    const hero = controlsForRegion(controls, {
      key: 'hero', label: 'Hero', base: 'grid gap-8 md:grid-cols-[auto_260px] justify-center', scope: 'site',
    })
    const gap = hero.find((c) => c.id === 'gap')
    expect(gap?.kind).toBe('slider')
    if (gap?.kind !== 'slider') throw new Error('unreachable')
    expect(gap.rank!('gap-8')).toBe(32) // Tailwind scale: 8 × 4px — handle parks at the base gap
    expect(gap.rank!('gap-[48px]')).toBe(48)
    expect(applyStyleValue('grid gap-8', gap, 'gap-[48px]')).toBe('grid gap-[48px]') // replaces, not appends
    // A site-scope region with no gap in its base (the page band) gets no Gap control.
    const page = controlsForRegion(controls, { key: 'page', label: 'Page', base: 'bg-paper', scope: 'site' })
    expect(page.find((c) => c.id === 'gap')).toBeUndefined()
  })

  it('CRITICAL: an icon GROUP (scope "icons") gets size + colour + hover + gap, curated', () => {
    // The socials row: a cascading set so every icon stays consistent (Sam, 2026-08-14).
    const socials = controlsForRegion(controls, {
      key: 'socials', label: 'Social icons', base: 'flex gap-4 text-ink/60', scope: 'icons',
    })
    expect(socials.map((c) => c.id)).toEqual(['iconSize', 'textColor', 'hoverColor', 'gap'])
    const size = socials.find((c) => c.id === 'iconSize')!
    if (size.kind !== 'slider') throw new Error('unreachable')
    expect(size.rank!('iconsize-[28px]')).toBe(28)
    expect(socials.find((c) => c.id === 'textColor')!.label).toBe('Icon color') // relabelled
    // Hover colour emits the VAR token ONLY (no `hovercolor` marker) → per-icon hover.
    const hover = socials.find((c) => c.id === 'hoverColor')!
    if (hover.kind !== 'color') throw new Error('unreachable')
    expect(hover.toToken!('#ff0000', '')).toBe('hovercolor-[#ff0000]')
    // A group with no gap in its base gets no Gap control.
    const noGap = controlsForRegion(controls, { key: 'x', label: 'X', base: 'flex text-ink/60', scope: 'icons' })
    expect(noGap.find((c) => c.id === 'gap')).toBeUndefined()
  })

  it("CRITICAL: geometry belongs to the CHROME bars — the body band can't show it", () => {
    // Sam, 2026-08-12: "we can drop height and width from the middle." Height is a
    // floor and the body stands taller than every step; width there reads as a
    // rightward push. The bars are where both behave, so scope:'chrome' carries them.
    const bar = controlsForRegion(controls, { key: 'masthead', label: 'Masthead', scope: 'chrome' })
    expect(bar.map((c) => c.id).sort()).toEqual(['bgColor', 'height', 'pad', 'width'])
  })

  it('CRITICAL: Width runs 40% → Full and rests at the RIGHT end — a section is full-bleed by default', () => {
    // Sam, 2026-08-12: "far right is 100% width, left may be 0, or, if that doesn't
    // make sense, some other number" — 0 is an invisible bar, so the floor is 40%.
    const bar = controlsForRegion(controls, { key: 'masthead', label: 'Masthead', scope: 'chrome' })
    const width = bar.find((c) => c.id === 'width')!
    if (width.kind !== 'slider') throw new Error('unreachable')
    expect(width.steps[0].value).toBe('secw-[40%]')
    expect(width.steps.at(-1)).toEqual({ value: '', label: 'Full' })
    expect(width.rank!('')).toBe(100) // '' IS the 100% end, not an off-scale default
    expect(sliderIndex(width, '').idx).toBe(width.steps.length - 1)
  })

  it('Height starts at Auto (off-scale) and measures its px steps', () => {
    const bar = controlsForRegion(controls, { key: 'masthead', label: 'Masthead', scope: 'chrome' })
    const height = bar.find((c) => c.id === 'height')!
    if (height.kind !== 'slider') throw new Error('unreachable')
    expect(height.rank!('sech-[240px]')).toBe(240)
    expect(height.rank!('')).toBeNull() // Auto is "what the content needs", not zero
  })

  it('CRITICAL: a chrome bar whose base draws a divider gets the Divider line toggle', () => {
    // "A way to remove the line below the nav bar and above the footer": the toggle is
    // built FROM the region's own base — off strips the border side, on restores it.
    const bar = controlsForRegion(controls, {
      key: 'masthead', label: 'Masthead', base: 'flex border-b border-ink/15 px-6 py-4', scope: 'site',
    })
    const divider = bar.find((c) => c.id === 'divider')
    expect(divider?.kind).toBe('toggle')
    if (divider?.kind !== 'toggle') throw new Error('unreachable')
    expect(readStyleValue(divider, 'flex border-b border-ink/15 px-6 py-4')).toBe('on')
    expect(applyStyleValue('flex border-b border-ink/15 px-6 py-4', divider, '')).toBe(
      'flex border-ink/15 px-6 py-4',
    )
    expect(applyStyleValue('flex border-ink/15 px-6 py-4', divider, 'on')).toBe(
      'flex border-ink/15 px-6 py-4 border-b',
    )
    // A region whose base draws no line gets no toggle — nothing to remove.
    const page = controlsForRegion(controls, { key: 'page', label: 'Page', base: 'bg-paper', scope: 'site' })
    expect(page.find((c) => c.id === 'divider')).toBeUndefined()
  })

  it('an ELEMENT region keeps the full set — text styling belongs to the elements', () => {
    expect(controlsForRegion(controls, { key: 'bio', label: 'Biography' })).toEqual(controls)
  })

  it("an ITEM-scoped region also keeps the full set — it dresses one clickable element", () => {
    // scope 'item' (song titles) falls through to the full control set like an element
    // region; only 'site'/'chrome' are the surface-only allowlist.
    expect(controlsForRegion(controls, { key: 'song_title', label: 'Song title', scope: 'item' })).toEqual(controls)
  })

  it('CRITICAL: the chrome Width slider MEASURES a % token, not just the full default', () => {
    // '' ranks 100 (full-bleed); a real secw-[N%] token must rank N, or the handle
    // parks wrong. Only the '' end was pinned before.
    const bar = controlsForRegion(controls, { key: 'masthead', label: 'Masthead', scope: 'chrome' })
    const width = bar.find((c) => c.id === 'width')!
    if (width.kind !== 'slider') throw new Error('unreachable')
    expect(width.rank!('secw-[60%]')).toBe(60)
    expect(width.rank!('')).toBe(100)
  })
})

describe('the padding slider starts where the region actually is', () => {
  it("CRITICAL: a base's own padding classes are measured — the handle parks at the real value", () => {
    // Sam, 2026-08-12: the footer slider sat far LEFT ('' exact-matched the None step)
    // while the bar wore py-10 — the first drag right applied a small pad and the bar
    // SHRANK. The control must own and rank Tailwind padding classes so the handle
    // starts ≈ the real inset and dragging right always grows it.
    const pad = byId('pad')
    expect(pad.kind).toBe('slider')
    if (pad.kind !== 'slider') throw new Error('unreachable')
    expect(readStyleValue(pad, 'border-t py-10 px-6')).toBe('py-10')
    expect(pad.rank!('py-10')).toBe(40) // Tailwind scale: n × 4px
    expect(pad.rank!('pad-[40px]')).toBe(40)
    const { label, exact } = sliderIndex(pad, 'py-10')
    expect(exact).toBe(false)
    expect(label).toContain('40px')
    // Picking a step REPLACES the base padding classes rather than fighting them.
    expect(applyStyleValue('border-t py-10 px-6', pad, 'pad-[44px]')).toBe('border-t pad-[44px]')
  })
})

describe('section colour controls — the ONE picker format everywhere', () => {
  // Sam, 2026-08-12: every colour button gets the text-colour selector's format —
  // the custom picker plus the colours-on-site swatch row (ColorPalette). That means
  // hex 'color' kind, never a select of palette classes.
  it('CRITICAL: Background is a hex picker that also OWNS the declared palette classes', () => {
    const bg = byId('bgColor')
    expect(bg.kind).toBe('color')
    if (bg.kind !== 'color') throw new Error('unreachable — narrows for tsc')
    expect(bg.toToken!('#112233', '')).toBe('bg-[#112233]')
    expect(bg.hexOf!('mt-2 bg-[#112233]')).toBe('#112233')
    // A stored palette class must be REPLACED when a hex is picked, not left to fight.
    expect(applyStyleValue('bg-black mt-2', bg, bg.toToken!('#112233', ''))).toBe('mt-2 bg-[#112233]')
    // …and read back as its declared hex, so the picker shows where the site is.
    expect(bg.hexOf!('bg-black mt-2')).toBe('#000000')
  })

  it('Text color is the same shape, and exists WITHOUT a palette — hex lifts inline anywhere', () => {
    const noPalette = buildStyleControls().find((c) => c.id === 'textColor')
    expect(noPalette?.kind).toBe('color')
    const bgNoPalette = buildStyleControls().find((c) => c.id === 'bgColor')
    expect(bgNoPalette?.kind).toBe('color')
  })
})

describe('the text tab, tuned (Sam, 2026-08-12)', () => {
  const text = buildTextItemStyleControls({ fonts: [] })

  it('CRITICAL: no strikethrough — the underline is the one decoration offered', () => {
    expect(text.find((c) => c.id === 'strike')).toBeUndefined()
    expect(text.find((c) => c.id === 'underline')).toBeTruthy()
    // …so the line dressing (thickness, colour, Y position) is the UNDERLINE's.
    expect(text.find((c) => c.id === 'decoThickness')).toBeTruthy()
  })

  it('Thickness is a BUTTON ROW: Default · Normal · Bold · Black (Sam, 2026-08-17)', () => {
    // Third size of this control: nine slider steps → five → buttons, each shrink for
    // the same reason ("a lot of text only has 2 or 3 levels of thickness").
    const w = text.find((c) => c.id === 'weight')!
    if (w.kind !== 'select' || !w.segmented) throw new Error('weight must be a segmented select')
    expect(w.options.map((o) => o.label)).toEqual(['Default', 'Normal', 'Bold', 'Black'])
    // Ownership still spans EVERY weight of either era — a stored font-medium is
    // replaced when a segment is pressed, never left to stack.
    expect(w.owns('font-medium')).toBe(true)
    expect(w.owns('weight-[500]')).toBe(true)
  })

  it("the offset slider is named 'Line Y position'", () => {
    expect(text.find((c) => c.id === 'decoOffset')?.label).toBe('Line Y position')
  })
})

describe('buildStyleControls', () => {
  it('includes the universal controls always, palette controls only when declared', () => {
    const ids = controls.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['size', 'weight', 'align', 'uppercase', 'italic', 'font', 'textColor', 'bgColor']))
    // No palette → no font/colour controls.
    const bare = buildStyleControls().map((c) => c.id)
    // Slice-1 (2026-08-10) added shadow + outline to the universal set: they lift
    // inline, so they need no site palette and no compiled classes.
    // Slice-2 (2026-08-11) widened the universal set again: decorations, the two
    // gradient pairs, frost and padding — all inline-lifted, so none need a palette.
    // Slice-3 (2026-08-11) adds motion: entrance/hover ride tokens.css's effects
    // block (compiled everywhere tokens.css is), speed lifts inline — still no palette.
    // 2026-08-12: textColor/bgColor left the palette conditionals — hex colours lift
    // inline, so the pickers work on a site that declares no palette. Only `font`
    // stays palette-gated (a font class the site never compiled is a silent no-op).
    expect(bare).toEqual([
      'size', 'weight', 'textColor', 'bgColor', 'align', 'textShadow', 'textStroke', 'textGlow',
      'underline', 'strike', 'decoColor', 'decoThickness', 'decoOffset',
      'bggradFrom', 'bggradTo',
      'frost', 'pad', 'uppercase', 'italic',
      // Entrances PAUSED 2026-08-12 (see motionControls) — hover stays.
      'hover', 'hoverColor',
    ])
  })
})

describe('buildItemStyleControls (per-image/video)', () => {
  const item = buildItemStyleControls()
  const itemById = (id: string) => item.find((c) => c.id === id)!

  it('offers exactly the visual controls, effects included', () => {
    // Extended 2026-08-10 (slice 1): the photographic effects + crop. The exact-list
    // form stays — a control appearing or vanishing must be a decision, not drift.
    expect(item.map((c) => c.id)).toEqual([
      'size', 'opacity', 'borderWidth', 'borderColor', 'radius', 'shadow',
      'grayscale', 'sepia', 'brightness', 'contrast', 'saturate', 'soften', 'tilt', 'fit', 'fitPosition',
      'shape', 'feather', 'pad',
      // Entrances PAUSED 2026-08-12 (see motionControls) — hover stays.
      'hover', 'hoverColor',
    ])
  })

  it('CRITICAL: hover colour writes marker + hex together, clears together, survives the effect select', () => {
    // The compiled :hover rule lives on the `hovercolor` marker class; the hex lifts
    // inline from `hovercolor-[#hex]`. Apart they are both no-ops, so the control
    // must write and clear them as one. And the hover-EFFECT select (owns `hover-`)
    // must not sweep them: `hovercolor` deliberately has no dash after "hover".
    const ctl = itemById('hoverColor')
    expect(ctl.kind).toBe('color')
    if (ctl.kind !== 'color') throw new Error('unreachable — narrows the union for tsc')
    let s = applyStyleValue('rounded-xl', ctl, ctl.toToken!('#ff0055', 'rounded-xl'))
    const tokens = () => s.split(/\s+/)
    expect(tokens()).toContain('hovercolor')
    expect(tokens()).toContain('hovercolor-[#ff0055]')
    expect(ctl.hexOf!(s)).toBe('#ff0055')
    s = applyStyleValue(s, itemById('hover'), 'hover-grow')
    expect(tokens()).toContain('hovercolor')
    expect(tokens()).toContain('hovercolor-[#ff0055]')
    s = applyStyleValue(s, ctl, '')
    expect(s).not.toContain('hovercolor')
    expect(tokens()).toContain('hover-grow') // clearing the colour keeps the effect
  })

  it('size, transparency, border, corners + shadow are SLIDERS; border colour is a palette', () => {
    expect(itemById('size').kind).toBe('slider')
    expect(itemById('opacity').kind).toBe('slider')
    expect(itemById('borderWidth').kind).toBe('slider')
    expect(itemById('radius').kind).toBe('slider')
    expect(itemById('shadow').kind).toBe('slider')
    // A full palette: any hex, so the control carries no option list to choose from.
    expect(itemById('borderColor').kind).toBe('color')
    expect('options' in itemById('borderColor')).toBe(false)
    expect('steps' in itemById('borderColor')).toBe(false)
  })

  it('the border colour owns ANY hex, not a shortlist', () => {
    const color = itemById('borderColor')
    for (const hex of ['#000', '#3b82f6', '#123abc', '#ff00ff80'])
      expect(color.owns(`border-[${hex}]`)).toBe(true)
    expect(color.owns('border-[4px]')).toBe(false) // a width
    expect(color.owns('border-red-500')).toBe(false) // a named token, not ours
  })

  it('size steps run 25%→175% in 5% increments, 100% as the default (no class)', () => {
    // Widened from 50–150 on 2026-08-11 (Sam: "larger and more precise").
    const size = itemById('size')
    if (size.kind !== 'slider') throw new Error('size should be a slider')
    expect(size.steps).toHaveLength(31) // (175-25)/5 + 1
    expect(size.steps[0]).toEqual({ value: 'scale-25', label: '25%' })
    expect(size.steps[15]).toEqual({ value: '', label: '100%' }) // 100% → no class
    expect(size.steps[17]).toEqual({ value: 'scale-110', label: '110%' })
    expect(size.steps[30]).toEqual({ value: 'scale-175', label: '175%' })
  })

  it('each control owns ONLY its own utilities — border WIDTH vs border COLOUR (arbitrary hex) do not collide', () => {
    // A full item class string with one utility per control; the colour is an arbitrary hex.
    const cls = 'scale-110 opacity-50 border-2 border-[#ff0000] rounded-[6px] shadow-lg'
    expect(readStyleValue(itemById('size'), cls)).toBe('scale-110')
    expect(readStyleValue(itemById('opacity'), cls)).toBe('opacity-50')
    expect(readStyleValue(itemById('borderWidth'), cls)).toBe('border-2') // width, not the colour
    expect(readStyleValue(itemById('borderColor'), cls)).toBe('border-[#ff0000]') // colour, not the width
    expect(readStyleValue(itemById('radius'), cls)).toBe('rounded-[6px]')
    expect(readStyleValue(itemById('shadow'), cls)).toBe('shadow-lg')
  })

  it('applying a control swaps its utility and preserves the rest (additive overlay)', () => {
    let cls = ''
    cls = applyStyleValue(cls, itemById('size'), 'scale-125')
    cls = applyStyleValue(cls, itemById('borderWidth'), 'border-[4px]')
    cls = applyStyleValue(cls, itemById('borderColor'), 'border-[#3b82f6]')
    expect(cls.split(' ').sort()).toEqual(['border-[#3b82f6]', 'border-[4px]', 'scale-125'])
    // Changing the border colour keeps the width + size.
    cls = applyStyleValue(cls, itemById('borderColor'), 'border-[#ffffff]')
    expect(cls.split(' ').sort()).toEqual(['border-[#ffffff]', 'border-[4px]', 'scale-125'])
    // Clearing size (Default) drops only the scale.
    cls = applyStyleValue(cls, itemById('size'), '')
    expect(cls.split(' ').sort()).toEqual(['border-[#ffffff]', 'border-[4px]'])
  })
})

describe('readStyleValue', () => {
  const cls = 'relative z-0 bg-black text-flash-1 text-4xl font-momo font-bold uppercase'
  it('reads size / weight / font / colours distinctly (all share text-/font- prefixes)', () => {
    expect(readStyleValue(byId('size'), cls)).toBe('text-4xl')
    expect(readStyleValue(byId('weight'), cls)).toBe('font-bold')
    expect(readStyleValue(byId('font'), cls)).toBe('font-momo')
    expect(readStyleValue(byId('textColor'), cls)).toBe('text-flash-1')
    expect(readStyleValue(byId('bgColor'), cls)).toBe('bg-black')
  })
  it('reads a toggle as on/off', () => {
    expect(readStyleValue(byId('uppercase'), cls)).toBe('on')
    expect(readStyleValue(byId('italic'), cls)).toBe('')
  })
  it('returns Default ("") when the control has no matching token', () => {
    expect(readStyleValue(byId('align'), cls)).toBe('')
    expect(readStyleValue(byId('size'), 'relative z-0')).toBe('')
  })
})

describe('applyStyleValue', () => {
  it('swaps the owned utility and PRESERVES everything else', () => {
    const out = applyStyleValue('relative z-0 bg-black text-4xl', byId('size'), 'text-lg')
    expect(out.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'z-0', 'bg-black', 'text-lg']))
    expect(out).not.toContain('text-4xl')
  })
  it('setting Default ("") removes the owned utility, leaving the rest', () => {
    expect(applyStyleValue('relative bg-black font-bold', byId('weight'), '')).toBe('relative bg-black')
  })
  it('does not confuse size with alignment or colour (both text-*)', () => {
    // Changing size must leave text-center (align) and text-flash-1 (colour) untouched.
    const out = applyStyleValue('text-center text-flash-1 text-2xl', byId('size'), 'text-5xl')
    expect(out.split(/\s+/).sort()).toEqual(['text-5xl', 'text-center', 'text-flash-1'])
  })
  it('toggles on and off — and a legacy class comes OFF under the token-era control', () => {
    expect(applyStyleValue('relative', byId('italic'), 'on')).toBe('relative fstyle-[italic]')
    expect(applyStyleValue('relative fstyle-[italic]', byId('italic'), '')).toBe('relative')
    // Half the stored strings still say `italic`; the control must clear that shape too.
    expect(applyStyleValue('relative italic', byId('italic'), '')).toBe('relative')
    expect(readStyleValue(byId('italic'), 'relative italic')).toBe('on')
  })
  it('swaps a font family without touching the weight', () => {
    const out = applyStyleValue('font-momo font-bold', byId('font'), 'font-display')
    expect(out.split(/\s+/).sort()).toEqual(['font-bold', 'font-display'])
  })
})

describe('slider seeding round-trips (skeen brief 2026-08-03)', () => {
  // A stored row like `scale-145 opacity-60 border-[4px] shadow-sm` was reported seeding
  // every slider at its MAX. Whatever parses a stored string back into slider positions
  // must round-trip, and an unparseable token must land on the DEFAULT step, never max.
  const sliderIdx = (control: StyleControl, cls: string): number => {
    if (control.kind !== 'slider') throw new Error('not a slider')
    const current = readStyleValue(control, cls)
    let idx = control.steps.findIndex((s) => s.value === current)
    if (idx < 0) idx = control.steps.findIndex((s) => s.value === '')
    return idx < 0 ? 0 : idx
  }

  it('the reported string seeds each item slider at its own stored value', () => {
    const cls = 'scale-145 opacity-60 border-[4px] shadow-sm'
    const byId = Object.fromEntries(buildItemStyleControls().map((c) => [c.id, c]))
    expect(byId.size.kind === 'slider' && byId.size.steps[sliderIdx(byId.size, cls)].label).toBe('145%')
    expect(byId.opacity.kind === 'slider' && byId.opacity.steps[sliderIdx(byId.opacity, cls)].label).toBe('60%')
    expect(byId.borderWidth.kind === 'slider' && byId.borderWidth.steps[sliderIdx(byId.borderWidth, cls)].label).toBe('4px')
    expect(byId.shadow.kind === 'slider' && byId.shadow.steps[sliderIdx(byId.shadow, cls)].label).toBe('XS')
    // No rounded token stored → Corners sits on its default (Square), NOT Circle.
    expect(byId.radius.kind === 'slider' && byId.radius.steps[sliderIdx(byId.radius, cls)].label).toBe('Square')
  })

  it('every slider step round-trips: applying a step then reading it lands on that step', () => {
    const all = [...buildItemStyleControls(), ...buildVideoItemStyleControls('embed'), ...buildVideoItemStyleControls('file')]
    for (const control of all) {
      if (control.kind !== 'slider') continue
      for (const step of control.steps) {
        const applied = applyStyleValue('', control, step.value)
        expect(sliderIdx(control, applied)).toBe(control.steps.findIndex((s) => s.value === step.value))
      }
    }
  })

  it('an off-scale or unparseable owned token seeds the DEFAULT step', () => {
    const byId = Object.fromEntries(buildItemStyleControls().map((c) => [c.id, c]))
    // scale-37 is owned (scale-*) but not a step; opacity-33 likewise. Each must land on
    // its default. (For opacity the default 100% IS the right end — that's the one
    // control whose default legitimately sits at max.)
    for (const [id, cls] of [['size', 'scale-37'], ['opacity', 'opacity-33'], ['radius', 'rounded-[999px]']] as const) {
      const c = byId[id]
      if (c.kind !== 'slider') throw new Error('not a slider')
      expect(sliderIdx(c, cls)).toBe(c.steps.findIndex((s) => s.value === ''))
    }
    // For the size scale specifically, default is the middle (100%) — never the max.
    const size = byId.size
    if (size.kind !== 'slider') throw new Error('not a slider')
    expect(sliderIdx(size, 'scale-37')).not.toBe(size.steps.length - 1)
  })
})

describe('withUploadedFonts — Brand-page uploads join the manifest dropdown', () => {
  const uploaded = [{ family: 'archivo-narrow', label: 'Archivo Narrow' }]

  it('CRITICAL: an uploaded font creates the font control even when the manifest offers none', () => {
    // Built-in templates declare no font tokens, so without this the dropdown never
    // exists and "per-region overrides" is a feature with no UI.
    const opts = withUploadedFonts(undefined, uploaded)
    const font = buildStyleControls(opts).find((c) => c.id === 'font')
    expect(font?.kind).toBe('select')
    if (font?.kind !== 'select') throw new Error('no font control')
    // An uploaded font is offered as a VALUE token now (the 2026-08-16 migration): the
    // stack it resolves to is known — `fontStyleCss` wrote it — so the editor sets
    // `--lse-font` rather than relying on the class. Pinned by LABEL plus the family
    // inside the token, since the token shape is what changed.
    const offered = font.options.find((o) => o.label === 'Archivo Narrow')
    expect(offered?.value).toBe("fontfam-[archivo-narrow,sans-serif]")
  })

  it("manifest tokens keep list precedence — they are the site's own design", () => {
    const opts = withUploadedFonts({ fonts: [{ value: 'font-momo', label: 'Momo' }] }, uploaded)
    expect(opts?.fonts?.map((f) => f.value)).toEqual(['font-momo', 'font-archivo-narrow'])
  })

  it('dedupes by token, so a manifest that already compiled the family wins', () => {
    const opts = withUploadedFonts(
      { fonts: [{ value: 'font-archivo-narrow', label: 'Compiled Archivo' }] },
      uploaded,
    )
    expect(opts?.fonts).toHaveLength(1)
    expect(opts?.fonts?.[0].label).toBe('Compiled Archivo')
  })

  it('no uploads returns the manifest options untouched (same reference)', () => {
    const manifest = { fonts: [{ value: 'font-momo', label: 'Momo' }] }
    expect(withUploadedFonts(manifest, [])).toBe(manifest)
    expect(withUploadedFonts(undefined, [])).toBeUndefined()
  })
})

describe('text size is FLUID — it shrinks on a phone', () => {
  const sizeControl = () => {
    const c = buildTextItemStyleControls({ fonts: [] }).find((x) => x.id === 'size')!
    if (c.kind !== 'slider') throw new Error('size must be a slider')
    return c
  }

  /**
   * The step's value is now a VALUE token (`size-[48px]`), not a class — the CSS-variable
   * migration of 2026-08-16. The fluidity these tests exist to protect moved with it,
   * into `sizeLength`, so they resolve each step the way the bridge does and go on
   * asserting the same properties about what actually renders. Pinning the token string
   * instead would be a test that passes while every headline is fixed-size again.
   */
  const stepCss = (value: string) => sizeLength(Number(/^size-\[(\d+)px\]$/.exec(value)![1]))

  it('CRITICAL: every step scales with the viewport', () => {
    // A fixed `text-4xl` is 2.25rem at every width, so a caption sized on a desktop
    // preview runs off the edge of a phone — which is exactly what happened to the
    // polaroid captions. clamp() makes one choice mean "this big at most, smaller when
    // there is less room".
    for (const step of sizeControl().steps) {
      if (step.value === '') continue // the site's own default, not ours to define
      expect(step.value, 'a step must be a value token').toMatch(/^size-\[\d+px\]$/)
      expect(stepCss(step.value), step.value).toMatch(/^clamp\(/)
    }
  })

  it('CRITICAL: the DESKTOP size is unchanged, so nothing already set moves', () => {
    // The max of each clamp is the old fixed size. Only the small end is new: an
    // existing site keeps its look on a laptop and stops overflowing on a phone.
    //
    // The DISPLAY steps above 8rem (added 2026-08-05, so skeen's 11rem hero has somewhere
    // to go) are deliberately NOT in this list. This test's whole subject is the thirteen
    // sizes that replaced Tailwind's named scale, one for one — asserting they still line
    // up with `text-xs … text-9xl`. Steps that never had a fixed-size ancestor cannot
    // move anything already set, so pinning them here would only make the assertion say
    // two things at once.
    const maxima = sizeControl()
      .steps.filter((s) => s.value)
      .map((s) => String(clampMaxRem(stepCss(s.value))))
    const LEGACY = ['0.75', '0.875', '1', '1.125', '1.25', '1.5', '1.875', '2.25', '3', '3.75', '4.5', '6', '8']
    expect(maxima.slice(0, LEGACY.length)).toEqual(LEGACY)
    // …and they are the START of the scale, not scattered through it.
    expect(maxima.slice(LEGACY.length).every((m) => Number(m) > 8)).toBe(true)
  })

  it('every step is smaller at its minimum than at its maximum', () => {
    for (const step of sizeControl().steps) {
      if (!step.value) continue
      const m = stepCss(step.value).match(/clamp\(([\d.]+)(?:rem|px),\s*[\d.]+vw,\s*([\d.]+)(?:rem|px)\)/)
      expect(m, step.value).not.toBeNull()
      expect(Number(m![1])).toBeLessThan(Number(m![2]))
    }
  })

  it('the scale ascends, so dragging right always means bigger', () => {
    const maxima = sizeControl()
      .steps.filter((s) => s.value)
      .map((s) => clampMaxRem(stepCss(s.value)))
    for (let i = 1; i < maxima.length; i++) expect(maxima[i]).toBeGreaterThan(maxima[i - 1])
  })

  it('CRITICAL: still owns a legacy fixed size, so stored values are replaced not doubled', () => {
    // Sites already store `text-4xl`. If the control stopped recognising it, setting a
    // new size would APPEND the clamp and leave the old class behind — two font sizes
    // on one element, and which wins is source order.
    const c = sizeControl()
    expect(c.owns('text-4xl')).toBe(true)
    expect(c.owns('text-[clamp(1.5rem,5.2vw,2.25rem)]')).toBe(true)
    expect(c.owns('size-[48px]')).toBe(true)
    // Not a colour or an alignment that happens to share the prefix.
    expect(c.owns('text-center')).toBe(false)
    expect(c.owns('text-foreground')).toBe(false)
  })
})

describe('every slider is internally consistent — derived from the builders, never hand-listed', () => {
  // AGENTS.md rule 4 applied to the control registry itself: iterate what the builders
  // actually emit, so a family added tomorrow is checked the moment it exists. Kills the
  // mutant class Stryker found clustering here (2026-08-11): a swapped regex, a wrong
  // rank parse, or a reordered steps array all break one of these invariants.
  const sliderSteps = (c: StyleControl) => (c.kind === 'slider' ? c.steps : [])
  const surfaces: [string, StyleControl[]][] = [
    ['image', buildItemStyleControls()],
    ['embed', buildVideoItemStyleControls('embed')],
    ['file', buildVideoItemStyleControls('file')],
    ['textItem', buildTextItemStyleControls(PALETTE)],
    ['section', buildStyleControls(PALETTE)],
  ]

  it('CRITICAL: each slider OWNS every one of its own step values', () => {
    for (const [surface, controls] of surfaces) {
      for (const c of controls) {
        if (c.kind !== 'slider') continue
        for (const step of sliderSteps(c)) {
          if (step.value === '') continue
          expect(c.owns(step.value), `${surface}/${c.id} should own ${step.value}`).toBe(true)
        }
      }
    }
  })

  it('CRITICAL: no step value is claimed by TWO controls on one surface', () => {
    // Two owners corrupt each other on write: each strips the other's token as "its own
    // old value" when the manager moves either slider.
    for (const [surface, controls] of surfaces) {
      for (const c of controls) {
        if (c.kind !== 'slider') continue
        for (const step of sliderSteps(c)) {
          if (step.value === '') continue
          const owners = controls.filter((o) => o.owns(step.value)).map((o) => o.id)
          expect(owners, `${surface}: ${step.value}`).toEqual([c.id])
        }
      }
    }
  })

  it('CRITICAL: rank is defined and strictly increasing along each slider', () => {
    // The rank maps a stored token back to a thumb position; non-monotonic rank makes
    // the slider jump backwards as the manager drags forwards.
    for (const [surface, controls] of surfaces) {
      for (const c of controls) {
        if (c.kind !== 'slider' || !c.rank) continue
        let prev: number | null = null
        for (const step of sliderSteps(c)) {
          if (step.value === '' && c.defaultOffScale) continue
          const r = c.rank(step.value)
          expect(r, `${surface}/${c.id} rank(${step.value || "''"})`).not.toBeNull()
          if (prev != null) expect(r!, `${surface}/${c.id} monotonic at ${step.value}`).toBeGreaterThan(prev)
          prev = r
        }
      }
    }
  })
})

describe('the line dressing implies a line (2026-08-11)', () => {
  // Sam: "Line distance and line thickness aren't working." They were — on a line that
  // was not there. text-decoration-thickness with no text-decoration-line draws
  // nothing, so dragging either slider with both toggles off did nothing visible.
  // Writing any dressing now switches Underline on unless a line already exists.
  const textControls = buildTextItemStyleControls(PALETTE)
  const byId = (id: string) => {
    const c = textControls.find((x) => x.id === id)
    if (!c) throw new Error(id)
    return c
  }

  it('CRITICAL: setting thickness with no line turns underline on', () => {
    const next = applyStyleValue('font-serif', byId('decoThickness'), 'decothick-[4px]')
    expect(next.split(/\s+/)).toContain('underline')
    expect(next.split(/\s+/)).toContain('decothick-[4px]')
  })

  it('CRITICAL: so does the line COLOR — all three dressings imply, not just two', () => {
    // A single-element removal from DRESSING survives both the sibling tests and
    // Stryker's whole-array mutant, so each dressing pins its own membership.
    const next = applyStyleValue('font-serif', byId('decoColor'), 'decocolor-[#ff0000]')
    expect(next.split(/\s+/)).toContain('underline')
  })

  it('a line already present is kept, not doubled — strikethrough stays strikethrough', () => {
    const next = applyStyleValue('line-through', byId('decoOffset'), 'underoffset-[6px]')
    const tokens = next.split(/\s+/)
    expect(tokens).toContain('line-through')
    expect(tokens).not.toContain('underline')
  })

  it('clearing the dressing never removes the line itself', () => {
    const next = applyStyleValue('underline decothick-[4px]', byId('decoThickness'), '')
    expect(next.split(/\s+/)).toContain('underline')
    expect(next).not.toContain('decothick')
  })

  it('CRITICAL: turning the LAST line off sweeps the dressing with it', () => {
    // The mirror rule. Without it, toggling Underline off leaves dead decothick/
    // decocolor tokens stored, and the sliders are back to "not working" — the exact
    // symptom the implication fixed, one toggle away (review, 2026-08-11).
    const next = applyStyleValue('font-serif underline decothick-[4px] decocolor-[#ff0000]', byId('underline'), '')
    expect(next).not.toContain('decothick')
    expect(next).not.toContain('decocolor')
    expect(next.split(/\s+/)).toContain('font-serif')
  })

  it('switching line KINDS keeps the dressing — only losing the last line sweeps', () => {
    const next = applyStyleValue('underline line-through decothick-[4px]', byId('underline'), '')
    expect(next.split(/\s+/)).toContain('line-through')
    expect(next.split(/\s+/)).toContain('decothick-[4px]')
  })
})

describe('the dressing sliders park OFF-SCALE at their browser defaults (2026-08-17)', () => {
  // v1 centred a literal Auto step; v2 removes it: Auto is the off-scale default, the
  // same shape as every measuring slider, and the scales themselves shrank — whole
  // pixels only for thickness (browsers round text-decoration-thickness, so sub-pixel
  // steps moved the handle without moving the line), and -3..12 for the Y position
  // ("users aren't going to slide it high up where it's cut off by the lettering").
  const text = buildTextItemStyleControls(PALETTE)
  it('thickness: whole-px scale, unset rests at Default, a stored px parks exactly', () => {
    const c = text.find((x) => x.id === 'decoThickness')!
    if (c.kind !== 'slider') throw new Error('unreachable')
    const steps = sliderSteps(c)
    // Whole pixels only: browsers round text-decoration-thickness, so the old
    // sub-pixel steps moved the handle without moving the line.
    expect(steps.every((s) => /^decothick-\[\d+px\]$/.test(s.value))).toBe(true)
    const unset = sliderIndex(c, '')
    expect(unset.exact).toBe(false)
    expect(unset.label).toBe('Default')
    const stored = sliderIndex(c, 'decothick-[4px]')
    expect(steps[stored.idx].label).toBe('4px')
    expect(stored.exact).toBe(true)
  })
  it('Y position: barely up, plenty down, unset parks at 0', () => {
    const c = text.find((x) => x.id === 'decoOffset')!
    if (c.kind !== 'slider') throw new Error('unreachable')
    const steps = sliderSteps(c)
    expect(c.rank!(steps[0].value)).toBe(-3)
    expect(c.rank!(steps[steps.length - 1].value)).toBe(12)
    const stored = sliderIndex(c, 'underoffset-[4px]')
    expect(steps[stored.idx].label).toBe('4px')
  })
})

describe('Font color in the text-field editor (2026-08-11)', () => {
  // Sam: "I would rather just add an option to change the color of the font" — the
  // gradient pair left these surfaces for it. The swatch row is siteSwatches at the
  // render site; this pins the control itself: read and write over text-[#hex].
  const control = buildTextItemStyleControls(PALETTE).find((c) => c.id === 'textColor')

  it('CRITICAL: round-trips a hex through the stored string', () => {
    if (!control || control.kind !== 'color') throw new Error('textColor should be a color control')
    const written = applyStyleValue('font-serif underline', control, control.toToken!('#9c4221', ''))
    expect(written.split(/\s+/)).toContain('text-[#9c4221]')
    expect(control.hexOf!(written)).toBe('#9c4221')
    // Clearing removes the colour and nothing else.
    const cleared = applyStyleValue(written, control, '')
    expect(cleared.split(/\s+/).sort()).toEqual(['font-serif', 'underline'])
  })

  it('the gradient pair is gone from BOTH text surfaces', () => {
    for (const controls of [buildTextItemStyleControls(PALETTE), buildStyleControls(PALETTE)]) {
      expect(controls.map((c) => c.id)).not.toContain('textgradFrom')
    }
  })
})
