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

  it('offers Line spacing and Letter spacing, ascending, default off-scale', () => {
    // Sam could not touch either from the editor: the gap between stacked lines and
    // between letters was whatever the site declared, full stop.
    const controls = buildTextItemStyleControls(OPTIONS)
    for (const id of ['leading', 'tracking']) {
      const c = controls.find((x) => x.id === id)
      expect(c, id).toBeTruthy()
      const steps = sliderSteps(c!)
      expect(steps.some((s) => s.value === ''), `${id} default off-scale`).toBe(false)
      expect(steps.length).toBeGreaterThan(2)
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
    expect(steps.map((s) => s.value)).toEqual([
      'text-sm',
      'text-lg',
      'text-2xl',
      'text-4xl',
      'text-6xl',
    ])
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

    editor(styled, { hero_title: 'text-2xl' })
    const set = screen.getByLabelText('Hero title Size') as HTMLInputElement
    expect(within(set.parentElement!).getByText('Reset')).toBeTruthy()
    // And the handle sits ON that value, not at an end.
    const steps = sliderSteps(buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!)
    expect(set.value).toBe(String(steps.findIndex((s) => s.value === 'text-2xl')))
  })

  it('styling reports the REGION key, preserving classes the controls do not own', () => {
    // The region already carries a colour this editor does not offer. Changing the size
    // must not drop it — each control replaces only its own utility.
    const onStyle = editor(styled, { hero_title: 'text-flash-2 font-bold' })
    // Size is a SLIDER: its value is a step INDEX. Derived from the real control rather
    // than hardcoded, so re-granulating the scale can't quietly make this test assert
    // some other size.
    const sizeControl = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!
    // sliderSteps, not .steps: the panel renders the scale WITHOUT the `''` default, so
    // indexing the raw list picked the size one step along from the intended one.
    const idx = sliderSteps(sizeControl).findIndex((s) => s.value === 'text-4xl')
    fireEvent.change(screen.getByLabelText('Hero title Size'), { target: { value: String(idx) } })

    expect(onStyle).toHaveBeenCalledTimes(1)
    const [regionKey, className] = onStyle.mock.calls[0] as unknown as string[]
    expect(regionKey).toBe('hero_title')
    expect(className).toContain('text-4xl')
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
    const target = String(sliderSteps(control).findIndex((s) => s.value === 'text-4xl'))

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
    const sIdx = sliderSteps(sizeSteps).findIndex((s) => s.value === 'text-4xl')
    const wIdx = sliderSteps(weightSteps).findIndex((s) => s.value === 'font-bold')

    fireEvent.change(screen.getByLabelText('Hero title Size'), { target: { value: String(sIdx) } })
    fireEvent.change(screen.getByLabelText('Hero title Thickness'), { target: { value: String(wIdx) } })

    const last = onStyle.mock.calls.at(-1) as unknown as string[]
    expect(last[1]).toContain('text-4xl')
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
