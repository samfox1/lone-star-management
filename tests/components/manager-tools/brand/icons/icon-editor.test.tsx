// @vitest-environment jsdom
// The Tab icon tab's editor: where each icon comes from, and that each icon is its own.
/**
 * IconEditor (BRAND_PAGE_PLAN.md, Tab icon): one editor for both generated icons — the tab
 * icon and the home-screen icon — in a BrandModal. Board on the left; on the right "+"
 * (Upload new), a "Select a logo…" menu, the Size and Up/down sliders, Reset.
 *
 * The save guarantees it inherited from the favicon editor (framing before asset, one save
 * in flight, a 180px export, nothing saved on mount) are pinned in
 * tests/components/manager-tools/brand/icons/favicon-editor.test.tsx. This file pins what is NEW: the
 * source controls, the disabled-not-missing sliders, and that the two icons never share a
 * framing or an asset.
 *
 * FAKE TIMERS, like the save guarantees' file: "a refused source change…" failed once under
 * load (a real 900ms wait and 1s `waitFor` polls). Time moves only when a test moves it,
 * and `drain` lets each test's own save-on-close finish before the next begins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DEFAULT_FRAMING, FAVICON_SIZE, ICON_TARGETS, faviconDrawBox, type IconTarget } from '@/lib/brand'
import { canvas, drain, hold, installCanvasFakes, lastDrawAt, LOGO, pass, settle } from '@tests/components/manager-tools/brand/icons/_canvas'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions', () => ({
  setBrandAssetAction: vi.fn(async () => ({})),
  saveFramingAction: vi.fn(async () => ({})),
  setIconSourceAction: vi.fn(async () => ({})),
  addIconSourceAction: vi.fn(async () => ({ mediaId: 'u9' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } }),
}))
/** UploadField composes the compression gate and the storage dance (its own tests). Here
 *  its trigger is rendered as-is and "picking a file" runs the editor's `writeRow` with a
 *  stored path, which is the seam this editor owns. */
const writeRowResults: (string | null)[] = []
vi.mock('@/app/artists/[id]/(dashboard)/upload-field', () => ({
  UploadField: (p: {
    trigger: (open: () => void, s: { busy: boolean; error: string | null }) => ReactNode
    writeRow: (path: string, file: File) => Promise<string | null>
  }) =>
    p.trigger(() => {
      void p.writeRow('a1/brand/new-icon.png', new File(['x'], 'x.png')).then((r) => writeRowResults.push(r))
    }, { busy: false, error: null }),
}))

import { IconEditor, ICON_BOARD_CANVAS, SAVE_AFTER_MS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/favicon-editor'
import * as actions from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

const LOGOS = [
  { id: 'p', label: 'Primary logo', url: 'https://img.example/primary.png' },
  { id: 's', label: 'Secondary logo', url: 'https://img.example/secondary.png' },
  { id: 't', label: 'Tour logo', url: 'https://img.example/tour.png' },
]
const LABEL: Record<IconTarget, string> = { favicon: 'Tab icon', home_icon: 'Home-screen icon' }

function renderEditor({
  target = 'favicon' as IconTarget,
  source = { id: 'p', url: LOGOS[0].url } as { id: string | null; url: string | null },
  framing = DEFAULT_FRAMING,
  onClose = vi.fn(),
  /** A generated PNG exists (the premise of every "not a change" pin). `false` = the icon
   *  was never generated: nothing is saved yet, whatever the framing says. */
  generated = true,
} = {}) {
  return render(
    <IconEditor
      artistId="a1"
      target={target}
      label={LABEL[target]}
      initialFraming={framing}
      source={source}
      generated={generated}
      logos={LOGOS}
      onClose={onClose}
    />,
  )
}
const drawnOnBoard = async () => {
  await settle()
  expect(lastDrawAt(ICON_BOARD_CANVAS), 'the board drew the logo').toBeDefined()
}
const pastTheSaveWindow = () => pass(SAVE_AFTER_MS * 3)
const pick = async (name: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Select a logo' }))
  fireEvent.click(screen.getByRole('option', { name }))
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  installCanvasFakes()
  writeRowResults.length = 0
})
afterEach(drain)

