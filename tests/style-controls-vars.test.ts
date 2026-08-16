/**
 * The EDITOR half of the CSS-variable migration (CONNECTING.md §5).
 *
 * Size and font were the two controls that hurt responsiveness most: both wrote a CLASS
 * into the stored string, and a section override replaces the base, so the site's own
 * `md:text-6xl` was simply gone. They now emit VALUE tokens (`size-[48px]`,
 * `fontfam-[…]`) that the bridge lifts onto `--lse-size` / `--lse-font`, which a site can
 * read and still shrink at a breakpoint.
 *
 * Two properties matter most here and are each pinned twice:
 *   - the migration MOVES NOTHING. A token's px must be the px its ladder step always
 *     rendered at, so every already-styled headline looks identical.
 *   - the controls own BOTH shapes. A region storing the old class must have it REMOVED
 *     when a new size is picked; owning only the new shape leaves two sizes on one
 *     element with source order arbitrating.
 */
import { describe, expect, it } from 'vitest'
import { TEXT_SIZES, sizeLength } from '@samfox1/site-bridge/styles'
import {
  applyStyleValue,
  buildStyleControls,
  buildTextItemStyleControls,
  readStyleValue,
  sliderIndex,
  sliderSteps,
  withStyleVars,
  withUploadedFonts,
  type SiteStyleOptions,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import { cleanClassText } from '@/lib/site-editor/save'
import { bridgeSupportsStyleVars } from '@/lib/site-editor/manifest'

const PALETTE: SiteStyleOptions = {
  fonts: [
    // A site mid-migration: one font declares what it resolves to, one does not.
    { value: 'font-momo', label: 'Momo', css: '"Momo Display", serif' },
    { value: 'font-display', label: 'Display' },
  ],
}

const byId = (controls: StyleControl[], id: string) =>
  controls.find((c) => c.id === id)!

const size = byId(buildStyleControls(PALETTE), 'size')
const font = byId(buildStyleControls(PALETTE), 'font')

describe('the size control emits variable tokens', () => {
  it('offers one token per ladder step, labelled as before', () => {
    const offered = size.kind === 'select' ? size.options : []
    // Derived from the ladder, never hand-listed — a step added upstream is covered here
    // the moment it lands (AGENTS.md rule 4).
    expect(offered.map((o) => o.label)).toEqual(['Default', ...TEXT_SIZES.map((o) => o.label)])
    for (const o of offered.slice(1)) expect(o.value).toMatch(/^size-\[\d+px\]$/)
  })

  it('moves nothing: each token renders the size its class always did', () => {
    const offered = (size.kind === 'select' ? size.options : []).slice(1)
    offered.forEach((o, i) => {
      const clamp = TEXT_SIZES[i].value.replace(/^text-\[/, '').replace(/\]$/, '')
      const px = Number(/^size-\[(\d+)px\]$/.exec(o.value)![1])
      expect(sizeLength(px)).toBe(clamp)
    })
  })

  it('removes a stored legacy class when a new size is picked', () => {
    // Owning only the new shape would leave BOTH on the element, with stylesheet order
    // deciding which wins — invisible until it isn't.
    const next = applyStyleValue('grid text-[clamp(1.5rem,5.2vw,2.25rem)]', size, 'size-[48px]')
    expect(next).toBe('grid size-[48px]')
  })

  it('removes a stored variable token too', () => {
    expect(applyStyleValue('grid size-[36px]', size, 'size-[48px]')).toBe('grid size-[48px]')
  })

  it('reads back a stored token, so the control opens on it', () => {
    expect(readStyleValue(size, 'grid size-[48px]')).toBe('size-[48px]')
    // And still reads a legacy class, which is what a not-yet-restyled region stores.
    expect(readStyleValue(size, 'grid text-4xl')).toBe('text-4xl')
  })

  it('places a variable token on the item slider, not at its resting position', () => {
    const itemSize = byId(buildTextItemStyleControls(PALETTE), 'size')
    const onLadder = sliderIndex(itemSize, 'size-[48px]')
    const resting = sliderIndex(itemSize, '')
    expect(onLadder.idx).not.toBe(resting.idx)
    expect(onLadder.label).toBe('48px')
  })

  it('ranks an off-ladder token, so a site base size still lands somewhere real', () => {
    const itemSize = byId(buildTextItemStyleControls(PALETTE), 'size')
    const near = sliderIndex(itemSize, 'size-[50px]')
    // Pinned against the STEP LIST, not against another sliderIndex call — two calls both
    // falling back to the resting position would satisfy an idx-equals-idx assertion
    // while measuring nothing at all.
    expect(near.idx).toBe(sliderSteps(itemSize).findIndex((s) => s.label === '48px'))
    expect(near.exact).toBe(false)
    expect(near.idx).not.toBe(sliderIndex(itemSize, '').idx)
  })

  it("writes a site's advertised scale VERBATIM — declaring it opts out", () => {
    // A site that declares `textSizes` has said exactly which classes it wants set, down
    // to each clamp's floor. Reinterpreting one as a px and re-deriving the clamp would
    // substitute the editor's judgement for the site's, which is the opposite of the
    // point. Omitting the declaration is how a site opts INTO the variable.
    const own = [
      { value: 'text-[clamp(0.9rem,2vw,1rem)]', label: 'Small' },
      { value: 'text-[42vmin]', label: 'Huge' },
    ]
    const control = byId(buildStyleControls({ textSizes: own }), 'size')
    const offered = control.kind === 'select' ? control.options : []
    expect(offered.map((o) => o.value)).toEqual(['', ...own.map((o) => o.value)])
  })
})

describe('a site whose bridge is too old keeps the classes', () => {
  // The deploy-order hazard: an older applier does not recognise `size-[48px]`, so it
  // would ride through to the class attribute as a dead class and the region would fall
  // back to its base size — a control that stops working with no error anywhere. So the
  // editor writes what the CONNECTED site can lift, not what it would prefer to write.
  const old = withStyleVars(PALETTE, bridgeSupportsStyleVars('0.15.0'))
  const oldControls = buildStyleControls(old)

  it('offers the class scale, not tokens', () => {
    const control = byId(oldControls, 'size')
    const offered = control.kind === 'select' ? control.options : []
    expect(offered[1].value).toBe(TEXT_SIZES[0].value)
    expect(offered.every((o) => !o.value.startsWith('size-['))).toBe(true)
  })

  it('offers the font class even though the site declared a stack', () => {
    const control = byId(oldControls, 'font')
    const offered = control.kind === 'select' ? control.options : []
    expect(offered.find((o) => o.label === 'Momo')!.value).toBe('font-momo')
  })

  it('still READS a token, so a value written before a downgrade is not orphaned', () => {
    expect(readStyleValue(byId(oldControls, 'size'), 'grid size-[48px]')).toBe('size-[48px]')
  })

  it('treats an unstamped site as too old — the safe direction', () => {
    // `bridgeOutdated` reads unknown as "not behind" to avoid false alarms. This gate
    // decides what gets WRITTEN, so it must read unknown the other way.
    expect(bridgeSupportsStyleVars(undefined)).toBe(false)
    expect(bridgeSupportsStyleVars('0.16.0')).toBe(true)
    expect(bridgeSupportsStyleVars('0.17.2')).toBe(true)
  })
})

describe('the font control follows the site', () => {
  it('emits a variable token for a font that declares what it resolves to', () => {
    const offered = font.kind === 'select' ? font.options : []
    expect(offered.find((o) => o.label === 'Momo')!.value).toBe('fontfam-[Momo_Display,_serif]')
  })

  it('keeps the class for a font that has not declared one', () => {
    // The editor cannot know what `font-display` resolves to, and inventing a stack would
    // silently replace the site's typeface with a guess. Backwards compatible by default;
    // a site migrates one declaration at a time.
    const offered = font.kind === 'select' ? font.options : []
    expect(offered.find((o) => o.label === 'Display')!.value).toBe('font-display')
  })

  it('owns both shapes, so switching between them replaces rather than stacks', () => {
    expect(applyStyleValue('grid font-display', font, 'fontfam-[Momo_Display,_serif]'))
      .toBe('grid fontfam-[Momo_Display,_serif]')
    expect(applyStyleValue('grid fontfam-[Momo_Display,_serif]', font, 'font-display'))
      .toBe('grid font-display')
  })

  it('never eats a weight', () => {
    // `font-bold` shares the prefix and belongs to the Boldness control.
    expect(applyStyleValue('grid font-bold', font, 'font-display')).toBe('grid font-bold font-display')
  })

  it('emits a token the save validator will actually store', () => {
    // The gap that produced "Not saved — that setting produced something the site can't
    // use": a control emitted a token `cleanClassText` refuses, and the failure surfaced
    // as an error message rather than as a test. Every offered value goes through it.
    const offered = [
      ...(size.kind === 'select' ? size.options : []),
      ...(font.kind === 'select' ? font.options : []),
    ]
    for (const o of offered) {
      expect(cleanClassText(`grid ${o.value}`), o.value).not.toBeNull()
    }
  })

  it('gives an uploaded font the stack its own stylesheet emits', () => {
    // fontStyleCss writes `.font-<family>{font-family:'<family>',sans-serif}` — the token
    // must resolve to that exact stack or picking the font changes how it looks.
    const opts = withUploadedFonts(undefined, [{ family: 'skeen-momo', label: 'Momo' }])
    expect(opts!.fonts![0].css).toBe("'skeen-momo',sans-serif")
  })
})
