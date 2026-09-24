// @vitest-environment jsdom
// The logo editor: board + background circles, upload / remove, and the upload warnings with their cut-out.
/**
 * LogoEditor (BRAND_PAGE_PLAN.md, Logos, Sam 2026-09-23). What has to hold:
 *
 *   - NO sliders on logos;
 *   - the board's circles are Transparent · Light · Dark and EVERY brand colour, by name;
 *   - an upload lands in the right place: an empty built-in → setBrandAssetAction, a saved
 *     logo → replaceLogoFileAction (same row, so its id and anything framed from it live);
 *   - after an upload the file is checked: a flat opaque background says "white box" and
 *     offers Remove background, which runs the REAL cut-out, shows it on the board, uploads
 *     a PNG and calls cutOutLogoAction with that PNG's path — once, however fast it is hit;
 *   - a logo ALREADY stored is checked the same way when the editor opens (fix round
 *     2026-09-23), fetched from the public bucket (which answers CORS with `*`), and a
 *     later upload's check always wins over it;
 *   - a background that is not flat is SAID, and no cut-out is offered;
 *   - a small logo says so; a clean transparent one says nothing;
 *   - every refusal is an error toast, and a refused cut-out puts the board back.
 *
 * Mocked: the server actions, the toast, the router, the budget gate (a pass-through), the
 * browser-only canvas glue (pixels.ts → decoded-image fakes) and the Storage client. NOT
 * mocked: UploadField, useStorageUpload, performUpload, lib/image-checks — the maths the
 * warnings and the cut-out come from is the real one, run on the fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LogoEditor, type LogoTarget } from '@/app/artists/[id]/(dashboard)/brand/logos/logo-editor'
import { BOARD_BACKGROUNDS } from '@/app/artists/[id]/(dashboard)/brand/_ui/modal-board'
import { NOT_FLAT_TEXT } from '@/app/artists/[id]/(dashboard)/brand/logos/warnings'
import {
  cutOutLogoAction,
  replaceLogoFileAction,
  setBrandAssetAction,
} from '@/app/artists/[id]/(dashboard)/brand/actions'
import { decodeLogo, encodePng, loadStoredLogo, objectUrl } from '@/app/artists/[id]/(dashboard)/brand/logos/pixels'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import type { BrandLogo } from '@/lib/brand'
import type { LogoImage } from '@/lib/image-checks'
import { alphaAt, flatLogo, noisyLogo, pngFile, transparentLogo } from '@tests/components/brand/logos/_images'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  upload: vi.fn<(path: string, file: unknown, opts?: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null })),
  remove: vi.fn<(paths: string[]) => Promise<{ error: null }>>(async () => ({ error: null })),
  n: 0,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: h.upload, remove: h.remove }) } }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/budget-gate', () => ({
  useBudgetGate: () => ({ prepare: async (f: File) => f, modal: null }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  addLogoAction: vi.fn(async () => ({})),
  replaceLogoFileAction: vi.fn(async () => ({})),
  setBrandAssetAction: vi.fn(async () => ({})),
  cutOutLogoAction: vi.fn(async () => ({})),
  deleteLogoAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/brand/logos/pixels', () => ({
  decodeLogo: vi.fn(async () => null),
  loadStoredLogo: vi.fn(async () => null),
  encodePng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  // A distinct URL per blob, so the test can tell WHICH image is on the board.
  objectUrl: vi.fn(() => `blob:${++h.n}`),
  revokeUrl: vi.fn(),
}))

const PRIMARY: BrandLogo = {
  id: 'p1',
  purpose: 'logo_primary',
  label: null,
  note: null,
  storagePath: 'a1/brand/old.png',
  sourcePath: null,
  sortOrder: 1,
}
const SWATCHES = [
  { key: 'c1', name: 'Our black', hex: '#0d0d0d' },
  { key: 'c2', name: 'Warm cream', hex: '#f4f1ea' },
  { key: 'c3', name: 'Signal red', hex: '#e5484d' },
]
const PNG_PATH = /^a1\/brand\/[0-9a-f-]{36}\.png$/

beforeEach(() => {
  h.n = 0
  vi.mocked(decodeLogo).mockResolvedValue(null)
  vi.mocked(loadStoredLogo).mockResolvedValue(null)
})
afterEach(cleanup)

function mount(target: LogoTarget = { kind: 'builtin', purpose: 'logo_primary', title: 'Primary logo', logo: PRIMARY }) {
  render(<LogoEditor artistId="a1" target={target} swatches={SWATCHES} derivedIcons={[]} onClose={vi.fn()} />)
  return screen.getByRole('dialog', { name: target.title })
}

/** Pick a file through the editor's own (hidden) input — the path the + button opens. */
async function pick(title: string, file = pngFile()) {
  const input = screen.getByLabelText(`${title} file`) as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    fireEvent.change(input)
  })
}

