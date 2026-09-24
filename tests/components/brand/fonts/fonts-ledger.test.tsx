// @vitest-environment jsdom
// Brand → Fonts: one ledger row per font slot, the Change menu, the add flow, the preview.
/**
 * FontsLedger (BRAND_PAGE_PLAN.md, Fonts; Sam 2026-09-23). What has to hold:
 *
 *   rows      Primary + Secondary are built-in: fixed title, guide text, no note, no trash.
 *             Added (custom_*) rows have a renamable title, a note and a trash that asks.
 *   the font  its name in its OWN face, sized by measured cap height (16px until measured,
 *             and in jsdom, which has no canvas; the maths is in font-sample.test.ts) (sanitized family — the family is a CSS
 *             injection sink), its weight by name, and a red "no Bold" under 600.
 *   change    chevrons → a menu of the artist's fonts (each in its face, current bold),
 *             then "Upload a font…". The same font writes NOTHING; another one is one
 *             setFontSlotAction. A refusal is an error toast.
 *   add       "+ Add font" only while a custom slot is free (the count is derived from
 *             CUSTOM_FONT_SLOTS). The new row is client-only until it gets its font, then
 *             ONE write saves slot + title + note. The + becomes the chevrons, the eye
 *             appears.
 *   preview   the eye → a modal in that face: an editable "Test", the font's name under it.
 *
 * Server actions and the router are mocked: this pins what the page CALLS, and with what.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FontsLedger } from '@/app/artists/[id]/(dashboard)/brand/fonts/fonts-ledger'
import {
  addArtistFontAction,
  clearCustomFontSlotAction,
  removeArtistFontAction,
  renameArtistFontAction,
  setFontSlotAction,
  setFontSlotMetaAction,
} from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import {
  CUSTOM_FONT_SLOTS,
  FONT_SLOTS,
  nextFreeCustomSlot,
  sanitizeFamily,
  type BrandFont,
  type BrandFontSlot,
  type BrandFonts,
  type CustomFontSlot,
} from '@/lib/fonts'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  addArtistFontAction: vi.fn(async () => ({})),
  clearCustomFontSlotAction: vi.fn(async () => ({})),
  removeArtistFontAction: vi.fn(async () => ({})),
  renameArtistFontAction: vi.fn(async () => ({})),
  setFontSlotAction: vi.fn(async () => ({})),
  setFontSlotMetaAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
/** The upload hook needs a browser and a bucket; capture what UploadField hands it so a
 *  test can drive `writeRow` — the one seam where the font row is written. */
const upload: { opts: { writeRow: (path: string, file: File) => Promise<string | null> } | null } = { opts: null }
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: (opts: { writeRow: (path: string, file: File) => Promise<string | null> }) => {
    upload.opts = opts
    return { busy: false, error: null, upload: vi.fn(), progress: null, reset: vi.fn() }
  },
}))

const mSlot = vi.mocked(setFontSlotAction)
const mMeta = vi.mocked(setFontSlotMetaAction)
const mClear = vi.mocked(clearCustomFontSlotAction)
const mAdd = vi.mocked(addArtistFontAction)
const mRemove = vi.mocked(removeArtistFontAction)
const mRename = vi.mocked(renameArtistFontAction)
const mToast = vi.mocked(toast)

const font = (over: Partial<BrandFont> = {}): BrandFont => ({
  id: 'f1',
  label: 'PP Mori',
  family: 'pp-mori',
  format: 'woff2',
  storagePath: 'a1/fonts/11111111-1111-4111-8111-111111111111.woff2',
  weight: 400,
  ...over,
})
const MORI = font()
const BEBAS = font({ id: 'f2', label: 'Bebas Neue', family: 'bebas-neue', format: 'otf', storagePath: 'a1/fonts/22222222-2222-4222-8222-222222222222.otf', weight: 700 })
const FONTS = [MORI, BEBAS]

const slotRow = (slot: BrandFontSlot['slot'], f: BrandFont | null, label: string | null = null, note: string | null = null): BrandFontSlot => ({ slot, label, note, font: f })

