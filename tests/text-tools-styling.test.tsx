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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { buildTextItemStyleControls } from '@/lib/site-editor/style-controls'
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

  it('styling reports the REGION key, preserving classes the controls do not own', () => {
    // The region already carries a colour this editor does not offer. Changing the size
    // must not drop it — each control replaces only its own utility.
    const onStyle = editor(styled, { hero_title: 'text-flash-2 font-bold' })
    // Size is a SLIDER: its value is a step INDEX. Derived from the real control rather
    // than hardcoded, so re-granulating the scale can't quietly make this test assert
    // some other size.
    const sizeControl = buildTextItemStyleControls(OPTIONS).find((c) => c.id === 'size')!
    const steps = sizeControl.kind === 'slider' ? sizeControl.steps : []
    const idx = steps.findIndex((s) => s.value === 'text-4xl')
    fireEvent.change(screen.getByLabelText('Hero title Size'), { target: { value: String(idx) } })

    expect(onStyle).toHaveBeenCalledTimes(1)
    const [regionKey, className] = onStyle.mock.calls[0] as unknown as string[]
    expect(regionKey).toBe('hero_title')
    expect(className).toContain('text-4xl')
    expect(className).toContain('text-flash-2')
    expect(className).toContain('font-bold')
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