/** Upload a file that decodes to `image`, and wait for the check to have run. */
async function uploadDecodingTo(image: LogoImage) {
  vi.mocked(decodeLogo).mockResolvedValue(image)
  await pick('Primary logo')
  await waitFor(() => expect(decodeLogo).toHaveBeenCalled())
}

const board = () => document.querySelector('[data-board]') as HTMLElement
const boardSrc = () => board().querySelector('img')?.getAttribute('src') ?? null

describe('LogoEditor: the board', () => {
  it('CRITICAL: no sliders on logos', () => {
    const dialog = mount()
    expect(within(dialog).queryAllByRole('slider')).toEqual([])
    expect(dialog.querySelectorAll('input[type="range"]')).toHaveLength(0)
  })

  it('CRITICAL: the background circles are Transparent · Light · Dark, then EVERY brand colour by name', () => {
    const dialog = mount()
    const names = within(within(dialog).getByRole('group', { name: 'Background' }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual([...BOARD_BACKGROUNDS.map((b) => b.name), ...SWATCHES.map((s) => s.name)])
  })

  it('an empty slot: "Add logo", Remove disabled, and the board says there is none', () => {
    const dialog = mount({ kind: 'builtin', purpose: 'logo_secondary', title: 'Secondary logo', logo: null })
    expect(within(dialog).getByRole('button', { name: 'Add logo' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeDisabled()
    expect(within(board()).getByText('No secondary logo yet')).toBeTruthy()
  })

  it('a logo with a file: "Upload new" and an enabled Remove', () => {
    const dialog = mount()
    expect(within(dialog).getByRole('button', { name: 'Upload new' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeEnabled()
    expect(boardSrc()).toContain('a1/brand/old.png')
  })

  it('CRITICAL: the picker offers exactly the validated allowlist — no SVG, no wildcard', () => {
    mount()
    const accept = screen.getByLabelText('Primary logo file').getAttribute('accept') ?? ''
    expect(accept).toContain('image/png')
    expect(accept).not.toMatch(/svg|image\/\*/)
  })
})

describe('LogoEditor: where an upload lands', () => {
  it('CRITICAL: an empty built-in gets its first file through setBrandAssetAction', async () => {
    mount({ kind: 'builtin', purpose: 'logo_secondary', title: 'Secondary logo', logo: null })
    await pick('Secondary logo')
    await waitFor(() => expect(setBrandAssetAction).toHaveBeenCalledTimes(1))
    expect(setBrandAssetAction).toHaveBeenCalledWith('a1', 'logo_secondary', expect.stringMatching(PNG_PATH))
    expect(replaceLogoFileAction).not.toHaveBeenCalled()
    expect(h.refresh).toHaveBeenCalled()
  })

  it('CRITICAL: a saved logo keeps its row — replaceLogoFileAction on ITS id, never a vacate-and-insert', async () => {
    mount()
    await pick('Primary logo')
    await waitFor(() => expect(replaceLogoFileAction).toHaveBeenCalledTimes(1))
    expect(replaceLogoFileAction).toHaveBeenCalledWith('a1', 'p1', expect.stringMatching(PNG_PATH))
    expect(setBrandAssetAction).not.toHaveBeenCalled()
  })

  it('a refused save is an error toast, and the stored object is removed again', async () => {
    vi.mocked(replaceLogoFileAction).mockResolvedValueOnce({ error: 'That logo is no longer there.' })
    mount()
    await pick('Primary logo')
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'))
    expect(h.remove).toHaveBeenCalledTimes(1)
    expect(decodeLogo).not.toHaveBeenCalled()
  })
})

describe('LogoEditor: upload warnings and the cut-out', () => {
  it('CRITICAL: a flat opaque background is named, with Remove background', async () => {
    const dialog = mount()
    await uploadDecodingTo(flatLogo())
    expect(await within(dialog).findByText('This logo has a white box behind it.')).toBeTruthy()
    const eraser = within(dialog).getByRole('button', { name: 'Remove background' })
    expect(eraser).toBeEnabled()
    // It sits at the modal's right edge: its hover label hangs LEFT from it (right-aligned),
    // or the modal clips "Remove backgroun…" (2026-09-23 screenshot).
    expect(eraser.querySelector('[data-align]')?.getAttribute('data-align')).toBe('end')
  })

  it('CRITICAL: Remove background cuts the REAL background out, shows it at once, and saves the PNG', async () => {
    const dialog = mount()
    const image = flatLogo()
    await uploadDecodingTo(image)
    const eraser = await within(dialog).findByRole('button', { name: 'Remove background' })
    await act(async () => {
      fireEvent.click(eraser)
    })
    await waitFor(() => expect(cutOutLogoAction).toHaveBeenCalledTimes(1))

    // The cut-out handed to the encoder is lib/image-checks' own result: the white edge is
    // now see-through and the mark is not.
    const cut = vi.mocked(encodePng).mock.calls[0][0]
    expect(alphaAt(cut, 0, 0)).toBe(0)
    expect(alphaAt(cut, 20, 20)).toBe(255)
    expect(alphaAt(image, 0, 0)).toBe(255) // the original was not edited in place

    // A PNG went to storage, and the action got THAT path, for THIS logo.
    const [path, file, opts] = h.upload.mock.calls.at(-1)!
    expect(path).toMatch(PNG_PATH)
    expect(file).toBe(await vi.mocked(encodePng).mock.results[0].value)
    expect(opts).toMatchObject({ contentType: 'image/png' })
    expect(cutOutLogoAction).toHaveBeenCalledWith('a1', 'p1', path)

    // On the board: the cut-out's own URL.
    const cutUrl = vi.mocked(objectUrl).mock.results.at(-1)!.value
    expect(vi.mocked(objectUrl).mock.calls.at(-1)![0]).toBe(file)
    expect(boardSrc()).toBe(cutUrl)
    // The white box is gone, so its warning is too.
    expect(within(dialog).queryByText('This logo has a white box behind it.')).toBeNull()
    expect(h.refresh).toHaveBeenCalled()
  })

  it('CRITICAL: two fast clicks on Remove background make ONE cut-out', async () => {
    const dialog = mount()
    await uploadDecodingTo(flatLogo())
    const eraser = await within(dialog).findByRole('button', { name: 'Remove background' })
    await act(async () => {
      fireEvent.click(eraser)
      fireEvent.click(eraser)
    })
    await waitFor(() => expect(cutOutLogoAction).toHaveBeenCalled())
    expect(cutOutLogoAction).toHaveBeenCalledTimes(1)
    expect(h.upload).toHaveBeenCalledTimes(2) // the logo, then one cut-out
  })

  it('CRITICAL: a background that is NOT flat is said plainly, and nothing is cut out', async () => {
    const dialog = mount()
    await uploadDecodingTo(noisyLogo())
    expect(await within(dialog).findByText(NOT_FLAT_TEXT)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Remove background' })).toBeNull()
    expect(within(dialog).queryByText(/box behind it/)).toBeNull()
    expect(encodePng).not.toHaveBeenCalled()
    expect(cutOutLogoAction).not.toHaveBeenCalled()
  })

  it('a small logo says so; a large transparent one says nothing at all', async () => {
    const dialog = mount()
    await uploadDecodingTo(transparentLogo(40))
    expect(await within(dialog).findByText('This logo is small, so it may look blurry.')).toBeTruthy()
    cleanup()

    const again = mount()
    vi.mocked(decodeLogo).mockClear()
    await uploadDecodingTo(transparentLogo(520))
    await waitFor(() => expect(boardSrc()).toMatch(/^blob:/))
    expect(within(again).queryByRole('list', { name: 'Upload warnings' })).toBeNull()
  })

  it('a LATER upload wins: an earlier file whose check finishes last does not put its warnings back', async () => {
    // `seq` guards inspect(): the first file (a white box) decodes slowly, the second (a
    // clean transparent logo) decodes at once. Without the guard, the slow decode lands
    // last and the modal warns about a box the logo on the board does not have.
    let finishFirst!: (img: LogoImage) => void
    vi.mocked(decodeLogo)
      .mockImplementationOnce(() => new Promise((r) => (finishFirst = r)))
      .mockResolvedValueOnce(transparentLogo(520))
    const dialog = mount()
    await pick('Primary logo')
    await waitFor(() => expect(decodeLogo).toHaveBeenCalledTimes(1))
    await pick('Primary logo')
    await waitFor(() => expect(decodeLogo).toHaveBeenCalledTimes(2))
    await act(async () => finishFirst(flatLogo()))
    expect(within(dialog).queryByText('This logo has a white box behind it.')).toBeNull()
    expect(within(dialog).queryByRole('list', { name: 'Upload warnings' })).toBeNull()
  })

  it('CRITICAL: a refused cut-out is an error toast with the action\'s sentence, and the board goes back', async () => {
    vi.mocked(cutOutLogoAction).mockResolvedValueOnce({ error: 'That logo changed while you were editing it. Try again.' })
    const dialog = mount()
    await uploadDecodingTo(flatLogo())
    const uploaded = boardSrc()
    await act(async () => {
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Remove background' }))
    })
    await waitFor(() => expect(toast).toHaveBeenCalledWith('That logo changed while you were editing it. Try again.', 'error'))
    expect(boardSrc()).toBe(uploaded)
    expect(h.remove).toHaveBeenCalledTimes(1) // the cut-out's object, cleaned up
    expect(within(dialog).getByText('This logo has a white box behind it.')).toBeTruthy()
  })
})

describe('LogoEditor: a logo already stored is checked when the editor opens', () => {
  it('CRITICAL: a stored logo with a white box shows the warning and Remove background — no upload needed', async () => {
    vi.mocked(loadStoredLogo).mockResolvedValue({ image: flatLogo(), bytes: 2048 })
    const dialog = mount()
    expect(await within(dialog).findByText('This logo has a white box behind it.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Remove background' })).toBeEnabled()
    // The ORIGINAL file from the public bucket — not the downscaled board thumbnail, whose
    // size would make every logo "small".
    const [url] = vi.mocked(loadStoredLogo).mock.calls[0]
    expect(url).toMatch(/\/storage\/v1\/object\/public\/media\/a1\/brand\/old\.png$/)
    expect(h.upload).not.toHaveBeenCalled()
  })

  it('CRITICAL: Remove background on a stored logo cuts THAT logo (its original is kept by the action)', async () => {
    vi.mocked(loadStoredLogo).mockResolvedValue({ image: flatLogo(), bytes: 2048 })
    const dialog = mount()
    const eraser = await within(dialog).findByRole('button', { name: 'Remove background' })
    await act(async () => {
      fireEvent.click(eraser)
    })
    await waitFor(() => expect(cutOutLogoAction).toHaveBeenCalledTimes(1))
    expect(cutOutLogoAction).toHaveBeenCalledWith('a1', 'p1', expect.stringMatching(PNG_PATH))
    expect(alphaAt(vi.mocked(encodePng).mock.calls[0][0], 0, 0)).toBe(0)
  })

  it('a stored logo that cannot be fetched (no CORS, offline) says nothing — never a guessed warning', async () => {
    const dialog = mount()
    await waitFor(() => expect(loadStoredLogo).toHaveBeenCalled())
    await act(async () => {})
    expect(within(dialog).queryByRole('list', { name: 'Upload warnings' })).toBeNull()
  })

  it('an empty slot fetches nothing', () => {
    mount({ kind: 'builtin', purpose: 'logo_secondary', title: 'Secondary logo', logo: null })
    expect(loadStoredLogo).not.toHaveBeenCalled()
  })

  it('an upload made while the stored logo is still being checked wins', async () => {
    let finish!: (v: { image: LogoImage; bytes: number }) => void
    vi.mocked(loadStoredLogo).mockImplementationOnce(() => new Promise((r) => (finish = r)))
    const dialog = mount()
    await uploadDecodingTo(transparentLogo(520))
    await waitFor(() => expect(boardSrc()).toMatch(/^blob:/))
    await act(async () => finish({ image: flatLogo(), bytes: 2048 }))
    expect(within(dialog).queryByText('This logo has a white box behind it.')).toBeNull()
  })
})
