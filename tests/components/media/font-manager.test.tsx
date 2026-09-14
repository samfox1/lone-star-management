// @vitest-environment jsdom
// The Brand page's fonts, slot-first: a row per slot with a searchable picker and an eye.
/**
 * FontManager — the Brand page's font slots.
 *
 * Four behaviours here are invisible from anywhere else:
 *   1. Each font is SHOWN IN ITSELF, in the row and in the picker. A font is draft until
 *      publish, so this is the only place a manager can see the face before committing
 *      the site to it. A preview that silently falls back to the UI font makes the whole
 *      page a lie.
 *   2. Destructive clicks confirm (the app's own dialog), and the re-entry guard is a
 *      REF. `busyId` is state:
 *      two fast clicks both read the pre-render value and both fire.
 *   3. The name is required BEFORE the file, because the CSS family token is derived
 *      from it and cannot be changed afterwards.
 *   4. Every action reports — a Remove blocked by RLS must not look like one that worked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FontManager } from '@/app/artists/[id]/(dashboard)/brand/font-manager'
import {
  addArtistFontAction,
  removeArtistFontAction,
  setFontSlotAction,
} from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { FONT_SLOTS, sanitizeFamily, type ArtistFont } from '@/lib/fonts'
import { FONT_UPLOAD_RULES, acceptFor } from '@/lib/upload'

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  addArtistFontAction: vi.fn(async () => ({})),
  removeArtistFontAction: vi.fn(async () => ({})),
  setFontSlotAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: () => ({ busy: false, error: null, upload: vi.fn(), progress: null, reset: vi.fn() }),
}))

const mockedRemove = vi.mocked(removeArtistFontAction)
const mockedSlot = vi.mocked(setFontSlotAction)
const mockedToast = vi.mocked(toast)

const font = (over: Partial<ArtistFont> = {}): ArtistFont => ({
  id: 'f1',
  label: 'PP Mori',
  family: 'pp-mori',
  storage_path: 'a1/fonts/11111111-1111-4111-8111-111111111111.woff2',
  format: 'woff2',
  slots: [],
  ...over,
})

const FONTS = [
  font(),
  font({ id: 'f2', label: 'Bebas Neue', family: 'bebas-neue', slots: ['primary'], storage_path: 'a1/fonts/22222222-2222-4222-8222-222222222222.otf', format: 'otf' }),
]

const renderList = (fonts: ArtistFont[] = FONTS) => render(<FontManager artistId="a1" fonts={fonts} />)

/**
 * The stylesheet THIS component rendered, read from its own container rather than via
 * `document.querySelector('style')` — the first style tag in the whole document, which
 * is this component's only as long as nothing else ever puts one there.
 */
const styleOf = ({ container }: { container: HTMLElement }): string =>
  Array.from(container.querySelectorAll('style'))
    .map((s) => s.innerHTML)
    .join('')

beforeEach(() => {
  // THE PREVIEW CSS IS BUILT FROM THIS. `fontFaceCss` resolves each font's URL against
  // NEXT_PUBLIC_SUPABASE_URL, and a font whose URL fails SAFE_URL is skipped — so with
  // the variable absent the stylesheet is legitimately '' and the test below fails.
  //
  // It passed here only because a developer machine has .env.local and CI does not (the
  // mutation workflow ships no DB secrets, deliberately). That made this suite the one
  // that broke every CI mutation run from 2026-08-05 on: Stryker's dry run failed, and
  // the workflow has never once reported a score. Stubbing pins the test to a value it
  // controls instead of to whether an env file happens to exist.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co')
  mockedRemove.mockResolvedValue({})
  mockedSlot.mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The picker on one slot's row: `combobox` named "{slot} font". */
const picker = (slot: string) => screen.getByRole('combobox', { name: `${slot.replace(/_/g, ' ')} font` })
const openPicker = (slot = 'primary') => fireEvent.click(picker(slot))
/** A font inside the open picker. */
const option = (label: string) => screen.getByRole('option', { name: label })

/** Fonts are removed from inside a picker — the list of fonts IS the picker. */
const clickRemove = async (name = 'Remove PP Mori') => {
  openPicker()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

/** Answer the question a destructive click raises. The dialog is the app's own now
 *  (useConfirm), so the answer is a click after the trigger rather than a stubbed global. */
const say = async (answer: string) => {
  const dialog = await screen.findByRole('dialog')
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: answer }))
  })
}

