// @vitest-environment jsdom
// The Logos tab: built-in rows, added rows, the add flow, and what Remove takes with it.
/**
 * LogosList (BRAND_PAGE_PLAN.md, Logos, Sam 2026-09-23). What has to hold:
 *
 *   - Primary logo and Secondary logo are BUILT-IN: fixed title + grey guide text, no
 *     note, not renamable, no trash;
 *   - an ADDED logo has a renamable title (renameLogoAction), a note (setLogoNoteAction)
 *     and a trash that asks first (deleteLogoAction); a declined ask deletes nothing;
 *   - the add flow: name → focus lands in the new row's note → Enter → focus on the row's
 *     + → the editor; NOTHING is saved until the file uploads, and then addLogoAction runs
 *     ONCE with the title, the note and the stored path;
 *   - a pending row's trash just drops it (nothing was saved);
 *   - removing ANY logo also clears the icons made from it (LogoRow's rule for the primary,
 *     widened 2026-09-23: an icon cut from a deleted logo would keep being served), an icon
 *     framed from another logo stays, and a failed removal stops before the icons;
 *   - every refusal is an error toast.
 *
 * Mocked: the server actions, toast, router, budget gate (pass-through), the canvas glue
 * and the Storage client. The upload path itself (UploadField → useStorageUpload →
 * performUpload) is real, so "saved only on upload" is the real sequence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BUILT_IN_LOGOS, LogosList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/logos/logos-list'
import {
  addLogoAction,
  cutOutLogoAction,
  deleteLogoAction,
  renameLogoAction,
  replaceLogoFileAction,
  setBrandAssetAction,
  setLogoNoteAction,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import type { BrandLogo, BrandLogos } from '@/lib/brand'
import { iconsFramedFrom, NO_ICONS, type IconUse } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/logos/remove'
import { decodeLogo, encodePng } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/logos/pixels'
import { flatLogo, pngFile } from '@tests/components/manager-tools/brand/logos/_images'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  upload: vi.fn<(path: string, file: unknown, opts?: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null })),
  remove: vi.fn<(paths: string[]) => Promise<{ error: null }>>(async () => ({ error: null })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: h.upload, remove: h.remove }) } }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/budget-gate', () => ({
  useBudgetGate: () => ({ prepare: async (f: File) => f, modal: null }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions', () => ({
  addLogoAction: vi.fn(async (_a: string, input: { title: string; note?: string | null; storagePath: string }) => ({
    logo: { id: 'new1', purpose: 'logo', label: input.title, note: input.note ?? null, storagePath: input.storagePath, sourcePath: null, sortOrder: 9 },
  })),
  renameLogoAction: vi.fn(async () => ({})),
  setLogoNoteAction: vi.fn(async () => ({})),
  deleteLogoAction: vi.fn(async () => ({})),
  replaceLogoFileAction: vi.fn(async () => ({})),
  cutOutLogoAction: vi.fn(async () => ({})),
  setBrandAssetAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/logos/pixels', () => ({
  decodeLogo: vi.fn(async () => null),
  loadStoredLogo: vi.fn(async () => null),
  encodePng: vi.fn(async () => null),
  objectUrl: vi.fn(() => 'blob:x'),
  revokeUrl: vi.fn(),
}))

afterEach(cleanup)

const logo = (over: Partial<BrandLogo>): BrandLogo => ({
  id: 'x',
  purpose: 'logo',
  label: null,
  note: null,
  storagePath: 'a1/brand/x.png',
  sourcePath: null,
  sortOrder: 1,
  ...over,
})
const PRIMARY = logo({ id: 'p1', purpose: 'logo_primary', storagePath: 'a1/brand/p.png' })
const SECONDARY = logo({ id: 's1', purpose: 'logo_secondary', storagePath: 'a1/brand/s.png' })
const TOUR = logo({ id: 'l1', label: 'Tour logo', note: 'For the posters', storagePath: 'a1/brand/t.png' })

/** Every action a row could call — "saved nothing" means none of these ran. */
const WRITES = [addLogoAction, renameLogoAction, setLogoNoteAction, deleteLogoAction, replaceLogoFileAction, cutOutLogoAction, setBrandAssetAction]

/** Both icons generated, each framed from `favicon` / `home` (null = the primary logo). */
const iconsFrom = (favicon: string | null, home: string | null): IconUse => ({
  favicon: { exists: true, sourceMediaId: favicon },
  home_icon: { exists: true, sourceMediaId: home },
})

