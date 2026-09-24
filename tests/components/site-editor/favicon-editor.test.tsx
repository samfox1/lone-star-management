// @vitest-environment jsdom
// The icon editor's save guarantees, checked by what it asks the canvas to draw and save.
/**
 * IconEditor (brand/favicon-editor.tsx) — the controls behind the tab icon and, since the
 * Brand page rebuild (2026-09-23), the home-screen icon too. MIGRATED from the favicon
 * editor's tests: the component became one editor for both targets inside a BrandModal
 * (Size / Up or down sliders instead of Zoom and nudge buttons), and every guarantee below
 * moved with it, unchanged in substance.
 *
 * jsdom has no canvas implementation, so `getContext` is stubbed with a recorder
 * (@tests/components/brand/icons/_canvas). That is the point, not a limitation: what
 * matters is WHAT the editor asks a canvas to draw, and that the board and the exported
 * file are driven from the same framing. The pixel work itself is `drawFavicon`.
 *
 * FAKE TIMERS throughout (fix round, 2026-09-23). "Mounting saves NOTHING" and "closing with
 * nothing changed" each failed once under a loaded machine and never alone: they waited real
 * seconds and polled with a 1s `waitFor`. Now time only moves when a test moves it
 * (`pass`), each step is flushed (`settle`), and every test ends by letting its own
 * save-on-close finish and dropping unconsumed once-values (`drain`) — so no test's work can
 * land in the next one's.
 *
 * Dropped with the old layout: the 32px "true size" canvas. The new editor (the plan) has
 * one board, and the row shows the generated file itself at 64px.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { DEFAULT_FRAMING, FAVICON_SIZE, faviconDrawBox, type FaviconFraming } from '@/lib/brand'
import { canvas, drain, installCanvasFakes, lastDrawAt, LOGO, pass, settle } from '@tests/components/brand/icons/_canvas'

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  setBrandAssetAction: vi.fn(async () => ({})),
  saveFramingAction: vi.fn(async () => ({})),
  setIconSourceAction: vi.fn(async () => ({})),
  addIconSourceAction: vi.fn(async () => ({ mediaId: 'u9' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/upload-field', () => ({ UploadField: () => null }))

import { IconEditor, ICON_BOARD_CANVAS, SAVE_AFTER_MS } from '@/app/artists/[id]/(dashboard)/brand/favicon-editor'
import { saveFramingAction, setBrandAssetAction } from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

const URL_ = 'https://img.example/logo.png'

function Editor({ framing, closable = false }: { framing: FaviconFraming; closable?: boolean }) {
  const [open, setOpen] = useState(true)
  return open ? (
    <IconEditor
      artistId="a1"
      target="favicon"
      label="Tab icon"
      initialFraming={framing}
      source={{ id: 'p', url: URL_ }}
      logos={[{ id: 'p', label: 'Primary logo', url: URL_ }]}
      onClose={() => closable && setOpen(false)}
    />
  ) : null
}

const renderEditor = async (framing: FaviconFraming = DEFAULT_FRAMING, closable = false) => {
  const view = render(<Editor framing={framing} closable={closable} />)
  await settle()
  expect(lastDrawAt(ICON_BOARD_CANVAS), 'the board drew the logo').toBeDefined()
  return view
}
const boxAt = (framing: FaviconFraming, size: number) => {
  const b = faviconDrawBox(LOGO, framing, size)
  return [b.x, b.y, b.width, b.height]
}
const size = (value: string) => fireEvent.change(screen.getByLabelText('Size'), { target: { value } })
const upDown = (value: string) => fireEvent.change(screen.getByLabelText('Up or down'), { target: { value } })
/** Long enough that any save the editor scheduled has run, and then some. */
const pastTheSaveWindow = () => pass(SAVE_AFTER_MS * 3)

beforeEach(() => {
  vi.useFakeTimers()
  installCanvasFakes()
})
afterEach(drain)

describe('IconEditor — drawing', () => {
  it('opens with the SAVED framing, not the default', async () => {
    const saved = { zoom: 2.5, offsetY: -0.2 }
    await renderEditor(saved)
    expect(lastDrawAt(ICON_BOARD_CANVAS)).toEqual(boxAt(saved, ICON_BOARD_CANVAS))
  })

  it('Size redraws the mark larger', async () => {
    await renderEditor()
    const before = lastDrawAt(ICON_BOARD_CANVAS)!
    size('3')
    await settle()
    expect(lastDrawAt(ICON_BOARD_CANVAS)![2]).toBeGreaterThan(before[2])
  })

  it('CRITICAL: Up or down moves the mark — negative is up, and back again returns it', async () => {
    await renderEditor()
    const start = lastDrawAt(ICON_BOARD_CANVAS)![1]
    upDown('-0.3')
    await settle()
    expect(lastDrawAt(ICON_BOARD_CANVAS)![1]).toBeLessThan(start) // smaller y is higher
    upDown('0')
    await settle()
    expect(lastDrawAt(ICON_BOARD_CANVAS)![1]).toBeCloseTo(start)
  })

  it('Reset returns to the whole logo, centred', async () => {
    await renderEditor({ zoom: 4, offsetY: 0.4 })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await settle()
    expect(lastDrawAt(ICON_BOARD_CANVAS)).toEqual(boxAt(DEFAULT_FRAMING, ICON_BOARD_CANVAS))
  })
})