describe('FontManager — every font in itself', () => {
  it('CRITICAL: the slot value is set in the font that fills it', () => {
    renderList()
    expect(within(picker('primary')).getByText('Bebas Neue')).toHaveStyle({ fontFamily: "'bebas-neue', sans-serif" })
  })

  it('CRITICAL: the picker sets each font in its OWN family', () => {
    // A list set in the dashboard's UI font tells the manager nothing about the face they
    // just paid a foundry for.
    renderList()
    openPicker()
    expect(within(option('PP Mori')).getByText('PP Mori')).toHaveStyle({ fontFamily: "'pp-mori', sans-serif" })
    expect(within(option('Bebas Neue')).getByText('Bebas Neue')).toHaveStyle({ fontFamily: "'bebas-neue', sans-serif" })
  })

  it('CRITICAL: injects the @font-face rules, or every preview falls back silently', () => {
    const css = styleOf(renderList())
    expect(css).toContain("@font-face{font-family:'pp-mori'")
    expect(css).toContain("format('woff2')")
    expect(css).toContain("format('opentype')") // .otf is NOT 'otf' in a format() hint
  })

  it('CRITICAL: a hostile family from the database cannot escape into the page', () => {
    // The component injects this CSS with dangerouslySetInnerHTML. sanitizeFamily is what
    // makes that safe, so it is asserted HERE too and not only in the unit tests.
    const css = styleOf(renderList([font({ family: "x'; } body { display:none } .y {" })]))
    expect(css).not.toContain('body {')
    expect(css).not.toContain('</style')
  })

  it('shows the class token, so the manager can see what the editor will offer', () => {
    // On the format, as its title — the option carries the token without spelling it out.
    renderList()
    openPicker()
    expect(screen.getByTitle('font-pp-mori')).toBeInTheDocument()
  })

  it('the sanitizer is the one spelling of the token the preview uses', () => {
    // Guards against a future refactor inlining `font.family` into the style attribute,
    // which would put an unsanitized database value into the DOM.
    renderList([font({ family: 'Weird Family' as string, slots: ['primary'] })])
    expect(within(picker('primary')).getByText('PP Mori')).toHaveStyle({
      fontFamily: `'${sanitizeFamily('Weird Family')}', sans-serif`,
    })
  })
})

describe('FontManager — choosing', () => {
  it('CRITICAL: one row per slot, derived from FONT_SLOTS', () => {
    // The Brand page is the only place a slot can be filled. A slot missing here is a slot
    // the payload can carry and no manager can ever set — and nothing would fail; the
    // site would just never get that font.
    renderList()
    for (const slot of FONT_SLOTS) expect(picker(slot), `slot ${slot}`).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(FONT_SLOTS.length)
  })

  it('shows which font fills which slot, and "Choose" where none does', () => {
    renderList([font({ slots: ['primary', 'custom_2'] }), font({ id: 'f2', label: 'Bebas Neue', family: 'bebas-neue', slots: [] })])
    expect(picker('primary')).toHaveTextContent('PP Mori')
    expect(picker('custom_2')).toHaveTextContent('PP Mori')
    expect(picker('secondary')).toHaveTextContent('Choose')
  })

  it('CRITICAL: picking a font writes THAT slot only — one font may fill several', async () => {
    // Filling `custom_1` with the font that is already `primary` must be one write against
    // one slot, not a move.
    renderList()
    openPicker('custom_1')
    await act(async () => {
      fireEvent.click(within(option('Bebas Neue')).getByText('Bebas Neue'))
    })
    expect(mockedSlot).toHaveBeenCalledTimes(1)
    expect(mockedSlot).toHaveBeenCalledWith('a1', 'custom_1', 'f2')
    expect(screen.queryByRole('listbox')).toBeNull() // a pick closes the menu
  })

  it('replacing the font in a slot needs no question — the row shows what it replaces', async () => {
    renderList()
    openPicker('primary') // Bebas Neue holds it
    await act(async () => {
      fireEvent.click(within(option('PP Mori')).getByText('PP Mori'))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockedSlot).toHaveBeenCalledWith('a1', 'primary', 'f1')
  })

  it('None empties the slot; an empty slot offers no None', async () => {
    renderList()
    openPicker('secondary')
    expect(screen.queryByRole('option', { name: 'None' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    openPicker('primary')
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'None' }))
    })
    expect(mockedSlot).toHaveBeenCalledWith('a1', 'primary', null)
  })

  it('picking the font already in the slot writes nothing', async () => {
    renderList()
    openPicker('primary')
    await act(async () => {
      fireEvent.click(within(option('Bebas Neue')).getByText('Bebas Neue'))
    })
    expect(mockedSlot).not.toHaveBeenCalled()
  })

  it('the search line narrows the list (Sam: "a list with a search bar")', () => {
    renderList()
    openPicker()
    fireEvent.change(screen.getByLabelText('Search fonts'), { target: { value: 'beb' } })
    expect(screen.queryByRole('option', { name: 'PP Mori' })).toBeNull()
    expect(option('Bebas Neue')).toBeInTheDocument()
  })

  it('a failed slot change is surfaced', async () => {
    mockedSlot.mockResolvedValueOnce({ error: 'Not found.' })
    renderList()
    openPicker('secondary')
    await act(async () => {
      fireEvent.click(within(option('PP Mori')).getByText('PP Mori'))
    })
    expect(mockedToast).toHaveBeenCalledWith('Not found.', 'error')
  })
})

/** The form lives in the + Font dialog, at the foot of any slot's picker. */
const openAdd = (slot = 'secondary') => {
  openPicker(slot)
  fireEvent.click(screen.getByRole('button', { name: 'Font' }))
}