function mount(logos: Partial<BrandLogos> = {}, icons: IconUse = NO_ICONS) {
  const all: BrandLogos = { primary: PRIMARY, secondary: SECONDARY, added: [TOUR], ...logos }
  return render(<LogosList artistId="a1" logos={all} swatches={[]} icons={icons} />)
}

/** The ledger row whose title is `title` (a fixed title, or a renamable one). */
function row(title: string): HTMLElement {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-ledger-row]')]
  // The row's left column starts with its title: fixed text, or a RowTitle textbox.
  const found = rows.find((r) => r.firstElementChild?.firstElementChild?.textContent === title)
  if (!found) throw new Error(`no row titled ${title}`)
  return found
}

function type(el: HTMLElement, text: string) {
  act(() => el.focus())
  el.textContent = text
  fireEvent.input(el)
}

async function answer(action: 'Remove' | 'Cancel', question: RegExp) {
  const q = await screen.findByRole('dialog', { name: question })
  await act(async () => {
    fireEvent.click(within(q).getByRole('button', { name: action }))
  })
}

describe('built-in rows', () => {
  it('CRITICAL: Primary and Secondary logo are fixed — guide text, no note, not renamable, no trash', () => {
    mount()
    for (const b of BUILT_IN_LOGOS) {
      const r = row(b.title)
      expect(within(r).getByText(b.guide)).toBeTruthy()
      expect(within(r).queryByRole('textbox')).toBeNull() // no Name, no Note
      expect(within(r).queryByRole('button', { name: 'Remove' })).toBeNull()
      expect(within(r).getByRole('button', { name: 'Edit' })).toBeTruthy()
    }
    expect(BUILT_IN_LOGOS.map((b) => b.title)).toEqual(['Primary logo', 'Secondary logo'])
  })

  it('an empty built-in: the tile says "Add" and the icon is a full-ink + (Add logo), not a pencil', () => {
    mount({ secondary: null })
    const r = row('Secondary logo')
    expect(r.querySelector('[data-logo-tile]')?.textContent).toBe('Add')
    expect(within(r).queryByRole('button', { name: 'Edit' })).toBeNull()
    fireEvent.click(within(r).getByRole('button', { name: 'Add logo' }))
    expect(screen.getByRole('dialog', { name: 'Secondary logo' })).toBeTruthy()
  })

  it('clicking the tile opens the same editor as the icon', () => {
    mount()
    fireEvent.click(row('Primary logo').querySelector('[data-logo-tile]')!)
    expect(screen.getByRole('dialog', { name: 'Primary logo' })).toBeTruthy()
  })
})