describe('IconEditor — the modal (Sam, 2026-09-23)', () => {
  it('the header is the name and "edit" — no thumbnail', async () => {
    await renderEditor()
    const header = screen.getByRole('dialog', { name: 'Tab icon' }).querySelector('header')!
    expect(header.textContent).toBe('Tab iconedit')
    expect(header.querySelector('img, canvas')).toBeNull()
  })

  it('Reset sits in the footer, immediately LEFT of Save — not in the controls column', async () => {
    await renderEditor()
    const footer = screen.getByRole('dialog', { name: 'Tab icon' }).querySelector('footer')!
    const buttons = within(footer).getAllByRole('button').map((b) => b.textContent)
    expect(buttons.slice(-2)).toEqual(['Reset', 'Save'])
    expect(screen.getByRole('button', { name: 'Reset' }).closest('[data-modal-body]')).toBeNull()
  })

  it('the controls column starts level with the top of the board: source controls first, then the sliders', async () => {
    await renderEditor()
    const body = screen.getByRole('dialog', { name: 'Tab icon' }).querySelector('[data-modal-body] > div')!
    expect(body.className.split(/\s+/)).toContain('items-start')
    const select = screen.getByRole('combobox', { name: 'Select a logo' })
    const slider = screen.getByLabelText('Size')
    expect(select.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('IconEditor — saving', () => {
  it('CRITICAL: mounting saves NOTHING — the server seed is not an edit', async () => {
    // Without the `touched` guard every visit would re-export the PNG, upload it, and
    // rewrite the icon's asset row. The export WORKS here (toBlob is faked), so a save
    // that ran would reach the actions — a green here is not a save that died early.
    await renderEditor({ zoom: 2.5, offsetY: -0.2 })
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).not.toHaveBeenCalled()
    expect(vi.mocked(setBrandAssetAction)).not.toHaveBeenCalled()
    expect(vi.mocked(toast)).not.toHaveBeenCalled()
  })

  it('a change saves itself SAVE_AFTER_MS after it is made — not before', async () => {
    await renderEditor()
    size('2')
    await pass(SAVE_AFTER_MS - 50)
    expect(vi.mocked(saveFramingAction)).not.toHaveBeenCalled()
    await pass(100)
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledWith('a1', { zoom: 2, offsetY: 0 }, 'favicon')
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: an edit made while a save is in flight is saved after it — one save at a time, the last change never goes unsaved', async () => {
    let release!: (v: { error?: string }) => void
    vi.mocked(setBrandAssetAction).mockImplementationOnce(() => new Promise((res) => { release = res }))
    await renderEditor()

    size('2')
    await pass(SAVE_AFTER_MS)
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveFramingAction).mock.calls[0][1]).toMatchObject({ zoom: 2 })

    // A second edit lands while that save is still in flight …
    size('3')
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledTimes(1) // latched, not a second save yet

    // … and when the first save lands, it is saved, with the framing as it is NOW.
    await act(async () => release({}))
    await settle()
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(saveFramingAction).mock.calls[1][1]).toMatchObject({ zoom: 3 })
  })

  it('CRITICAL: saves the framing BEFORE the asset, so a failed upload keeps the adjustment', async () => {
    await renderEditor()
    // No Save needed: the change writes itself a moment after it is made.
    size('2')
    await pastTheSaveWindow()
    const framingOrder = vi.mocked(saveFramingAction).mock.invocationCallOrder[0]
    const assetOrder = vi.mocked(setBrandAssetAction).mock.invocationCallOrder[0]
    expect(framingOrder).toBeLessThan(assetOrder)
    expect(vi.mocked(setBrandAssetAction).mock.calls[0][1]).toBe('favicon')
  })

  it('a refused framing is an error toast and uploads nothing', async () => {
    vi.mocked(saveFramingAction).mockResolvedValueOnce({ error: 'Could not save the icon framing.' })
    await renderEditor()
    size('2')
    await pastTheSaveWindow()
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Could not save the icon framing.', 'error')
    expect(vi.mocked(setBrandAssetAction)).not.toHaveBeenCalled()
  })

  it('CRITICAL: exports at FAVICON_SIZE (180px), with the manager\'s framing', async () => {
    // A NON-default framing on purpose: with the default, "exports the manager's framing"
    // and "exports the default" are the same assertion (a mutation check caught exactly
    // that, 2026-08-04).
    const chosen = { zoom: 3.5, offsetY: -0.35 }
    await renderEditor({ zoom: 3, offsetY: -0.35 })
    size('3.5')
    await pastTheSaveWindow()
    expect(lastDrawAt(FAVICON_SIZE)).toEqual(boxAt(chosen, FAVICON_SIZE))
    // The whole product promise in one line: the file written is the framing the board
    // was showing, scaled.
    const ratio = FAVICON_SIZE / ICON_BOARD_CANVAS
    const board = boxAt(chosen, ICON_BOARD_CANVAS)
    expect(lastDrawAt(FAVICON_SIZE)![2]).toBeCloseTo(board[2] * ratio)
    expect(lastDrawAt(FAVICON_SIZE)![1]).toBeCloseTo(board[1] * ratio)
    expect(lastDrawAt(ICON_BOARD_CANVAS)).toEqual(board)
  })

  it('CRITICAL: closing the modal straight after a change still saves it', async () => {
    // Save closes the modal, and the change is only written a moment after it is made —
    // without the flush on close, drag-then-Save would drop the last adjustment.
    await renderEditor(DEFAULT_FRAMING, true)
    size('2.5')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await settle()
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledWith('a1', { zoom: 2.5, offsetY: 0 }, 'favicon')
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })

  it('closing with nothing changed saves nothing', async () => {
    await renderEditor(DEFAULT_FRAMING, true)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).not.toHaveBeenCalled()
    expect(vi.mocked(setBrandAssetAction)).not.toHaveBeenCalled()
  })
})

