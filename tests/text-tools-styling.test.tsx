// @vitest-environment jsdom
/**
 * The Text panel is a LIST that types; one field opens full-panel behind Edit, exactly
 * like an image or a video slot. Font/Size/Boldness live in that editor.
 *
 * Two rules worth pinning. A field the site declares no style region for shows NO type
 * controls — controls that write to a key nothing renders are worse than none, because
 * the manager changes the font, nothing happens, and no error explains it. And the list
 * does not own the text: the editor is a second window onto the same field, so both read
 * the value the inspector holds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { buildTextItemStyleControls, sliderSteps } from '@/lib/site-editor/style-controls'
import { clampMaxRem } from './helpers/clamp'
import { TextTools } from '@/app/artists/[id]/(dashboard)/editor/panels/text-tools'
import { TextFieldEditor } from '@/app/artists/[id]/(dashboard)/editor/text-field-editor'
import type { EditorTextField } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveEditorFieldAction: vi.fn(async () => ({ ok: true })),
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
}))

afterEach(cleanup)

const styled: EditorTextField = {
  key: 'hero_title',
  label: 'Hero title',
  type: 'text',
  value: 'Skeen',
  multiline: false,
  styleRegion: { key: 'hero_title', label: 'Hero title' },
}
const unstyled: EditorTextField = {
  key: 'booking_email',
  label: 'Booking email',
  type: 'email',
  value: 'book@example.com',
  multiline: false,
  styleRegion: null,
}
const OPTIONS = { fonts: [{ value: 'font-momo', label: 'Momo' }] }

describe('TextTools — the list', () => {
  it('every field offers Edit, and carries no leading icon', () => {
    const onEditField = vi.fn()
    const { container } = render(
      <TextTools
        textFields={[styled, unstyled]}
        values={{ hero_title: 'Skeen', booking_email: 'book@example.com' }}
        status="idle"
        onEditField={onEditField}
      />,
    )
    fireEvent.click(screen.getByLabelText('Edit Hero title'))
    expect(onEditField).toHaveBeenCalledWith(styled)
    // One glyph per row down a column of text fields is noise the label already covers.
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('CRITICAL: the list is READ-ONLY — nothing here can change the site', () => {
    // Editing lives behind Edit, in one place. An input in the list is a second
    // authority over the same field and a way to alter a live site by brushing past a
    // textarea while scrolling the panel.
    const { container } = render(
      <TextTools
        textFields={[styled, unstyled]}
        values={{ hero_title: 'Skeen', booking_email: 'book@example.com' }}
        status="idle"
        onEditField={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0)
  })

  it('shows the current copy so the list is scannable, and says when a field is empty', () => {
    render(
      <TextTools
        textFields={[styled, unstyled]}
        values={{ hero_title: 'Typed elsewhere', booking_email: '' }}
        status="idle"
        onEditField={vi.fn()}
      />,
    )
    expect(screen.getByText('Typed elsewhere')).toBeTruthy()
    expect(screen.getByText('Empty')).toBeTruthy()
  })
})

describe('TextFieldEditor — one field, full panel', () => {
  const editor = (field: EditorTextField, styleValues: Record<string, string> = {}, onStyle = vi.fn()) => {
    render(
      <TextFieldEditor
        field={field}
        value={field.value}
        status="idle"
        styleValues={styleValues}
        styleOptions={OPTIONS}
        onEdit={vi.fn()}
        onStyle={onStyle}
        onBack={vi.fn()}
      />,
    )
    return onStyle
  }

  it('CRITICAL: a field with a style region gets Font, Size and Boldness', () => {
    editor(styled)
    expect(screen.getByLabelText('Hero title Font')).toBeTruthy()
    expect(screen.getByLabelText('Hero title Size')).toBeTruthy()
    expect(screen.getByLabelText('Hero title Thickness')).toBeTruthy()
  })

  it('CRITICAL: a field with NO region gets none — and SAYS so rather than showing nothing', () => {
    // Silence is indistinguishable from a broken panel. The manager has no other way to
    // learn the site never offered this text for styling.
    editor(unstyled)
    expect(screen.queryByLabelText(/Thickness$/)).toBeNull()
    expect(screen.queryByLabelText(/Font$/)).toBeNull()
    expect(screen.getByText(/hasn't made booking email styleable/i)).toBeTruthy()
    // Still editable — the field is just not styleable.
    expect(screen.getByDisplayValue('book@example.com')).toBeTruthy()
  })

  it('gives every text slider at least ten stops', () => {
    // The ask: "each one has like 5 or 6 locations to slide to, I would like double that".
    // A coarse scale is not just inconvenient — the value the manager wants often is not on
    // the slider at all.
    //
    // Nine, not ten, because Thickness tops out there: nine is EVERY Tailwind weight, and
    // going finer would mean arbitrary `font-[350]` values that only render on a variable
    // font and silently round everywhere else. It was four, so it still more than doubled.
    for (const c of buildTextItemStyleControls(OPTIONS)) {
      if (c.kind !== 'slider') continue
      expect(sliderSteps(c).length, `${c.id} stops`).toBeGreaterThanOrEqual(9)
    }
  })

  it('keeps every scale strictly ascending, with no duplicate values', () => {
    // A repeated or out-of-order step makes the handle jump or sit on two places at once.
    for (const c of buildTextItemStyleControls(OPTIONS)) {
      if (c.kind !== 'slider') continue
      const values = sliderSteps(c).map((s) => s.value)
      expect(new Set(values).size, `${c.id} duplicates`).toBe(values.length)
    }
  })

  it('offers Line spacing and Letter spacing, ascending, default off-scale', () => {
    // Sam could not touch either from the editor: the gap between stacked lines and
    // between letters was whatever the site declared, full stop.
    const controls = buildTextItemStyleControls(OPTIONS)
    for (const id of ['leading', 'tracking']) {
      const c = controls.find((x) => x.id === id)
      expect(c, id).toBeTruthy()
      const steps = sliderSteps(c!)
      expect(steps.some((s) => s.value === ''), `${id} default off-scale`).toBe(false)
      // Fine-grained: the coarse 5-6 stop scales were the complaint.
      expect(steps.length, `${id} stops`).toBeGreaterThanOrEqual(11)
    }
  })

  it('emits line spacing as !important, so a size class cannot re-loosen it', () => {
    // Tailwind's text-* utilities set font-size AND line-height together, so a plain
    // leading class loses to the Size the manager just picked. A site may also pin
    // line-height on a PARENT at higher specificity (skeen's polaroid strip does) to stop
    // a half-styled caption coming out loose. `!` beats both, which is the precedence a
    // manager expects from a control they just moved.
    const leading = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'leading')!
    for (const step of sliderSteps(leading))
      expect(step.value.startsWith('!leading-'), step.value).toBe(true)
  })

  it('recognises its own tokens, so changing one does not stack duplicates', () => {
    const controls = buildTextItemStyleControls(OPTIONS)
    const leading = controls.find((c) => c.id === 'leading')!
    const tracking = controls.find((c) => c.id === 'tracking')!
    expect(leading.owns('!leading-tight')).toBe(true)
    expect(leading.owns('leading-tight')).toBe(true) // a site-authored one, too
    expect(leading.owns('tracking-tight')).toBe(false)
    expect(tracking.owns('tracking-wide')).toBe(true)
    expect(tracking.owns('!leading-none')).toBe(false)
  })

  it('the size scale runs low → high, with the default OFF the scale', () => {
    // The bug: the `''` default was steps[0], so the slider's far-left position meant
    // "whatever the site already uses". For a region whose own size is large — skeen's
    // hero wordmark is text-[clamp(4rem,18vw,11rem)] — the handle started at the left
    // showing that, and the first nudge RIGHT dropped it to text-sm. Reported as
    // "I move them to the right and they get smaller", which is exactly what it did.
    const size = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!
    const steps = sliderSteps(size)
    expect(steps.some((s) => s.value === '')).toBe(false)
    // Ascending, and FINE: Sam asked for roughly double the stops so he can land between
    // the friendly five this used to offer.
    // Asserted as PROPERTIES, not as a copied ladder: the values became fluid clamps so
    // text shrinks on a phone, and a hand-listed expectation would have to be rewritten
    // every time the scale is retuned while proving nothing about the ordering that
    // actually matters.
    expect(steps.length).toBeGreaterThanOrEqual(13)
    const maxRem = steps.map((s) => clampMaxRem(s.value))
    for (let i = 1; i < maxRem.length; i++) expect(maxRem[i]).toBeGreaterThan(maxRem[i - 1])
  })

  it('an untouched slider sits MID-scale and reads Default, not at an end', () => {
    // Either end would be a lie about an unset control, and the left end was the one that
    // made dragging right look like shrinking.
    editor(styled, { hero_title: '' })
    const size = screen.getByLabelText('Hero title Size') as HTMLInputElement
    const steps = sliderSteps(buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!)
    expect(size.value).toBe(String(Math.floor((steps.length - 1) / 2)))
    // Scoped to the Size row: the Font <select> carries a "Default" option too, so a bare
    // getByText finds two and tells you nothing about this control.
    // Scoped to this slider's row: the Font <select> carries a "Default" option too, so a
    // bare getByText matches two and proves nothing about this control.
    expect(within(size.parentElement!).getByText('Default')).toBeTruthy()
  })

  it('CRITICAL: a region sized by the SITE opens beside its own size, not mid-scale', () => {
    // Sam, 2026-08-05: "the Skeen text slider starts in the middle, but when I move it one
    // to the right it gets much smaller." It did. This is skeen's real hero base, verbatim
    // from its lib/styles.ts — 11rem at desktop, above every step this editor offers. It
    // matched no step, so the handle rested mid-scale and one notch right wrote 2.25rem.
    //
    // Un-styled here: no stored override at all, so `cls` is purely the site's own base.
    // That is the ordinary case, not an edge one — every region opens this way the first
    // time a manager touches it.
    const heroBase = 'fx-glitch-mono font-alt text-[clamp(4rem,18vw,11rem)] font-black uppercase leading-none'
    editor({ ...styled, styleRegion: { key: 'hero_title', label: 'Hero title', base: heroBase } }, {})
    const steps = sliderSteps(buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!)
    const size = screen.getByLabelText('Hero title Size') as HTMLInputElement

    // Derived from the scale, not hardcoded: the step whose desktop max is the hero's own
    // 11rem. Hardcoding an index here would quietly become an assertion about some other
    // size the next time a step is added.
    const own = steps.findIndex((s) => /,\s*11rem\)\]$/.test(s.value))
    expect(size.value).toBe(String(own))
    // …and it must not still claim to be unset, which is what licensed the jump.
    expect(within(size.parentElement!).queryByText('Default')).toBeNull()
    // There must be somewhere ABOVE it to drag. The scale used to stop at 8rem, below the
    // hero itself, so every move was a shrink (Sam: "needs to be able to be a bigger size").
    expect(steps.length - 1 - own).toBeGreaterThanOrEqual(3)

    // The site's `leading-none` is our `!leading-none` — same 1.0, different string. It
    // used to miss too, opening the manager at 1.1 on a line already set to 1.0.
    const leadingSteps = sliderSteps(buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'leading')!)
    const leading = screen.getByLabelText('Hero title Line spacing') as HTMLInputElement
    expect(leadingSteps[Number(leading.value)].value).toBe('!leading-none')
  })

  it('offers Reset only once a size is actually set', () => {
    // Clearing used to be a hidden position at one end of the scale, which is how a drag
    // could blow the size away by accident. It is an explicit button now.
    //
    // Driven from the INITIAL styles rather than by dragging: this is a test about the
    // conditional, and going through a staged change would silently also be testing how
    // the harness propagates staged state back into `current`.
    editor(styled, { hero_title: '' })
    const unset = screen.getByLabelText('Hero title Size') as HTMLInputElement
    expect(within(unset.parentElement!).queryByText('Reset')).toBeNull()
    cleanup()

    const steps = sliderSteps(buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!)
    const mid = Math.floor(steps.length / 2)
    editor(styled, { hero_title: steps[mid].value })
    const set = screen.getByLabelText('Hero title Size') as HTMLInputElement
    expect(within(set.parentElement!).getByText('Reset')).toBeTruthy()
    // And the handle sits ON that value, not at an end.
    expect(set.value).toBe(String(mid))
  })

  it('styling reports the REGION key, preserving classes the controls do not own', () => {
    // The region already carries a colour this editor does not offer. Changing the size
    // must not drop it — each control replaces only its own utility.
    const onStyle = editor(styled, { hero_title: 'text-flash-2 font-bold' })
    // (the seed carries a colour and a weight the size control must not touch)
    // Size is a SLIDER: its value is a step INDEX. Derived from the real control rather
    // than hardcoded, so re-granulating the scale can't quietly make this test assert
    // some other size.
    const sizeControl = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!
    // sliderSteps, not .steps: the panel renders the scale WITHOUT the `''` default, so
    // indexing the raw list picked the size one step along from the intended one.
    // A step from the middle of the real scale, so retuning the values cannot silently
    // turn this into an assertion about some other size.
    // NOT the midpoint: an unset slider already rests there, so firing a change to it
    // is a no-op React never reports.
    const idx = sliderSteps(sizeControl).length - 2
    const sizeValue = sliderSteps(sizeControl)[idx].value
    fireEvent.change(screen.getByLabelText('Hero title Size'), { target: { value: String(idx) } })

    expect(onStyle).toHaveBeenCalledTimes(1)
    const [regionKey, className] = onStyle.mock.calls[0] as unknown as string[]
    expect(regionKey).toBe('hero_title')
    expect(className).toContain(sizeValue)
    expect(className).toContain('text-flash-2')
    expect(className).toContain('font-bold')
  })

  it('CRITICAL: a slider moves IMMEDIATELY, without waiting for the save to land', () => {
    // The lag this fixes: the control read its value from a prop the inspector only
    // refreshes on a 500ms debounce, so the text resized at once while the thumb sat
    // still and then jumped — which reads as the drag being ignored, so the manager
    // drags further and overshoots. The editor stages the change locally, exactly as
    // StyleTools and ItemEditor already do.
    editor(styled, { hero_title: '' })
    const size = screen.getByLabelText('Hero title Size') as HTMLInputElement
    const control = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!
    // sliderSteps, not control.steps: the panel renders the scale WITHOUT the `''`
    // default, so indexing the raw list was off by one against what is on screen.
    const target = String(sliderSteps(control).length - 2) // not the mid resting position

    fireEvent.change(size, { target: { value: target } })

    // Same tick, no re-render from above, no timers advanced.
    expect((screen.getByLabelText('Hero title Size') as HTMLInputElement).value).toBe(target)
  })

  it('staged changes survive moving a SECOND control', () => {
    // Two controls edit one class string. If the second read the stale prop instead of
    // what the first staged, changing the size and then the thickness would silently
    // discard the size.
    const onStyle = editor(styled, { hero_title: '' })
    const controls = buildTextItemStyleControls(OPTIONS)
    const sizeSteps = controls.find((c) => c.id === 'size')!
    const weightSteps = controls.find((c) => c.id === 'weight')!
    const sIdx = sliderSteps(sizeSteps).length - 2 // not the mid resting position
    const sVal = sliderSteps(sizeSteps)[sIdx].value
    const wIdx = sliderSteps(weightSteps).findIndex((s) => s.value === 'font-bold')

    fireEvent.change(screen.getByLabelText('Hero title Size'), { target: { value: String(sIdx) } })
    fireEvent.change(screen.getByLabelText('Hero title Thickness'), { target: { value: String(wIdx) } })

    const last = onStyle.mock.calls.at(-1) as unknown as string[]
    expect(last[1]).toContain(sVal)
    expect(last[1]).toContain('font-bold')
  })

  it('offers the site’s own fonts, so the dropdown is real classes not guesses', () => {
    editor(styled)
    const font = screen.getByLabelText('Hero title Font') as HTMLSelectElement
    expect([...font.options].map((o) => o.value)).toContain('font-momo')
  })

  it('a site with no font palette still gets Size and Boldness', () => {
    render(
      <TextFieldEditor
        field={styled}
        value="Skeen"
        status="idle"
        styleValues={{}}
        onEdit={vi.fn()}
        onStyle={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Hero title Font')).toBeNull()
    expect(screen.getByLabelText('Hero title Size')).toBeTruthy()
  })

  it('Back leaves the editor', () => {
    const onBack = vi.fn()
    render(
      <TextFieldEditor
        field={styled}
        value="Skeen"
        status="idle"
        styleValues={{}}
        onEdit={vi.fn()}
        onStyle={vi.fn()}
        onBack={onBack}
      />,
    )
    fireEvent.click(screen.getByLabelText('Back'))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('the site’s own fallback is visible, not just absent', () => {
  it('CRITICAL: an untouched field opens HOLDING the site’s words, editable', () => {
    // A custom site keeps its fallbacks in code, so a field with no stored row is empty
    // in the database while the page shows real words. Opening it to a blank box reads
    // as missing content — the manager is looking at "SKEEN" on screen and an empty
    // input in the panel.
    //
    // Was a PLACEHOLDER until 2026-08-09. Sam, on throwaway #1: "I want there to be
    // actual text here not just the placeholder text." A placeholder looked right and
    // could not be edited — changing one word meant retyping the sentence from memory.
    // Seeded for display only: `onEdit` stays unfired, so browsing a field writes no row.
    const onEdit = vi.fn()
    render(
      <TextFieldEditor
        field={{ ...styled, value: '', defaultValue: 'SKEEN' }}
        value=""
        status="idle"
        styleValues={{}}
        onEdit={onEdit}
        onStyle={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Hero title') as HTMLInputElement
    expect(input.value).toBe('SKEEN')
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('CRITICAL: switching fields re-seeds — one field’s default never lands under another’s key', () => {
    // 2026-08-09 review. The seed latches at MOUNT, and the editor is rendered without a
    // `key`, so clicking a different text region in the preview swaps `field` on the SAME
    // instance: the latch survived and field B rendered field A's default. Typing then
    // saved A's words under B's key. The mirror case is just as bad — after touching A,
    // B opened EMPTY and lost the feature entirely.
    //
    // Deliberately rendered with NO React `key`: a key would remount and reset the latch,
    // which pins React's behaviour rather than this component's. The seed must re-derive
    // from `field.key` itself, so the parent cannot get it wrong.
    const { rerender } = render(
      <TextFieldEditor
        field={{ ...styled, key: 'hero_title', label: 'Hero title', value: '', defaultValue: 'AAA-default' }}
        value=""
        status="idle"
        styleValues={{}}
        onEdit={vi.fn()}
        onStyle={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect((screen.getByLabelText('Hero title') as HTMLInputElement).value).toBe('AAA-default')

    rerender(
      <TextFieldEditor
        field={{ ...styled, key: 'tour_heading', label: 'Tour heading', value: '', defaultValue: 'BBB-default' }}
        value=""
        status="idle"
        styleValues={{}}
        onEdit={vi.fn()}
        onStyle={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect((screen.getByLabelText('Tour heading') as HTMLInputElement).value).toBe('BBB-default')
  })

  it('a stored value wins over the seeded default', () => {
    render(
      <TextFieldEditor
        field={{ ...styled, defaultValue: 'SKEEN' }}
        value="Skeen Live"
        status="idle"
        styleValues={{}}
        onEdit={vi.fn()}
        onStyle={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('Skeen Live')).toBeTruthy()
  })
})

describe('CRITICAL: styling a region must not destroy the site’s own classes', () => {
  // A section override REPLACES the base string (SITE_STYLING_PLAN D-B). So an editor
  // that seeds from '' turns "set a size" into "delete everything this element had".
  //
  // This is not theoretical. Sam set a size on the hero wordmark and the word SKEEN
  // VANISHED: the base carried `fx-glitch-mono`, whose effect paints the visible text
  // from data-text, and the override wiped it. The polaroid captions lost the classes
  // that kept them inside the strip at the same time.
  const HERO_BASE = 'fx-glitch-mono font-alt text-[clamp(4rem,18vw,11rem)] font-black uppercase leading-none'
  const withBase: EditorTextField = {
    ...styled,
    label: 'Hero wordmark',
    styleRegion: { key: 'hero_wordmark', label: 'Hero wordmark', base: HERO_BASE },
  }

  it('seeds from the region’s BASE, so an untouched region keeps every class', () => {
    const onStyle = vi.fn()
    render(
      <TextFieldEditor
        field={withBase}
        value="SKEEN"
        status="idle"
        styleValues={{}}
        styleOptions={OPTIONS}
        onEdit={vi.fn()}
        onStyle={onStyle}
        onBack={vi.fn()}
      />,
    )
    const control = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!
    fireEvent.change(screen.getByLabelText('Hero wordmark Size'), {
      target: { value: String(sliderSteps(control).length - 2) },
    })

    const [, className] = onStyle.mock.calls[0] as unknown as string[]
    // Everything the size control does NOT own survives.
    expect(className).toContain('fx-glitch-mono')
    expect(className).toContain('font-alt')
    expect(className).toContain('font-black')
    expect(className).toContain('uppercase')
    expect(className).toContain('leading-none')
    // And the size it DOES own was swapped, not appended.
    expect(className).not.toContain('clamp(4rem,18vw,11rem)')
  })

  it('a STORED override wins over the base — the manager’s work is not re-seeded away', () => {
    const onStyle = vi.fn()
    render(
      <TextFieldEditor
        field={withBase}
        value="SKEEN"
        status="idle"
        styleValues={{ hero_wordmark: 'fx-glitch-mono font-alt uppercase text-[clamp(1rem,3vw,1.25rem)]' }}
        styleOptions={OPTIONS}
        onEdit={vi.fn()}
        onStyle={onStyle}
        onBack={vi.fn()}
      />,
    )
    const control = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'weight')!
    fireEvent.change(screen.getByLabelText('Hero wordmark Thickness'), {
      target: { value: String(sliderSteps(control).length - 1) },
    })
    const [, className] = onStyle.mock.calls[0] as unknown as string[]
    // The stored size is kept; the base's original size does not come back.
    expect(className).toContain('clamp(1rem,3vw,1.25rem)')
    expect(className).not.toContain('clamp(4rem,18vw,11rem)')
  })
})

describe('Reset on a section region restores the SITE’S value, not nothing', () => {
  const HERO_BASE = 'fx-glitch-mono font-alt text-[clamp(4rem,18vw,11rem)] uppercase leading-none'
  const heroField: EditorTextField = {
    ...styled,
    label: 'Hero wordmark',
    styleRegion: { key: 'hero_wordmark', label: 'Hero wordmark', base: HERO_BASE },
  }

  it('CRITICAL: clearing size puts the base’s size back, not no size at all', () => {
    // The live failure: Reset stored `fx-glitch-mono leading-none uppercase font-alt`
    // with NO size. A section override replaces the base, so the element ended up with
    // no font-size rule and rendered at inherited body size — the hero wordmark shrank
    // to a speck.
    const onStyle = vi.fn()
    render(
      <TextFieldEditor
        field={heroField}
        value="SKEEN"
        status="idle"
        styleValues={{
          // The base with its size SWAPPED for a real step — one size token, as the
          // editor itself would produce.
          hero_wordmark: HERO_BASE.replace(
            'text-[clamp(4rem,18vw,11rem)]',
            sliderSteps(buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!)[1].value,
          ),
        }}
        styleOptions={OPTIONS}
        onEdit={vi.fn()}
        onStyle={onStyle}
        onBack={vi.fn()}
      />,
    )
    const size = screen.getByLabelText('Hero wordmark Size') as HTMLInputElement
    fireEvent.click(within(size.parentElement!).getByText('Reset'))

    // Reset rebuilds the base exactly, so the override is DELETED ('') and the site's
    // own classes apply — size included. The failure this pins is the other outcome:
    // storing a sizeless string, which replaces the base and leaves the element with no
    // font-size rule at all.
    const [, className] = onStyle.mock.calls.at(-1) as unknown as string[]
    expect(className).toBe('')
  })
})