/** BrandFonts as loadBrandFonts shapes it — `nextCustomSlot` from the real helper. */
function data(over: { primary?: BrandFont | null; secondary?: BrandFont | null; custom?: BrandFontSlot[]; fonts?: BrandFont[] } = {}): BrandFonts {
  const custom = over.custom ?? []
  return {
    primary: slotRow('primary', over.primary === undefined ? BEBAS : over.primary),
    secondary: slotRow('secondary', over.secondary === undefined ? MORI : over.secondary),
    custom,
    fonts: over.fonts ?? FONTS,
    nextCustomSlot: nextFreeCustomSlot(custom.map((c) => c.slot)),
  }
}

/** Every custom slot the vocabulary has, filled — derived, never a hand-written three. */
const allCustom = () => CUSTOM_FONT_SLOTS.map((slot, i) => slotRow(slot, MORI, `Extra ${i + 1}`))

const show = (d: BrandFonts = data()) => render(<FontsLedger artistId="a1" data={d} />)

/** The ledger row a title sits in. */
function rowOf(title: string): HTMLElement {
  const hit = screen
    .getAllByText(title)
    .map((el) => el.closest('[data-ledger-row]'))
    .find(Boolean)
  if (!hit) throw new Error(`no ledger row titled ${title}`)
  return hit as HTMLElement
}

/** "+ Add font" — the AddRow control, NOT an empty row's + (which is also "Add font"). */
const addControl = () => screen.queryAllByRole('button', { name: 'Add font' }).find((b) => !b.closest('[data-ledger-row]')) ?? null

/** The add form's name field — an <input>, unlike every added row's title (a
 *  contentEditable also named "Name"). */
const nameField = () => screen.getAllByRole('textbox', { name: 'Name' }).find((el) => el.tagName === 'INPUT')!

function type(el: HTMLElement, text: string) {
  act(() => el.focus())
  el.textContent = text
  fireEvent.input(el)
}

/** Ring classes on `el` that can never paint (Tailwind v4: `outline-none`/`outline-hidden`
 *  set --tw-outline-style:none, which every `outline-<n>` reads) — the rule
 *  tests/components/brand/focus-rings.test.tsx pins for the shell's controls. */
function deadRings(el: Element): string[] {
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  if (!cls.some((c) => c === 'outline-none' || c === 'outline-hidden')) return []
  return cls.filter((c) => {
    const m = /^((?:[^:\s]+:)*)outline(?:-(?:\d+|\[[^\]]+\]))?$/.exec(c)
    return m ? m[1] === '' || !cls.includes(`${m[1]}outline-solid`) : false
  })
}
const everyDeadRing = (root: Element) =>
  [...root.querySelectorAll('*')].flatMap((el) => deadRings(el).map((c) => `<${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? ''}> ${c}`))

const openMenu = (title: string) => {
  const row = rowOf(title)
  fireEvent.click(within(row).getByRole('button', { name: /^(Change font|Add font)$/ }))
  return screen.getByRole('menu', { name: 'Fonts' })
}

const say = async (answer: string) => {
  const dialog = await screen.findByRole('dialog', { name: /Remove/ })
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: answer }))
  })
}