/**
 * Fix round, 2026-09-23: a save REGENERATES the PNG — a new file and a new row, which is a
 * real "not on the site yet". So a change that lands back where the icon was last saved is
 * no change: no upload, no row swap, no Publish bar. The comparison is against the last
 * SAVED framing and source, not the last one on screen.
 */
describe('IconEditor — back where it was saved is not a change', () => {
  it('CRITICAL: a slider moved away and back to its saved spot saves nothing', async () => {
    await renderEditor({ zoom: 2, offsetY: 0.1 })
    size('3')
    upDown('-0.4')
    size('2')
    upDown('0.1')
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).not.toHaveBeenCalled()
    expect(vi.mocked(setBrandAssetAction)).not.toHaveBeenCalled()
    expect(canvas.draws.some((d) => d.size === FAVICON_SIZE)).toBe(false) // not even exported
  })

  it('CRITICAL: Reset when the icon already IS the whole logo, centred, saves nothing', async () => {
    // A FRESH object, as the server sends it — handing in DEFAULT_FRAMING itself would let
    // React skip the update (same reference) and pass without the comparison existing.
    await renderEditor({ zoom: 1, offsetY: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).not.toHaveBeenCalled()
    expect(vi.mocked(setBrandAssetAction)).not.toHaveBeenCalled()
  })

  it('Reset from a real framing IS a change, and saves the default (the witness)', async () => {
    await renderEditor({ zoom: 4, offsetY: 0.4 })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledWith('a1', DEFAULT_FRAMING, 'favicon')
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })

  it('after a save, "saved" is the NEW spot: moving away and back to it saves nothing more', async () => {
    await renderEditor({ zoom: 2, offsetY: 0 })
    size('3')
    await pastTheSaveWindow()
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
    size('4')
    size('3')
    await pastTheSaveWindow()
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
    // …while the OLD spot is now a change.
    size('2')
    await pastTheSaveWindow()
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(2)
  })

  it('CRITICAL: a change queued behind a save in flight, landing on what THAT save wrote, saves nothing more', async () => {
    let release!: (v: { error?: string }) => void
    vi.mocked(setBrandAssetAction).mockImplementationOnce(() => new Promise((res) => { release = res }))
    await renderEditor({ zoom: 1, offsetY: 0 })
    size('2')
    await pass(SAVE_AFTER_MS) // saving zoom 2 …
    size('3')
    size('2') // … and back to 2 while it is in flight: queued behind it
    await pastTheSaveWindow()
    await act(async () => release({}))
    await settle()
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })

  it('closing straight after moving back saves nothing (the flush on close compares too)', async () => {
    await renderEditor({ zoom: 2, offsetY: 0 }, true)
    size('5')
    size('2')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).not.toHaveBeenCalled()
  })

  it('a failed save does not count as saved: moving back afterwards is still a change', async () => {
    vi.mocked(saveFramingAction).mockResolvedValueOnce({ error: 'Could not save the icon framing.' })
    await renderEditor({ zoom: 2, offsetY: 0 })
    size('3')
    await pastTheSaveWindow()
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Could not save the icon framing.', 'error')
    size('4')
    size('3')
    await pastTheSaveWindow()
    expect(vi.mocked(saveFramingAction)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalledTimes(1)
  })
})