describe('added rows', () => {
  it('CRITICAL: an added logo is renamable, and the rename is saved for THAT logo', async () => {
    mount()
    const name = within(row('Tour logo')).getByRole('textbox', { name: 'Name' })
    type(name, 'Tour mark')
    await act(async () => fireEvent.keyDown(name, { key: 'Enter' }))
    expect(renameLogoAction).toHaveBeenCalledWith('a1', 'l1', 'Tour mark')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('its trash sits in the row\'s END slot (LedgerRow `remove`), so its tile lines up with the built-ins\'', () => {
    mount()
    const trash = within(row('Tour logo')).getByRole('button', { name: 'Remove' })
    expect(trash.closest('[data-ledger-end]')?.getAttribute('data-ledger-end')).toBe('remove')
    // The tile is not in that slot: it is the same last-but-one column as Primary's.
    expect(row('Tour logo').querySelector('[data-ledger-end] [data-logo-tile]')).toBeNull()
  })

  it('its note saves through setLogoNoteAction, and clearing it saves null', async () => {
    mount()
    const note = within(row('Tour logo')).getByRole('textbox', { name: 'Note' })
    expect(note.textContent).toBe('For the posters')
    type(note, '')
    await act(async () => fireEvent.keyDown(note, { key: 'Enter' }))
    expect(setLogoNoteAction).toHaveBeenCalledWith('a1', 'l1', null)
  })

  it('CRITICAL: its trash asks first; a declined ask deletes nothing, a yes deletes THAT logo', async () => {
    mount()
    fireEvent.click(within(row('Tour logo')).getByRole('button', { name: 'Remove' }))
    await answer('Cancel', /Remove “Tour logo”/)
    expect(deleteLogoAction).not.toHaveBeenCalled()

    fireEvent.click(within(row('Tour logo')).getByRole('button', { name: 'Remove' }))
    await answer('Remove', /Remove “Tour logo”/)
    expect(deleteLogoAction).toHaveBeenCalledTimes(1)
    expect(deleteLogoAction).toHaveBeenCalledWith('a1', 'l1')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('a refused delete is an error toast', async () => {
    vi.mocked(deleteLogoAction).mockResolvedValueOnce({ error: 'That logo is no longer there.' })
    mount()
    fireEvent.click(within(row('Tour logo')).getByRole('button', { name: 'Remove' }))
    await answer('Remove', /Remove “Tour logo”/)
    expect(toast).toHaveBeenCalledWith('That logo is no longer there.', 'error')
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('a refused rename is an error toast and the old name comes back', async () => {
    vi.mocked(renameLogoAction).mockResolvedValueOnce({ error: 'Give the logo a name, up to 40 characters.' })
    mount()
    const name = within(row('Tour logo')).getByRole('textbox', { name: 'Name' })
    type(name, 'x'.repeat(30))
    await act(async () => fireEvent.keyDown(name, { key: 'Enter' }))
    expect(toast).toHaveBeenCalledWith('Give the logo a name, up to 40 characters.', 'error')
    expect(within(row('Tour logo')).getByRole('textbox', { name: 'Name' }).textContent).toBe('Tour logo')
  })
})

describe('the add flow', () => {
  /** "+ Add logo" is the AddRow's text control — not a row's + icon, which is also named
   *  "Add logo" but carries an aria-label and sits inside a ledger row. */
  const addControl = () =>
    screen.getAllByRole('button', { name: 'Add logo' }).find((b) => !b.closest('[data-ledger-row]') && !b.hasAttribute('aria-label'))!

  async function startRow(title: string) {
    fireEvent.click(addControl())
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: title } })
    fireEvent.keyDown(input, { key: 'Enter' })
    return row(title)
  }

  it('CRITICAL: focus walks name → the new row\'s note → its +, and nothing is saved on the way', async () => {
    mount({ added: [] })
    const r = await startRow('Tertiary logo')
    const note = within(r).getByRole('textbox', { name: 'Note' })
    expect(document.activeElement).toBe(note)

    type(note, 'For merch')
    await act(async () => fireEvent.keyDown(note, { key: 'Enter' }))
    expect(document.activeElement).toBe(within(r).getByRole('button', { name: 'Add logo' }))

    for (const w of WRITES) expect(w).not.toHaveBeenCalled()
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('CRITICAL: the row is saved only when its file uploads — addLogoAction ONCE with title, note and path', async () => {
    mount({ added: [] })
    const r = await startRow('Tertiary logo')
    const note = within(r).getByRole('textbox', { name: 'Note' })
    type(note, 'For merch')
    await act(async () => fireEvent.keyDown(note, { key: 'Enter' }))

    // The row's + opens the editor; opening it saves nothing either.
    fireEvent.click(within(r).getByRole('button', { name: 'Add logo' }))
    const editor = screen.getByRole('dialog', { name: 'Tertiary logo' })
    for (const w of WRITES) expect(w).not.toHaveBeenCalled()

    const input = within(editor).getByLabelText('Tertiary logo file') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true })
    await act(async () => {
      fireEvent.change(input)
    })
    await waitFor(() => expect(addLogoAction).toHaveBeenCalledTimes(1))
    const [artist, saved] = vi.mocked(addLogoAction).mock.calls[0]
    expect(artist).toBe('a1')
    expect(saved).toEqual({ title: 'Tertiary logo', note: 'For merch', storagePath: expect.stringMatching(/^a1\/brand\/[0-9a-f-]{36}\.png$/) })
    expect(saved.storagePath).toBe(h.upload.mock.calls[0][0]) // the object that was stored
    // It is a real logo row now (renamable through the action), and the editor followed it.
    expect(replaceLogoFileAction).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Tertiary logo' })).toBeTruthy()
    expect(screen.getAllByText('Tertiary logo').length).toBeGreaterThan(0)
  })

  it('CRITICAL: once saved, the SAME editor keeps its warnings, and Remove background works on the new logo', async () => {
    vi.mocked(decodeLogo).mockResolvedValueOnce(flatLogo())
    vi.mocked(encodePng).mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }))
    mount({ added: [] })
    const r = await startRow('Tertiary logo')
    fireEvent.click(within(r).getByRole('button', { name: 'Add logo' }))
    const input = screen.getByLabelText('Tertiary logo file') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true })
    await act(async () => {
      fireEvent.change(input)
    })
    const editor = screen.getByRole('dialog', { name: 'Tertiary logo' })
    expect(await within(editor).findByText('This logo has a white box behind it.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: 'Remove background' }))
    })
    await waitFor(() => expect(cutOutLogoAction).toHaveBeenCalledTimes(1))
    expect(cutOutLogoAction).toHaveBeenCalledWith('a1', 'new1', expect.stringMatching(/^a1\/brand\/[0-9a-f-]{36}\.png$/))
  })

  it('CRITICAL: two files picked in one tick for a pending row add ONE logo, not two', async () => {
    // UploadField's own guard is `busy` STATE, which both change events read as false
    // before either render lands — so the editor's `addedRef` is the only latch between a
    // fast double pick and two added-logo rows (AGENTS.md rule 5). Both inside one act.
    mount({ added: [] })
    const r = await startRow('Tertiary logo')
    fireEvent.click(within(r).getByRole('button', { name: 'Add logo' }))
    const input = screen.getByLabelText('Tertiary logo file') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true })
    await act(async () => {
      fireEvent.change(input)
      fireEvent.change(input)
    })
    await waitFor(() => expect(addLogoAction).toHaveBeenCalled())
    await act(async () => {})
    expect(addLogoAction).toHaveBeenCalledTimes(1)
  })

  it('a refused add is an error toast and the row stays unsaved', async () => {
    vi.mocked(addLogoAction).mockResolvedValueOnce({ error: 'Give the logo a name, up to 40 characters.' })
    mount({ added: [] })
    const r = await startRow('Tertiary logo')
    fireEvent.click(within(r).getByRole('button', { name: 'Add logo' }))
    const input = screen.getByLabelText('Tertiary logo file') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true })
    await act(async () => {
      fireEvent.change(input)
    })
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'))
    expect(h.remove).toHaveBeenCalledTimes(1) // the orphaned object is cleaned up
    // Still the pending row: its + is still "Add logo", not a pencil.
    expect(within(row('Tertiary logo')).getByRole('button', { name: 'Add logo' })).toBeTruthy()
  })

  it('a pending row\'s trash just drops it — nothing was saved, so nothing is asked or called', () => {
    mount({ added: [] })
    fireEvent.click(addControl())
    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'Scratch' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const trash = within(row('Scratch')).getByRole('button', { name: 'Remove' })
    expect(trash.closest('[data-ledger-end]')?.getAttribute('data-ledger-end')).toBe('remove')
    fireEvent.click(trash)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(() => row('Scratch')).toThrow()
    for (const w of WRITES) expect(w).not.toHaveBeenCalled()
  })
})