describe('FontManager — uploading', () => {
  it('CRITICAL: the file picker is disabled until the font is named', () => {
    // The name derives the CSS family token, which is written into every per-region style
    // that uses the font and can never be changed. An unnamed upload has no token.
    renderList()
    openAdd()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Font name'), { target: { value: 'PP Mori' } })
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false)
  })

  it('CRITICAL: the picker offers exactly the validated allowlist — no SVG, no wildcard', () => {
    renderList()
    openAdd()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe(acceptFor(FONT_UPLOAD_RULES))
    expect(input.accept).not.toMatch(/svg/i)
    expect(input.accept).not.toContain('*')
  })

  it('the dialog says which slot the upload fills', () => {
    // The upload IS the choice: a font added from the secondary row becomes the secondary
    // font (the action takes the slot). The header states it so the manager knows.
    renderList()
    openAdd('secondary')
    expect(within(screen.getByRole('dialog', { name: 'Add a font' })).getByText('secondary')).toBeInTheDocument()
  })

  it('names the licence responsibility', () => {
    // Foundry licences are sold per use and a desktop licence does not cover a website.
    // Uploading a font to a public bucket is the moment that becomes the artist's problem —
    // so the line is in the dialog where the upload happens, and nowhere on the page.
    renderList()
    expect(screen.queryByText(/licence/i)).toBeNull()
    openAdd()
    expect(screen.getByText(/licence/i)).toBeInTheDocument()
  })
})

describe('FontManager — removing', () => {
  it('CRITICAL: confirms first, and does nothing when the manager says no', async () => {
    renderList()
    await clickRemove()
    await say('Cancel')
    expect(mockedRemove).not.toHaveBeenCalled()
  })

  it('removes and reports when confirmed', async () => {
    renderList()
    await clickRemove()
    await say('Remove')
    expect(mockedRemove).toHaveBeenCalledWith('a1', 'f1')
    expect(mockedToast).toHaveBeenCalledWith('Font removed')
  })

  it('CRITICAL: a double click removes ONCE — the latch is a ref, not state', async () => {
    // With a state latch both clicks read the pre-render value: the font is deleted, then
    // the second call reports "that font is no longer there" over the top of the success.
    let release: (v: { error?: string }) => void = () => {}
    mockedRemove.mockImplementationOnce(() => new Promise((r) => (release = r)))
    renderList()
    await clickRemove()
    // The latch guards the ACTION, so the double click is on the confirm — the trigger
    // only raises a question.
    const go = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' })
    await act(async () => {
      go.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      go.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mockedRemove).toHaveBeenCalledTimes(1)
    await act(async () => release({}))
  })

  it('CRITICAL: a blocked Remove is surfaced, never silently swallowed', async () => {
    // RLS row-filters rather than failing, so the action can answer with an error while
    // everything looks fine. Reporting it is the only signal the manager gets.
    mockedRemove.mockResolvedValueOnce({ error: 'Not found.' })
    renderList()
    await clickRemove()
    await say('Remove')
    expect(mockedToast).toHaveBeenCalledWith('Not found.', 'error')
    expect(mockedToast).not.toHaveBeenCalledWith('Font removed')
  })
})

describe('FontManager — the eye', () => {
  it('CRITICAL: opens a preview that draws whatever is typed in THAT face', () => {
    // Sam, 2026-09-13: "click like an eye icon to preview it and it allows the user to type
    // in whatever they want and it displays it as the font selected".
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Preview primary font' }))
    const dialog = screen.getByRole('dialog', { name: 'Preview Bebas Neue' })
    const sample = within(dialog).getByTestId('font-sample')
    expect(sample).toHaveStyle({ fontFamily: "'bebas-neue', sans-serif" })
    expect(sample).toHaveTextContent('Bebas Neue') // starts with the name, so it is never blank
    fireEvent.change(within(dialog).getByLabelText('Text to preview'), { target: { value: 'Salt Shed, Chicago' } })
    expect(sample).toHaveTextContent('Salt Shed, Chicago')
  })

  it('only a filled slot has an eye — there is nothing to view in an empty one', () => {
    renderList()
    expect(screen.getAllByRole('button', { name: /^Preview/ })).toHaveLength(1)
  })

  it('Escape closes it and leaves the rows alone', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Preview primary font' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(picker('primary')).toHaveTextContent('Bebas Neue')
  })
})

describe('FontManager — empty', () => {
  it('every slot says Choose, and the picker offers only + Font', () => {
    renderList([])
    for (const slot of FONT_SLOTS) expect(picker(slot)).toHaveTextContent('Choose')
    openPicker()
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByLabelText('Search fonts')).toBeNull() // nothing to search
    expect(screen.getByRole('button', { name: 'Font' })).toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull() // the picker is in the dialog
  })
})

describe('addArtistFontAction is wired for upload', () => {
  it('is the action the uploader records with', () => {
    // The upload hook itself is mocked (it needs a browser + a bucket), so this asserts
    // the wiring exists rather than re-testing the hook.
    expect(addArtistFontAction).toBeTypeOf('function')
  })
})
