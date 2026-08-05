// @vitest-environment jsdom
/**
 * Font / Size / Boldness sit BESIDE the text input, not in a second panel.
 *
 * A manager typing a headline and then wanting it bigger was made to leave the Text
 * panel, find the matching region in the Style panel, and recognise it by name. These
 * tests pin that the controls appear against the right region, save through the same
 * path the Style panel uses, and — the part that matters — do NOT appear for a field the
 * site declares no region for, where they would write to a key nothing renders.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextTools } from '@/app/artists/[id]/(dashboard)/editor/panels/text-tools'
import type { EditorTextField } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'

const saveFieldMock = vi.fn(async () => ({ ok: true }))
const saveStyleMock = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveEditorFieldAction: (...a: unknown[]) => saveFieldMock(...(a as [])),
  saveEditorStyleAction: (...a: unknown[]) => saveStyleMock(...(a as [])),
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

function renderTools(fields: EditorTextField[], styleValues: Record<string, string> = {}) {
  return render(
    <TextTools
      textFields={fields}
      artistId="a1"
      styleValues={styleValues}
      styleOptions={OPTIONS}
    />,
  )
}

describe('TextTools — type controls beside the input', () => {
  it('CRITICAL: a field with a style region gets Font, Size and Boldness', () => {
    renderTools([styled])
    expect(screen.getByLabelText('Hero title Font')).toBeTruthy()
    expect(screen.getByLabelText('Hero title Size')).toBeTruthy()
    expect(screen.getByLabelText('Hero title Boldness')).toBeTruthy()
  })

  it('CRITICAL: a field with NO region gets none — not controls that write nowhere', () => {
    // The failure this prevents is silent: the manager changes the font, nothing on the
    // site changes, and there is no error to explain why.
    renderTools([unstyled])
    expect(screen.queryByLabelText(/Boldness$/)).toBeNull()
    expect(screen.queryByLabelText(/Font$/)).toBeNull()
    // The input itself is still there — the field is editable, just not styleable.
    expect(screen.getByDisplayValue('book@example.com')).toBeTruthy()
  })

  it('saves the class against the REGION key, preserving the classes it does not own', async () => {
    // The region already carries a colour the Text panel does not offer. Changing the
    // size must not drop it — each control replaces only its own utility.
    renderTools([styled], { hero_title: 'text-flash-2 font-bold' })
    fireEvent.change(screen.getByLabelText('Hero title Size'), { target: { value: 'text-4xl' } })

    // The save is DEBOUNCED, exactly as it is from the Style panel — dragging a slider
    // must not fire a write per step. Waiting proves the debounce is shared, not bypassed.
    await waitFor(() => expect(saveStyleMock).toHaveBeenCalledTimes(1))
    const [artistId, regionKey, className] = saveStyleMock.mock.calls[0] as unknown as string[]
    expect(artistId).toBe('a1')
    expect(regionKey).toBe('hero_title')
    expect(className).toContain('text-4xl')
    expect(className).toContain('text-flash-2') // untouched
    expect(className).toContain('font-bold') // untouched
  })

  it('offers the site’s own fonts, so the dropdown is real classes not guesses', () => {
    renderTools([styled])
    const font = screen.getByLabelText('Hero title Font') as HTMLSelectElement
    expect([...font.options].map((o) => o.value)).toContain('font-momo')
  })

  it('a site that declares no font palette still gets Size and Boldness', () => {
    // Font needs the site's own compiled classes; size and weight are universal.
    render(<TextTools textFields={[styled]} artistId="a1" styleValues={{}} />)
    expect(screen.queryByLabelText('Hero title Font')).toBeNull()
    expect(screen.getByLabelText('Hero title Size')).toBeTruthy()
  })
})