beforeEach(() => {
  // fontFaceCss resolves URLs against this and DROPS a font whose URL fails SAFE_URL; with
  // it unset the stylesheet is legitimately empty and the CSS assertions read nothing.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co')
  upload.opts = null
  mSlot.mockResolvedValue({})
  mMeta.mockResolvedValue({})
  mClear.mockResolvedValue({})
  mAdd.mockResolvedValue({})
  mRemove.mockResolvedValue({})
  mRename.mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('FontsLedger — built-in and added rows', () => {
  it('CRITICAL: Primary and Secondary have a fixed title and guide text — no rename, no note, no trash', () => {
    show()
    for (const title of ['Primary', 'Secondary']) {
      const row = rowOf(title)
      expect(within(row).queryByRole('textbox', { name: 'Name' }), `${title} title`).toBeNull()
      expect(within(row).queryByRole('textbox', { name: 'Note' }), `${title} note`).toBeNull()
      expect(within(row).queryByRole('button', { name: 'Remove' }), `${title} trash`).toBeNull()
    }
    expect(within(rowOf('Primary')).getByText(/headings/i)).toBeInTheDocument()
    expect(within(rowOf('Secondary')).getByText(/body/i)).toBeInTheDocument()
  })

  it('CRITICAL: every slot in the vocabulary can have a row — derived from FONT_SLOTS', () => {
    // The Brand page is the only place a slot is filled. A slot the payload can carry and
    // no row can reach is one the site never gets a font for, and nothing would fail.
    const { container } = show(data({ custom: allCustom() }))
    expect(container.querySelectorAll('[data-ledger-row]')).toHaveLength(FONT_SLOTS.length)
  })

  it('CRITICAL: an added row has a renamable title, a note and a trash', () => {
    show(data({ custom: [slotRow(CUSTOM_FONT_SLOTS[1], BEBAS, 'Gig posters', 'For merch')] }))
    const row = rowOf('Gig posters')
    expect(within(row).getByRole('textbox', { name: 'Name' })).toHaveTextContent('Gig posters')
    expect(within(row).getByRole('textbox', { name: 'Note' })).toHaveTextContent('For merch')
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('renaming an added row saves its label on THAT slot, then refreshes', async () => {
    const slot = CUSTOM_FONT_SLOTS[1]
    show(data({ custom: [slotRow(slot, BEBAS, 'Gig posters')] }))
    const title = within(rowOf('Gig posters')).getByRole('textbox', { name: 'Name' })
    type(title, 'Posters')
    await act(async () => fireEvent.keyDown(title, { key: 'Enter' }))
    expect(mMeta).toHaveBeenCalledTimes(1)
    expect(mMeta).toHaveBeenCalledWith('a1', slot, { label: 'Posters' })
    expect(refresh).toHaveBeenCalled()
  })

  it('a note on an added row saves as its note', async () => {
    const slot = CUSTOM_FONT_SLOTS[0]
    show(data({ custom: [slotRow(slot, BEBAS, 'Gig posters')] }))
    const note = within(rowOf('Gig posters')).getByRole('textbox', { name: 'Note' })
    type(note, 'Merch only')
    await act(async () => fireEvent.keyDown(note, { key: 'Enter' }))
    expect(mMeta).toHaveBeenCalledWith('a1', slot, { note: 'Merch only' })
  })

  it('a custom slot with no stored title still gets one, derived from the slot', () => {
    show(data({ custom: [slotRow('custom_2', BEBAS)] }))
    expect(within(rowOf('Custom 2')).getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })

  it('CRITICAL: the trash asks first, and No clears nothing', async () => {
    show(data({ custom: [slotRow(CUSTOM_FONT_SLOTS[2], BEBAS, 'Gig posters')] }))
    fireEvent.click(within(rowOf('Gig posters')).getByRole('button', { name: 'Remove' }))
    await say('Cancel')
    expect(mClear).not.toHaveBeenCalled()
  })

  it('CRITICAL: confirmed, the trash clears that added slot', async () => {
    const slot = CUSTOM_FONT_SLOTS[2]
    show(data({ custom: [slotRow(slot, BEBAS, 'Gig posters')] }))
    fireEvent.click(within(rowOf('Gig posters')).getByRole('button', { name: 'Remove' }))
    await say('Remove')
    expect(mClear).toHaveBeenCalledWith('a1', slot)
    expect(refresh).toHaveBeenCalled()
  })

  it('a refused clear is an error toast', async () => {
    mClear.mockResolvedValueOnce({ error: 'That font row is no longer there.' })
    show(data({ custom: [slotRow(CUSTOM_FONT_SLOTS[0], BEBAS, 'Gig posters')] }))
    fireEvent.click(within(rowOf('Gig posters')).getByRole('button', { name: 'Remove' }))
    await say('Remove')
    expect(mToast).toHaveBeenCalledWith('That font row is no longer there.', 'error')
  })
})

describe('FontsLedger — the font on the row', () => {
  it('CRITICAL: the font name is set in its own face, sized as a measured sample (16px before measuring)', () => {
    show()
    const name = within(rowOf('Primary')).getByText('Bebas Neue')
    expect(name).toHaveAttribute('data-font-sample')
    expect(name).toHaveStyle({ fontFamily: "'bebas-neue', sans-serif", fontSize: '16px' })
  })

  it('CRITICAL: injects the @font-face rules the faces need', () => {
    const { container } = show()
    const css = Array.from(container.querySelectorAll('style')).map((s) => s.innerHTML).join('')
    expect(css).toContain("@font-face{font-family:'bebas-neue'")
    expect(css).toContain("format('opentype')")
  })

  it('CRITICAL: a hostile family cannot break out of the style tag or the style attribute', () => {
    const hostile = "x'}</style><img src=x onerror=alert(1)><style>body{display:none}"
    const evil = font({ id: 'f9', label: 'Evil', family: hostile })
    const { container } = show(data({ primary: evil, fonts: [evil] }))
    const css = Array.from(container.querySelectorAll('style')).map((s) => s.innerHTML).join('')
    expect(css).toContain('@font-face') // the face was emitted — so this is not vacuous
    expect(css).not.toContain('<')
    expect(css).not.toContain('display:none')
    expect(document.querySelector('img')).toBeNull()
    expect(within(rowOf('Primary')).getByText('Evil')).toHaveStyle({ fontFamily: `'${sanitizeFamily(hostile)}', sans-serif` })
  })

  it('CRITICAL: the weight shows by name; under 600 a red "no Bold"', () => {
    const medium = font({ id: 'f3', label: 'Archivo', family: 'archivo', weight: 500 })
    show(data({ primary: medium, secondary: BEBAS, fonts: [medium, BEBAS] }))
    const primary = rowOf('Primary')
    expect(within(primary).getByText(/Medium/)).toBeInTheDocument()
    const miss = within(primary).getByText(/no Bold/)
    expect(miss.className).toContain('text-accent-red')
    const secondary = rowOf('Secondary')
    expect(within(secondary).getByText('Bold')).toBeInTheDocument()
    expect(within(secondary).queryByText(/no Bold/)).toBeNull()
  })

  it('Semi Bold (600) is bold enough — the "no Bold" line stops at 600', () => {
    const semi = font({ id: 'f3', label: 'Archivo', family: 'archivo', weight: 600 })
    show(data({ primary: semi, fonts: [semi, MORI] }))
    expect(within(rowOf('Primary')).getByText('Semi Bold')).toBeInTheDocument()
    expect(within(rowOf('Primary')).queryByText(/no Bold/)).toBeNull()
  })

  it('an unknown weight says nothing — it never guesses "no Bold"', () => {
    const unknown = font({ id: 'f3', label: 'Archivo', family: 'archivo', weight: null })
    show(data({ primary: unknown, fonts: [unknown, MORI] }))
    expect(within(rowOf('Primary')).queryByText(/no Bold/)).toBeNull()
    expect(within(rowOf('Primary')).queryByText(/Regular|Medium|Bold/)).toBeNull()
  })

  it('an empty built-in row says "No font yet" with a +, and has no eye', () => {
    show(data({ secondary: null }))
    const row = rowOf('Secondary')
    expect(within(row).getByText('No font yet')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Add font' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Change font' })).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Preview' })).toBeNull()
  })
})

describe('FontsLedger — Change font', () => {
  it('lists the artist’s fonts in their own faces, the current one bold, then Upload', () => {
    show()
    const menu = openMenu('Primary')
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['PP Mori', 'Bebas Neue'])
    expect(within(items[0]).getByText('PP Mori')).toHaveStyle({ fontFamily: "'pp-mori', sans-serif" })
    expect(items[1]).toHaveAttribute('aria-checked', 'true')
    expect(items[1].className).toContain('font-bold')
    expect(items[0].className).not.toContain('font-bold')
    expect(within(menu).getByRole('menuitem', { name: 'Upload a font…' })).toBeInTheDocument()
  })

  it('CRITICAL: every keyboard ring in the menu paints (rename and remove included)', () => {
    show()
    const menu = openMenu('Primary')
    expect(everyDeadRing(menu)).toEqual([])
    for (const name of ['Rename PP Mori', 'Remove PP Mori'])
      expect(within(menu).getByRole('menuitem', { name }).className).toContain('focus-visible:outline-solid')
  })

  it('opens to the LEFT of the control, never over the row', () => {
    show()
    expect(openMenu('Primary').className).toContain('right-[calc(100%+12px)]')
  })

  it('CRITICAL: picking the font already there writes nothing', async () => {
    show()
    const menu = openMenu('Primary')
    await act(async () => fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Bebas Neue' })))
    expect(mSlot).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('CRITICAL: picking another font is ONE write on that slot', async () => {
    show()
    const menu = openMenu('Primary')
    await act(async () => fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'PP Mori' })))
    expect(mSlot).toHaveBeenCalledTimes(1)
    expect(mSlot).toHaveBeenCalledWith('a1', 'primary', 'f1')
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull() // the row shows what it replaced; no question
  })

  it('CRITICAL: a double click writes once — the latch is a ref', async () => {
    let release: (v: { error?: string }) => void = () => {}
    mSlot.mockImplementationOnce(() => new Promise((r) => (release = r)))
    show()
    const item = within(openMenu('Primary')).getByRole('menuitemradio', { name: 'PP Mori' })
    await act(async () => {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mSlot).toHaveBeenCalledTimes(1)
    await act(async () => release({}))
  })

  it('a refused change is an error toast, and nothing refreshes', async () => {
    mSlot.mockResolvedValueOnce({ error: 'Not found.' })
    show()
    const menu = openMenu('Primary') // outside act: act defers the render that mounts it
    await act(async () => fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'PP Mori' })))
    expect(mToast).toHaveBeenCalledWith('Not found.', 'error')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('Escape closes the menu', () => {
    show()
    openMenu('Primary')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"Upload a font…" opens the upload dialog with its licence line', () => {
    show()
    expect(screen.queryByText(/licence/i)).toBeNull()
    fireEvent.click(within(openMenu('Secondary')).getByRole('menuitem', { name: 'Upload a font…' }))
    expect(screen.getByRole('dialog', { name: 'Upload a font' })).toBeInTheDocument()
    expect(screen.getByText(/licence/i)).toBeInTheDocument()
  })

  it('CRITICAL: an upload from a row fills THAT row’s slot', async () => {
    show()
    fireEvent.click(within(openMenu('Secondary')).getByRole('menuitem', { name: 'Upload a font…' }))
    fireEvent.change(screen.getByLabelText('Font name'), { target: { value: 'Archivo' } })
    const file = new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0])], 'archivo.woff2')
    let done!: Promise<string | null>
    await act(async () => {
      done = upload.opts!.writeRow('a1/fonts/33333333-3333-4333-8333-333333333333.woff2', file)
    })
    // woff2 carries no readable weight, so the dialog asks; Save takes the default.
    await act(async () => fireEvent.click(within(screen.getByRole('dialog', { name: 'Upload a font' })).getByRole('button', { name: 'Save' })))
    expect(await done).toBeNull()
    expect(mAdd).toHaveBeenCalledWith('a1', expect.objectContaining({ label: 'Archivo', format: 'woff2' }), 'secondary')
  })

  it('with no fonts uploaded, the menu offers only the upload', () => {
    show(data({ primary: null, secondary: null, fonts: [] }))
    const menu = openMenu('Primary')
    expect(within(menu).queryAllByRole('menuitemradio')).toHaveLength(0)
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Upload a font…'])
  })

  it('CRITICAL: removing a font from the library asks first; No removes nothing', async () => {
    show()
    fireEvent.click(within(openMenu('Primary')).getByRole('menuitem', { name: 'Remove PP Mori' }))
    await say('Cancel')
    expect(mRemove).not.toHaveBeenCalled()
  })

  it('a refused library removal is an error toast', async () => {
    mRemove.mockResolvedValueOnce({ error: 'That font is no longer there.' })
    show()
    fireEvent.click(within(openMenu('Primary')).getByRole('menuitem', { name: 'Remove PP Mori' }))
    await say('Remove')
    expect(mToast).toHaveBeenCalledWith('That font is no longer there.', 'error')
  })

  it('a font can be removed from the library, after a question', async () => {
    show()
    fireEvent.click(within(openMenu('Primary')).getByRole('menuitem', { name: 'Remove PP Mori' }))
    await say('Remove')
    expect(mRemove).toHaveBeenCalledWith('a1', 'f1')
    expect(refresh).toHaveBeenCalled()
  })
})

