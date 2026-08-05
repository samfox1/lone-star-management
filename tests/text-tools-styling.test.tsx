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
        onEdit={vi.fn()}
        onEditField={onEditField}
      />,
    )
    fireEvent.click(screen.getByLabelText('Edit Hero title'))
    expect(onEditField).toHaveBeenCalledWith(styled)
    // One glyph per row down a column of text fields is noise the label already covers.
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('renders the values it is GIVEN — it does not hold its own copy', () => {
    // Two windows onto one field: if the list kept its own state, opening Edit after
    // typing would show stale text and both copies would race the debounced save.
    render(
      <TextTools
        textFields={[styled]}
        values={{ hero_title: 'Typed elsewhere' }}
        status="idle"
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('Typed elsewhere')).toBeTruthy()
  })

  it('typing reports up rather than saving itself', () => {
    const onEdit = vi.fn()
    render(
      <TextTools textFields={[styled]} values={{ hero_title: 'Skeen' }} status="idle" onEdit={onEdit} />,
    )
    fireEvent.change(screen.getByLabelText('Hero title'), { target: { value: 'Skeen Live' } })
    expect(onEdit).toHaveBeenCalledWith('hero_title', 'Skeen Live')
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
    expect(screen.getByLabelText('Hero title Boldness')).toBeTruthy()
  })

  it('CRITICAL: a field with NO region gets none — not controls that write nowhere', () => {
    editor(unstyled)
    expect(screen.queryByLabelText(/Boldness$/)).toBeNull()
    expect(screen.queryByLabelText(/Font$/)).toBeNull()
    // Still editable — the field is just not styleable.
    expect(screen.getByDisplayValue('book@example.com')).toBeTruthy()
  })

  it('styling reports the REGION key, preserving classes the controls do not own', () => {
    // The region already carries a colour this editor does not offer. Changing the size
    // must not drop it — each control replaces only its own utility.
    const onStyle = editor(styled, { hero_title: 'text-flash-2 font-bold' })
    fireEvent.change(screen.getByLabelText('Hero title Size'), { target: { value: 'text-4xl' } })

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