describe('removing a logo takes the icons made from it', () => {
  async function removeFromEditor(title: string, question: RegExp) {
    fireEvent.click(within(row(title)).getByRole('button', { name: 'Edit' }))
    const editor = screen.getByRole('dialog', { name: title })
    fireEvent.click(within(editor).getByRole('button', { name: 'Remove' }))
    await answer('Remove', question)
  }

  it('CRITICAL: the primary also clears every icon made from it, and says so first', async () => {
    mount({}, iconsFrom(null, null))
    await removeFromEditor('Primary logo', /The tab and home-screen icons are made from it/)
    expect(setBrandAssetAction).toHaveBeenNthCalledWith(1, 'a1', 'logo_primary', null)
    expect(setBrandAssetAction).toHaveBeenNthCalledWith(2, 'a1', 'favicon', null)
    expect(setBrandAssetAction).toHaveBeenNthCalledWith(3, 'a1', 'home_icon', null)
    expect(setBrandAssetAction).toHaveBeenCalledTimes(3)
  })

  it('an icon framed from ANOTHER logo stays', async () => {
    mount({}, iconsFrom('l1', 's1'))
    await removeFromEditor('Primary logo', /^Remove the primary logo\?$/)
    expect(setBrandAssetAction).toHaveBeenCalledTimes(1)
    expect(setBrandAssetAction).toHaveBeenCalledWith('a1', 'logo_primary', null)
  })

  it('removing the SECONDARY leaves icons framed from the primary alone', async () => {
    mount({}, iconsFrom(null, 'p1'))
    await removeFromEditor('Secondary logo', /^Remove the secondary logo\?$/)
    expect(setBrandAssetAction).toHaveBeenCalledTimes(1)
    expect(setBrandAssetAction).toHaveBeenCalledWith('a1', 'logo_secondary', null)
  })

  it('CRITICAL: a failed removal is an error toast and does NOT go on to the icons', async () => {
    vi.mocked(setBrandAssetAction).mockResolvedValueOnce({ error: 'permission denied' })
    mount({}, { ...NO_ICONS, favicon: { exists: true, sourceMediaId: null } })
    await removeFromEditor('Primary logo', /The tab icon is made from it and goes too/)
    expect(toast).toHaveBeenCalledWith('permission denied', 'error')
    expect(setBrandAssetAction).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: which icons go with a logo — those that exist AND are framed from it (null source = the primary)', () => {
    const icons = (favicon: [boolean, string | null], home: [boolean, string | null]): IconUse => ({
      favicon: { exists: favicon[0], sourceMediaId: favicon[1] },
      home_icon: { exists: home[0], sourceMediaId: home[1] },
    })
    expect(iconsFramedFrom(icons([true, null], [true, null]), 'p1', 'p1')).toEqual(['favicon', 'home_icon'])
    expect(iconsFramedFrom(icons([true, 'p1'], [true, 'l1']), 'p1', 'p1')).toEqual(['favicon'])
    expect(iconsFramedFrom(icons([true, 'l1'], [true, 's1']), 'p1', 'p1')).toEqual([])
    expect(iconsFramedFrom(icons([false, null], [true, null]), 'p1', 'p1')).toEqual(['home_icon'])
    expect(iconsFramedFrom(icons([true, 'l1'], [false, null]), null, null)).toEqual([])
    // Any logo, not only the primary: an added one and the secondary.
    expect(iconsFramedFrom(icons([true, 'l1'], [true, null]), 'l1', 'p1')).toEqual(['favicon'])
    expect(iconsFramedFrom(icons([true, 's1'], [true, 's1']), 's1', 'p1')).toEqual(['favicon', 'home_icon'])
    // A null source is the primary's, never another logo's — and with no primary, nobody's.
    expect(iconsFramedFrom(icons([true, null], [true, null]), 's1', 'p1')).toEqual([])
    expect(iconsFramedFrom(icons([true, null], [true, null]), 's1', null)).toEqual([])
    // An icon framed from the logo but never generated has nothing to clear.
    expect(iconsFramedFrom(icons([false, 'l1'], [false, 'l1']), 'l1', 'p1')).toEqual([])
  })

  it('CRITICAL: an ADDED logo an icon is framed from takes that icon with it — asked first, from the row trash', async () => {
    // The stale-icon bug: only the primary cleared its icons, so deleting a tour logo the
    // tab icon was cut from left that PNG live, framed from a file that no longer exists.
    mount({}, iconsFrom('l1', null))
    fireEvent.click(within(row('Tour logo')).getByRole('button', { name: 'Remove' }))
    await answer('Remove', /^Remove “Tour logo”\? The tab icon is made from it and goes too\.$/)
    expect(deleteLogoAction).toHaveBeenCalledWith('a1', 'l1')
    expect(setBrandAssetAction).toHaveBeenCalledTimes(1)
    expect(setBrandAssetAction).toHaveBeenCalledWith('a1', 'favicon', null)
    expect(vi.mocked(deleteLogoAction).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(setBrandAssetAction).mock.invocationCallOrder[0])
  })

  it('CRITICAL: …and from its editor: the secondary takes both icons framed from it', async () => {
    mount({}, iconsFrom('s1', 's1'))
    await removeFromEditor('Secondary logo', /^Remove the secondary logo\? The tab and home-screen icons are made from it and go too\.$/)
    expect(setBrandAssetAction).toHaveBeenNthCalledWith(1, 'a1', 'logo_secondary', null)
    expect(setBrandAssetAction).toHaveBeenNthCalledWith(2, 'a1', 'favicon', null)
    expect(setBrandAssetAction).toHaveBeenNthCalledWith(3, 'a1', 'home_icon', null)
  })

  it('a refused delete of an added logo does NOT go on to its icons', async () => {
    vi.mocked(deleteLogoAction).mockResolvedValueOnce({ error: 'That logo is no longer there.' })
    mount({}, iconsFrom('l1', 'l1'))
    fireEvent.click(within(row('Tour logo')).getByRole('button', { name: 'Remove' }))
    await answer('Remove', /The tab and home-screen icons are made from it/)
    expect(toast).toHaveBeenCalledWith('That logo is no longer there.', 'error')
    expect(setBrandAssetAction).not.toHaveBeenCalled()
  })

  it('an added logo removed from its editor is deleted, and the editor closes', async () => {
    mount()
    await removeFromEditor('Tour logo', /Remove “Tour logo”/)
    expect(deleteLogoAction).toHaveBeenCalledWith('a1', 'l1')
    expect(setBrandAssetAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Tour logo' })).toBeNull()
  })
})