describe('IconEditor — shape', () => {
  it('is a BrandModal named for its icon: board, Upload new, Select a logo, Size, Up or down, Reset, Save', async () => {
    renderEditor()
    const dialog = screen.getByRole('dialog', { name: 'Tab icon' })
    expect(within(dialog).getByLabelText('Tab icon preview')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Upload new' })).toBeTruthy()
    expect(within(dialog).getByRole('combobox', { name: 'Select a logo' })).toBeTruthy()
    expect(within(dialog).getByLabelText('Size')).toBeTruthy()
    expect(within(dialog).getByLabelText('Up or down')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Reset' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy()
    // No background circles on an icon board (the plan: not needed here).
    expect(within(dialog).queryByRole('group', { name: 'Background' })).toBeNull()
  })

  it('CRITICAL: with no source the sliders and Reset are DISABLED, and the modal keeps its shape', async () => {
    const labelled = () =>
      [...document.querySelectorAll('[role="dialog"] [aria-label]')].map((el) => el.getAttribute('aria-label')).sort()
    renderEditor()
    await drawnOnBoard()
    const withSource = labelled()
    cleanup()

    renderEditor({ source: { id: null, url: null } })
    // The same controls, in the same modal — nothing appears or disappears …
    expect(labelled()).toEqual(withSource)
    // … but there is nothing to frame, so the framing controls are greyed out.
    for (const name of ['Size', 'Up or down']) expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(true)
    // Choosing a source still works: that is how the manager gets out of this state.
    expect((screen.getByRole('button', { name: 'Upload new' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('combobox', { name: 'Select a logo' })).toBeTruthy()
  })

  it('with a source the sliders are live', async () => {
    renderEditor()
    await drawnOnBoard()
    for (const name of ['Size', 'Up or down']) expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(false)
  })

  it('an image that will not load disables the sliders too, and says so', async () => {
    canvas.failing.add(LOGOS[0].url)
    renderEditor()
    await settle()
    expect(screen.getByText(/couldn.t load/i)).toBeTruthy()
    expect((screen.getByLabelText('Size') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull()
  })

  it('CRITICAL: after "Select a logo…" the board says it is loading until the image is ready — then the sliders come on', async () => {
    // Sam, 2026-09-23: the board sat blank for ~4s with every slider greyed and no sign
    // anything was happening.
    const release = hold(LOGOS[2].url)
    renderEditor()
    await drawnOnBoard()
    await pick('Tour logo')
    expect(screen.getByRole('status', { name: 'Loading Tour logo' })).toBeTruthy()
    for (const name of ['Size', 'Up or down']) expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(true)

    await act(async () => release())
    await settle()
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull()
    for (const name of ['Size', 'Up or down']) expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(false)
    const box = faviconDrawBox(LOGO, DEFAULT_FRAMING, ICON_BOARD_CANVAS)
    expect(lastDrawAt(ICON_BOARD_CANVAS)).toEqual([box.x, box.y, box.width, box.height])
  })

  it('opening on a slow image says loading too — never a blank board with no word', async () => {
    const release = hold(LOGOS[0].url)
    renderEditor()
    await settle()
    expect(screen.getByRole('status', { name: 'Loading Primary logo' })).toBeTruthy()
    await act(async () => release())
    await settle()
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull()
  })

  it('"Upload new"\'s hover label does not cover the Size label: it opens below, and the sliders sit clear of it', () => {
    // Above was tried first and is clipped: the + now sits at the very top of the modal's
    // scrolling body (controls level with the board). jsdom has no layout, so this pins the
    // two facts the clearance is built from — the label's side, and the sliders' extra
    // margin (20px column gap + mt-4 = 36px ≥ the label's 8px offset + 24px height). The
    // screenshot check (2026-09-23) is where it was seen clear.
    renderEditor()
    const plus = screen.getByRole('button', { name: 'Upload new' })
    expect(plus.querySelector('[data-side]')?.getAttribute('data-side')).toBe('bottom')
    const sliders = screen.getByLabelText('Size').closest('[data-framing]')!
    expect(sliders.className.split(/\s+/)).toContain('mt-4')
  })

  it('CRITICAL: the board draws the SAME framing the exported file does', async () => {
    const chosen = { zoom: 2.5, offsetY: -0.2 }
    renderEditor({ framing: chosen })
    await drawnOnBoard()
    const box = faviconDrawBox(LOGO, chosen, ICON_BOARD_CANVAS)
    expect(lastDrawAt(ICON_BOARD_CANVAS)).toEqual([box.x, box.y, box.width, box.height])
    // Same framing at another size = the same picture: the ratio holds exactly.
    const file = faviconDrawBox(LOGO, chosen, FAVICON_SIZE)
    expect(box.y / ICON_BOARD_CANVAS).toBeCloseTo(file.y / FAVICON_SIZE)
  })
})

describe('IconEditor — where the icon comes from', () => {
  it('the menu lists the logos, and shows the current source', async () => {
    renderEditor({ source: { id: 't', url: LOGOS[2].url } })
    const menu = screen.getByRole('combobox', { name: 'Select a logo' })
    expect(menu.textContent).toContain('Tour logo')
    fireEvent.click(menu)
    const options = within(screen.getByRole('listbox', { name: 'Select a logo' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(LOGOS.map((l) => l.label))
  })

  it('an uploaded image as the source shows the placeholder, not a logo name', async () => {
    renderEditor({ source: { id: 'u1', url: 'https://img.example/upload.png' } })
    expect(screen.getByRole('combobox', { name: 'Select a logo' }).textContent).toContain('Select a logo…')
  })

  it('CRITICAL: choosing a logo calls setIconSourceAction with that media id, then regenerates the icon from it', async () => {
    renderEditor()
    await drawnOnBoard()
    await pick('Tour logo')

    expect(vi.mocked(actions.setIconSourceAction)).toHaveBeenCalledWith('a1', 'favicon', 't')
    // The icon is redrawn from the new logo and saved (framing first, then the PNG).
    expect(canvas.srcs).toContain(LOGOS[2].url)
    await pastTheSaveWindow()
    expect(vi.mocked(actions.setBrandAssetAction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(actions.setBrandAssetAction).mock.calls[0][1]).toBe('favicon')
    expect(vi.mocked(actions.saveFramingAction)).toHaveBeenCalledWith('a1', DEFAULT_FRAMING, 'favicon')
  })

  it('a refused source change is an error toast, and nothing is regenerated', async () => {
    vi.mocked(actions.setIconSourceAction).mockResolvedValueOnce({ error: 'Pick one of this artist’s logos.' })
    renderEditor()
    await drawnOnBoard()
    await pick('Tour logo')
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Pick one of this artist’s logos.', 'error')
    await pastTheSaveWindow()
    expect(canvas.srcs).not.toContain(LOGOS[2].url)
    expect(vi.mocked(actions.setBrandAssetAction)).not.toHaveBeenCalled()
  })

  // The guard for this one is SelectMenu's own (modal-kit.tsx: `if (v !== value) onChange(v)`),
  // which is why it was green before the fix round; it pins that the editor keeps feeding
  // the menu the CURRENT source as its value, so the guard can do its job.
  it('CRITICAL: picking the logo the icon is ALREADY framed from is not a change — no source write, no new icon', async () => {
    renderEditor({ source: { id: 't', url: LOGOS[2].url } })
    await drawnOnBoard()
    await pick('Tour logo')
    await pastTheSaveWindow()
    expect(vi.mocked(actions.setIconSourceAction)).not.toHaveBeenCalled()
    expect(vi.mocked(actions.setBrandAssetAction)).not.toHaveBeenCalled()
  })

  it('CRITICAL: another logo and then back to the saved one leaves no new icon behind', async () => {
    renderEditor()
    await drawnOnBoard()
    await pick('Tour logo')
    await pick('Primary logo')
    await pastTheSaveWindow()
    // Both picks are real choices, written as made …
    expect(vi.mocked(actions.setIconSourceAction).mock.calls.map((c) => c[2])).toEqual(['t', 'p'])
    // … but the icon ends where it was saved, so nothing is regenerated.
    expect(vi.mocked(actions.setBrandAssetAction)).not.toHaveBeenCalled()
  })

  it('CRITICAL: Upload new → addIconSourceAction, THEN setIconSourceAction with the new id, then regenerates', async () => {
    renderEditor({ target: 'home_icon' })
    await drawnOnBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Upload new' }))
    await settle()

    expect(vi.mocked(actions.setIconSourceAction)).toHaveBeenCalled()
    expect(vi.mocked(actions.addIconSourceAction)).toHaveBeenCalledWith('a1', 'home_icon', 'a1/brand/new-icon.png')
    expect(vi.mocked(actions.setIconSourceAction)).toHaveBeenCalledWith('a1', 'home_icon', 'u9')
    expect(vi.mocked(actions.addIconSourceAction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(actions.setIconSourceAction).mock.invocationCallOrder[0],
    )
    // The row was written, so the upload keeps its object (null = success to performUpload).
    expect(writeRowResults).toEqual([null])
    expect(canvas.srcs.some((s) => s.endsWith('a1/brand/new-icon.png'))).toBe(true)
    await pastTheSaveWindow()
    expect(vi.mocked(actions.setBrandAssetAction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(actions.setBrandAssetAction).mock.calls[0][1]).toBe('home_icon')
  })

  it('CRITICAL: two picks in one tick change the source ONCE (the latch is a ref)', async () => {
    renderEditor()
    await drawnOnBoard()
    fireEvent.click(screen.getByRole('combobox', { name: 'Select a logo' }))
    const tour = screen.getByRole('option', { name: 'Tour logo' })
    await act(async () => {
      tour.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      tour.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    expect(vi.mocked(actions.setIconSourceAction)).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: once the uploaded image is stored, a refusal to confirm it is a TOAST — never an error handed back to the upload', async () => {
    // Past addIconSourceAction the row exists and names the object. An error returned to
    // performUpload would delete that object from under the row, leaving an icon source
    // that 404s. So the confirm's refusal is said, and the upload is told it succeeded.
    vi.mocked(actions.setIconSourceAction).mockResolvedValueOnce({ error: 'Could not change the icon.' })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Upload new' }))
    await settle()
    expect(writeRowResults).toEqual([null])
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Could not change the icon.', 'error')
  })

  it('a refused upload row hands its error back to the upload (which then deletes the object)', async () => {
    vi.mocked(actions.addIconSourceAction).mockResolvedValueOnce({ error: 'That file location is not valid.' })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Upload new' }))
    await settle()
    expect(writeRowResults).toEqual(['That file location is not valid.'])
    expect(vi.mocked(actions.setIconSourceAction)).not.toHaveBeenCalled()
  })
})

describe('IconEditor — each icon is its own', () => {
  it.each(ICON_TARGETS)('CRITICAL: %s saves ITS framing and ITS asset, never the other icon\'s', async (target) => {
    renderEditor({ target, framing: { zoom: 2, offsetY: 0.1 } })
    await drawnOnBoard()
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '3' } })

    await pastTheSaveWindow()
    expect(vi.mocked(actions.setBrandAssetAction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(actions.saveFramingAction)).toHaveBeenCalledWith('a1', { zoom: 3, offsetY: 0.1 }, target)
    expect(vi.mocked(actions.setBrandAssetAction).mock.calls[0][1]).toBe(target)
  })
})

/**
 * Review 2 (2026-09-24), MEDIUM: an icon that was never GENERATED (no PNG row — Skeen's
 * home-screen icon) used to be seeded as "already saved" from the server's framing and
 * source, which exist without a PNG. So the only framing that could ever make it — the
 * default the manager sees — never saved: Size away and back, Reset, or Save alone all
 * read as "no change". With no PNG, nothing is saved yet; the no-op rule applies once one
 * exists (the witness below, and the "back where it was saved" pins in
 * tests/components/manager-tools/brand/icons/favicon-editor.test.tsx, which run with a PNG).
 */
describe('IconEditor — an icon with NO generated PNG yet', () => {
  it('CRITICAL: home-screen icon never generated: Size away and back to the default → the PNG is made', async () => {
    renderEditor({ target: 'home_icon', generated: false })
    await drawnOnBoard()
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '1' } })
    await pastTheSaveWindow()
    expect(vi.mocked(actions.saveFramingAction)).toHaveBeenCalledWith('a1', { zoom: 1, offsetY: 0 }, 'home_icon')
    expect(vi.mocked(actions.setBrandAssetAction), 'no PNG was ever written for the home-screen icon').toHaveBeenCalledTimes(1)
    expect(vi.mocked(actions.setBrandAssetAction).mock.calls[0][1]).toBe('home_icon')
  })

  it('the witness: the same moves on an icon that HAS a PNG save nothing', async () => {
    renderEditor({ target: 'home_icon', generated: true })
    await drawnOnBoard()
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '1' } })
    await pastTheSaveWindow()
    expect(vi.mocked(actions.setBrandAssetAction)).not.toHaveBeenCalled()
  })

  it('CRITICAL: Reset on a never-generated icon already at the default makes it (even handed DEFAULT_FRAMING itself)', async () => {
    // The very object: React skips a state update to the same reference, so a Reset that
    // handed it straight back would never even reach the comparison.
    renderEditor({ generated: false, framing: DEFAULT_FRAMING })
    await drawnOnBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await pastTheSaveWindow()
    expect(vi.mocked(actions.setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: Save alone on a never-generated icon makes it — and closes', async () => {
    const onClose = vi.fn()
    renderEditor({ target: 'home_icon', generated: false, onClose })
    await drawnOnBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await settle(6)
    expect(vi.mocked(actions.saveFramingAction)).toHaveBeenCalledWith('a1', DEFAULT_FRAMING, 'home_icon')
    expect(vi.mocked(actions.setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })

  it('…while Save alone on an icon that HAS a PNG writes nothing', async () => {
    const onClose = vi.fn()
    renderEditor({ target: 'home_icon', generated: true, onClose })
    await drawnOnBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await pastTheSaveWindow()
    expect(vi.mocked(actions.saveFramingAction)).not.toHaveBeenCalled()
    expect(vi.mocked(actions.setBrandAssetAction)).not.toHaveBeenCalled()
  })

  it('CRITICAL: mounting a never-generated icon still saves NOTHING — opening it is not an edit', async () => {
    renderEditor({ target: 'home_icon', generated: false })
    await drawnOnBoard()
    await pastTheSaveWindow()
    expect(vi.mocked(actions.saveFramingAction)).not.toHaveBeenCalled()
    expect(vi.mocked(actions.setBrandAssetAction)).not.toHaveBeenCalled()
  })

  it('once made, the no-op rule holds: away and back to what was just generated saves nothing more', async () => {
    renderEditor({ target: 'home_icon', generated: false })
    await drawnOnBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await pastTheSaveWindow()
    expect(vi.mocked(actions.setBrandAssetAction)).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '1' } })
    await pastTheSaveWindow()
    expect(vi.mocked(actions.setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })
})