describe('FontsLedger — renaming a font (Sam: Skeen’s arrived as "Sorg_Font")', () => {
  /** The menu's rename for one font: its pencil, then the inline name field it opens. */
  function startRename(row: string, fontName: string) {
    const menu = openMenu(row)
    fireEvent.click(within(menu).getByRole('menuitem', { name: `Rename ${fontName}` }))
    return { menu, field: within(menu).getByRole('textbox', { name: 'Font name' }) }
  }

  it('CRITICAL: opening rename SELECTS the whole old name, so typing replaces it (not prepends)', async () => {
    // Found by the final visual check, 2026-09-24: the field opened with the caret at the
    // start, so "Visual Check Sans" + typing became "…RenamedVisual Check Sans" in the DB.
    show()
    const { field } = startRename('Primary', 'Bebas Neue')
    await act(async () => {})
    expect(document.activeElement).toBe(field)
    expect(window.getSelection()?.toString()).toBe('Bebas Neue')
  })

  it('CRITICAL: each font in the Change menu renames in place: Enter saves THAT font’s name, and it shows everywhere', async () => {
    show()
    const { menu, field } = startRename('Primary', 'Bebas Neue')
    // Inline, in the titles' grammar: the name itself becomes the field, focused, still in its face.
    expect(field.textContent).toBe('Bebas Neue')
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute('contenteditable')).toBe('true')
    expect(field.className).toContain('focus:border-ink')
    expect(field.closest('[data-font-sample]')).toHaveStyle({ fontFamily: "'bebas-neue', sans-serif" })

    field.textContent = 'Sorg'
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    expect(mRename).toHaveBeenCalledTimes(1)
    expect(mRename).toHaveBeenCalledWith('a1', 'f2', 'Sorg')
    // The route refreshes, so the layout's Publish bar sees the new name (it is published).
    expect(refresh).toHaveBeenCalled()
    // The menu is still open, back to a list, with the new name; the row says it too.
    expect(within(menu).getByRole('menuitemradio', { name: 'Sorg' })).toBeInTheDocument()
    expect(within(menu).queryByRole('textbox', { name: 'Font name' })).toBeNull()
    // Focus is back on its entry, so the keyboard stays in the menu.
    expect(document.activeElement).toBe(within(menu).getByRole('menuitemradio', { name: 'Sorg' }))
    const rowSample = [...rowOf('Primary').querySelectorAll('[data-font-sample]')].filter((el) => !el.closest('[role="menu"]'))
    expect(rowSample.map((el) => el.textContent)).toEqual(['Sorg'])
  })

  it('the same name, or no name at all, writes nothing and puts the name back', async () => {
    show()
    const { menu, field } = startRename('Primary', 'PP Mori')
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename PP Mori' }))
    const again = within(menu).getByRole('textbox', { name: 'Font name' })
    again.textContent = '   '
    await act(async () => fireEvent.keyDown(again, { key: 'Enter' }))
    expect(mRename).not.toHaveBeenCalled()
    expect(within(menu).getByRole('menuitemradio', { name: 'PP Mori' })).toBeInTheDocument()
  })

  it('Escape puts the old name back and leaves the MENU open; a second Escape closes it', async () => {
    show()
    const { menu, field } = startRename('Primary', 'PP Mori')
    field.textContent = 'Nope'
    await act(async () => fireEvent.keyDown(field, { key: 'Escape' }))
    expect(mRename).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBe(menu)
    expect(within(menu).getByRole('menuitemradio', { name: 'PP Mori' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a refused rename is an error toast, and the old name comes back', async () => {
    mRename.mockResolvedValueOnce({ error: 'That font is no longer there.' })
    show()
    const { menu, field } = startRename('Primary', 'PP Mori')
    field.textContent = 'Sorg'
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    expect(mToast).toHaveBeenCalledWith('That font is no longer there.', 'error')
    expect(within(menu).getByRole('menuitemradio', { name: 'PP Mori' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitemradio', { name: 'Sorg' })).toBeNull()
    expect(within(rowOf('Secondary')).getByText('PP Mori')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('arrow keys inside the name field move the caret, not the menu’s focus', () => {
    show()
    const { field } = startRename('Primary', 'PP Mori')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(field)
  })
})

describe('FontsLedger — the Change font control’s own hover label', () => {
  it('CRITICAL: is hidden while its menu is open (the menu covered it: "hange font")', () => {
    show()
    const trigger = within(rowOf('Primary')).getByRole('button', { name: 'Change font' })
    // The hover label is the trigger's own [data-side] child (row-icon.tsx HoverLabel).
    expect(trigger.querySelector(':scope > [data-side]')).not.toBeNull()
    const HIDE = '[&>[data-side]]:hidden'
    expect(trigger.className).not.toContain(HIDE)
    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: 'Fonts' })).toBeInTheDocument()
    expect(trigger.className).toContain(HIDE)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.className).not.toContain(HIDE)
  })
})

describe('FontsLedger — adding a font row', () => {
  it('CRITICAL: Add is offered while a custom slot is free and hidden when all are used', () => {
    // The count is CUSTOM_FONT_SLOTS, never a literal: a fourth slot in the vocabulary must
    // be addable the day it exists.
    const { unmount } = show(data({ custom: allCustom().slice(0, -1) }))
    expect(addControl()).not.toBeNull()
    unmount()
    show(data({ custom: allCustom() }))
    expect(addControl()).toBeNull()
  })

  it('CRITICAL: a new row in the last free slot hides Add at once', () => {
    show(data({ custom: allCustom().slice(0, -1) }))
    fireEvent.click(addControl()!)
    fireEvent.change(nameField(), { target: { value: 'Posters' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    expect(rowOf('Posters')).toBeInTheDocument()
    expect(addControl()).toBeNull()
  })

  it('CRITICAL: name → note → + saves NOTHING; the pick saves slot, title and note in one write', async () => {
    show()
    fireEvent.click(addControl()!)
    const name = nameField()
    fireEvent.change(name, { target: { value: 'Gig posters' } })
    fireEvent.keyDown(name, { key: 'Enter' })

    const row = rowOf('Gig posters')
    const note = within(row).getByRole('textbox', { name: 'Note' })
    expect(document.activeElement).toBe(note) // focus lands in the new row's note
    type(note, 'For merch')
    await act(async () => fireEvent.keyDown(note, { key: 'Enter' }))
    const plus = within(row).getByRole('button', { name: 'Add font' })
    expect(document.activeElement).toBe(plus) // Enter hands focus to the row's +

    expect(within(row).getByText('No font yet')).toBeInTheDocument()
    expect(mSlot).not.toHaveBeenCalled()
    expect(mMeta).not.toHaveBeenCalled()
    expect(mAdd).not.toHaveBeenCalled()

    fireEvent.click(plus)
    await act(async () => fireEvent.click(within(screen.getByRole('menu', { name: 'Fonts' })).getByRole('menuitemradio', { name: 'Bebas Neue' })))
    expect(mSlot).toHaveBeenCalledTimes(1)
    expect(mSlot).toHaveBeenCalledWith('a1', CUSTOM_FONT_SLOTS[0], 'f2', { label: 'Gig posters', note: 'For merch' })
  })

  it('CRITICAL: once the new row has its font, the + becomes the chevrons and the eye appears', async () => {
    show()
    fireEvent.click(addControl()!)
    fireEvent.change(nameField(), { target: { value: 'Gig posters' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    const row = rowOf('Gig posters')
    expect(within(row).queryByRole('button', { name: 'Change font' })).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Preview' })).toBeNull()

    fireEvent.click(within(row).getByRole('button', { name: 'Add font' }))
    await act(async () => fireEvent.click(within(screen.getByRole('menu', { name: 'Fonts' })).getByRole('menuitemradio', { name: 'PP Mori' })))

    expect(within(row).queryByRole('button', { name: 'Add font' })).toBeNull()
    expect(within(row).getByRole('button', { name: 'Change font' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(within(row).getByText('PP Mori')).toHaveStyle({ fontFamily: "'pp-mori', sans-serif" })
  })

  it('a refused first pick leaves the row unsaved and says why', async () => {
    mSlot.mockResolvedValueOnce({ error: 'You have too many.' })
    show()
    fireEvent.click(addControl()!)
    fireEvent.change(nameField(), { target: { value: 'Gig posters' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    const row = rowOf('Gig posters')
    fireEvent.click(within(row).getByRole('button', { name: 'Add font' }))
    await act(async () => fireEvent.click(within(screen.getByRole('menu', { name: 'Fonts' })).getByRole('menuitemradio', { name: 'PP Mori' })))
    expect(mToast).toHaveBeenCalledWith('You have too many.', 'error')
    expect(within(row).getByRole('button', { name: 'Add font' })).toBeInTheDocument()
  })

  it('renaming or noting an unsaved row writes nothing; the trash drops it without a question', async () => {
    show()
    fireEvent.click(addControl()!)
    fireEvent.change(nameField(), { target: { value: 'Gig posters' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    const title = within(rowOf('Gig posters')).getByRole('textbox', { name: 'Name' })
    type(title, 'Posters')
    await act(async () => fireEvent.keyDown(title, { key: 'Enter' }))
    expect(rowOf('Posters')).toBeInTheDocument()
    expect(mMeta).not.toHaveBeenCalled()

    fireEvent.click(within(rowOf('Posters')).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Posters')).toBeNull()
    expect(mClear).not.toHaveBeenCalled()
  })

  it('CRITICAL: an upload from an unsaved row carries its slot, title and note', async () => {
    show()
    fireEvent.click(addControl()!)
    fireEvent.change(nameField(), { target: { value: 'Gig posters' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    const row = rowOf('Gig posters')
    fireEvent.click(within(row).getByRole('button', { name: 'Add font' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Fonts' })).getByRole('menuitem', { name: 'Upload a font…' }))
    fireEvent.change(screen.getByLabelText('Font name'), { target: { value: 'Archivo' } })
    const file = new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0])], 'archivo.woff2')
    let done!: Promise<string | null>
    await act(async () => {
      done = upload.opts!.writeRow('a1/fonts/33333333-3333-4333-8333-333333333333.woff2', file)
    })
    await act(async () => fireEvent.click(within(screen.getByRole('dialog', { name: 'Upload a font' })).getByRole('button', { name: 'Save' })))
    expect(await done).toBeNull()
    expect(mAdd).toHaveBeenCalledWith('a1', expect.objectContaining({ label: 'Archivo' }), CUSTOM_FONT_SLOTS[0] as CustomFontSlot, { label: 'Gig posters', note: null })
  })
})

describe('FontsLedger — the eye', () => {
  it('CRITICAL: opens a preview in THAT face: an editable "Test", the font’s name under it', () => {
    show()
    fireEvent.click(within(rowOf('Primary')).getByRole('button', { name: 'Preview' }))
    const dialog = screen.getByRole('dialog', { name: 'Primary' })
    const sample = within(dialog).getByRole('textbox', { name: 'Sample' })
    expect(sample).toHaveTextContent('Test')
    expect(sample).toHaveAttribute('contenteditable', 'true')
    expect(sample).toHaveStyle({ fontFamily: "'bebas-neue', sans-serif" })
    expect(within(dialog).getByText('Bebas Neue')).toBeInTheDocument()
  })

  it('Escape closes it and leaves the row alone', () => {
    show()
    fireEvent.click(within(rowOf('Primary')).getByRole('button', { name: 'Preview' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(rowOf('Primary')).getByText('Bebas Neue')).toBeInTheDocument()
  })
})
