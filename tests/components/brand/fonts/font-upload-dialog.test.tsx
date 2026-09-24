// @vitest-environment jsdom
// Brand → Fonts upload dialog: name first, the file's weight read (or asked), licence line.
/**
 * FontUploadDialog (BRAND_PAGE_PLAN.md, Fonts). What has to hold:
 *
 *   - The file input is disabled until the font is named (the name derives the CSS family
 *     token, which can never change) — and a RESERVED name ("Bold", "Primary") is refused
 *     here, out loud, before a file is sent anywhere.
 *   - The picker offers exactly the validated allowlist: no SVG, no wildcard.
 *   - The WEIGHT: a ttf/otf/woff says it (OS/2 usWeightClass) and is passed without a
 *     question; a woff2 cannot be read, so the dialog asks, and nothing is written until
 *     the manager answers. The answer is what reaches addArtistFontAction.
 *   - The licence line lives here, the one moment it matters.
 *
 * `useStorageUpload` is mocked and its `writeRow` captured: that callback is where the
 * row is written, so driving it IS the upload, minus the bucket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FontUploadDialog } from '@/app/artists/[id]/(dashboard)/brand/fonts/font-upload-dialog'
import { addArtistFontAction } from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { FONT_UPLOAD_RULES, acceptFor } from '@/lib/upload'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({ addArtistFontAction: vi.fn(async () => ({})) }))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
type WriteRow = (path: string, file: File) => Promise<string | null>
const upload: { opts: { writeRow: WriteRow; onSuccess?: () => void } | null } = { opts: null }
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: (opts: { writeRow: WriteRow; onSuccess?: () => void }) => {
    upload.opts = opts
    return { busy: false, error: null, upload: vi.fn(), progress: null, reset: vi.fn() }
  },
}))

const mAdd = vi.mocked(addArtistFontAction)
const mToast = vi.mocked(toast)
const PATH = 'a1/fonts/33333333-3333-4333-8333-333333333333.ttf'

/** A minimal TTF: an sfnt header, one 'OS/2' table record, and the table's first 6 bytes
 *  (version, xAvgCharWidth, usWeightClass) — exactly what sniffFontWeight reads. */
function ttf(weight: number): File {
  const os2 = 12 + 16
  const buf = new Uint8Array(os2 + 6)
  const view = new DataView(buf.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, 1)
  buf.set([0x4f, 0x53, 0x2f, 0x32], 12)
  view.setUint32(20, os2)
  view.setUint32(24, 6)
  view.setUint16(os2 + 4, weight)
  return new File([buf], 'archivo.ttf')
}
/** A WOFF2 signature: sniffFontWeight cannot read one (Brotli), so it answers null. */
const woff2 = () => new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0])], 'archivo.woff2')

const onClose = vi.fn()
const open = (props: Partial<Parameters<typeof FontUploadDialog>[0]> = {}) =>
  render(<FontUploadDialog artistId="a1" slot="primary" title="Primary" onClose={onClose} {...props} />)
const dialog = () => screen.getByRole('dialog', { name: 'Upload a font' })
const fileInput = () => dialog().querySelector('input[type="file"]') as HTMLInputElement
const name = (value: string) => fireEvent.change(screen.getByLabelText('Font name'), { target: { value } })

/** Run the row write the way the upload hook would, after the object is in the bucket.
 *  Wrapped in an object: an async function RETURNING a promise would wait for it, and a
 *  write that is waiting on the weight question would then wait forever. */
async function drop(file: File, path = PATH): Promise<{ done: Promise<string | null> }> {
  let done!: Promise<string | null>
  await act(async () => {
    done = upload.opts!.writeRow(path, file)
  })
  return { done }
}

beforeEach(() => {
  upload.opts = null
  mAdd.mockResolvedValue({})
})
afterEach(cleanup)

describe('FontUploadDialog — before the file', () => {
  it('CRITICAL: the file input is disabled until the font is named', () => {
    open()
    expect(fileInput().disabled).toBe(true)
    name('Archivo')
    expect(fileInput().disabled).toBe(false)
  })

  it('CRITICAL: a reserved name is refused before any upload', () => {
    // "Bold" would emit `.font-bold` and retype every bold word on the site; the server
    // refuses it too, but its sentence is swallowed by the upload's generic error copy.
    open()
    name('Bold')
    expect(within(dialog()).getByText(/reserved name/)).toBeInTheDocument()
    expect(fileInput().disabled).toBe(true)
    name('Primary')
    expect(fileInput().disabled).toBe(true)
    name('Primary Sans')
    expect(fileInput().disabled).toBe(false)
  })

  it('CRITICAL: the picker offers exactly the validated allowlist — no SVG, no wildcard', () => {
    open()
    expect(fileInput().accept).toBe(acceptFor(FONT_UPLOAD_RULES))
    expect(fileInput().accept).not.toMatch(/svg/i)
    expect(fileInput().accept).not.toContain('*')
  })

  it('names the row the upload fills', () => {
    // The upload IS the choice: the font lands in the row the dialog was opened from.
    open({ slot: 'custom_1', title: 'Gig posters' })
    expect(within(dialog()).getByText('Gig posters')).toBeInTheDocument()
  })

  it('names the licence responsibility', () => {
    open()
    expect(within(dialog()).getByText(/licence/i)).toBeInTheDocument()
  })
})

describe('FontUploadDialog — the weight', () => {
  it('CRITICAL: a ttf says its own weight — no question, and that weight is saved', async () => {
    open({ slot: 'secondary' })
    name('Archivo Bold')
    const { done } = await drop(ttf(700))
    expect(await done).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Weight' })).toBeNull()
    expect(mAdd).toHaveBeenCalledTimes(1)
    expect(mAdd).toHaveBeenCalledWith('a1', { label: 'Archivo Bold', storagePath: PATH, format: 'ttf', weight: 700 }, 'secondary')
  })

  it('CRITICAL: a woff2 asks for the weight, writes nothing until answered, then passes the answer', async () => {
    open()
    name('Archivo')
    const { done } = await drop(woff2(), 'a1/fonts/44444444-4444-4444-8444-444444444444.woff2')
    const weight = within(dialog()).getByRole('combobox', { name: 'Weight' })
    expect(mAdd).not.toHaveBeenCalled()

    fireEvent.click(weight)
    fireEvent.click(within(dialog()).getByRole('option', { name: 'Bold' }))
    await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' })))

    expect(await done).toBeNull()
    expect(mAdd).toHaveBeenCalledTimes(1)
    expect(mAdd).toHaveBeenCalledWith(
      'a1',
      { label: 'Archivo', storagePath: 'a1/fonts/44444444-4444-4444-8444-444444444444.woff2', format: 'woff2', weight: 700 },
      'primary',
    )
  })

  it('CRITICAL: a file that says a weight outside 100–900 is ASKED about — never refused, never deleted', async () => {
    // Before 2026-09-23 a ttf saying 950 went straight to addArtistFontAction, the server
    // said "Font weight must be between 100 and 900", and the upload deleted the file.
    for (const odd of [950, 1000, 50, 0]) {
      mAdd.mockClear()
      const view = open()
      name('Heavy')
      const { done } = await drop(ttf(odd))
      expect(within(dialog()).getByRole('combobox', { name: 'Weight' }), `asks for ${odd}`).toBeTruthy()
      expect(mAdd).not.toHaveBeenCalled()
      fireEvent.click(within(dialog()).getByRole('combobox', { name: 'Weight' }))
      fireEvent.click(within(dialog()).getByRole('option', { name: 'Black' }))
      await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' })))
      expect(await done).toBeNull()
      expect(mAdd).toHaveBeenCalledWith('a1', expect.objectContaining({ format: 'ttf', weight: 900 }), 'primary')
      view.unmount()
    }
  })

  it('the question offers every standard weight, Regular first chosen', async () => {
    open()
    name('Archivo')
    await drop(woff2())
    const weight = within(dialog()).getByRole('combobox', { name: 'Weight' })
    expect(weight).toHaveTextContent('Regular')
    fireEvent.click(weight)
    expect(within(dialog()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Thin',
      'Extra Light',
      'Light',
      'Regular',
      'Medium',
      'Semi Bold',
      'Bold',
      'Extra Bold',
      'Black',
    ])
  })

  it('closing at the question keeps the upload, with the weight unknown — in the library, not the row', async () => {
    // The file is already in the bucket; a dismissed question is not a reason to delete
    // the font. The weight is advisory, so it is saved as unknown. But a closed dialog has
    // given up its row (review 2, 2026-09-24), so nothing is placed.
    const onPlaced = vi.fn()
    open({ onPlaced })
    name('Archivo')
    const { done } = await drop(woff2())
    await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' })))
    expect(await done).toBeNull()
    expect(mAdd.mock.calls[0]).toEqual(['a1', expect.objectContaining({ weight: null })])
    expect(onPlaced).not.toHaveBeenCalled()
    expect(mToast).toHaveBeenCalledWith('Archivo was saved without its weight.')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('FontUploadDialog — the row it fills', () => {
  it('an added row’s title and note ride along with the upload', async () => {
    open({ slot: 'custom_2', title: 'Gig posters', meta: { label: 'Gig posters', note: 'For merch' } })
    name('Archivo')
    await drop(ttf(400))
    expect(mAdd).toHaveBeenCalledWith('a1', expect.objectContaining({ weight: 400 }), 'custom_2', { label: 'Gig posters', note: 'For merch' })
  })

  it('a refusal is handed back to the upload (so the object is removed)', async () => {
    mAdd.mockResolvedValueOnce({ error: 'You can keep up to 12 fonts.' })
    open()
    name('Archivo')
    const { done } = await drop(ttf(400))
    expect(await done).toBe('You can keep up to 12 fonts.')
  })

  it('a font saved but not placed is an error toast, and the file is kept', async () => {
    mAdd.mockResolvedValueOnce({ warning: 'The font was added but could not be placed.' })
    const onPlaced = vi.fn()
    open({ onPlaced })
    name('Archivo')
    const { done } = await drop(ttf(400))
    expect(await done).toBeNull()
    expect(mToast).toHaveBeenCalledWith('The font was added but could not be placed.', 'error')
    // …and the row it was opened from is NOT told it is filled: an unsaved added row that
    // believed it was saved would send its later rename to a slot row that does not exist.
    expect(onPlaced).not.toHaveBeenCalled()
  })

  it('a font saved AND placed tells the row so', async () => {
    const onPlaced = vi.fn()
    open({ onPlaced })
    name('Archivo')
    const { done } = await drop(ttf(400))
    expect(await done).toBeNull()
    expect(onPlaced).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: a dialog that goes away mid-question (not via Close) still answers it — the upload never hangs', async () => {
    // The unmount effect answers "unknown". Without it, writeRow awaits forever: the upload
    // sits on busy with its object in the bucket and no row naming it.
    const view = open()
    name('Archivo')
    const { done } = await drop(woff2())
    view.unmount()
    const hung = new Promise((r) => setTimeout(() => r('still waiting'), 300))
    expect(await Promise.race([done, hung])).toBeNull()
    expect(mAdd.mock.calls[0]).toEqual(['a1', expect.objectContaining({ weight: null })])
  })

  describe('CRITICAL: closed while the file is still uploading, the font is kept — and the manager is told', () => {
    // UploadField keeps going after the dialog is gone: the object lands in the bucket and
    // writeRow runs with no dialog to ask the WOFF2 question in. It used to wait on that
    // question forever: no row, the file orphaned, nothing said. Now a question that cannot
    // be asked is answered "unknown" at once, the font is written, and a toast says so.
    //
    // Review 2 (2026-09-24): …into the LIBRARY, not the row. By the time a late upload lands
    // the manager may have picked another font for that row, or dropped the unsaved row it
    // was for; placing it then overwrote their newer choice with nothing on screen. A
    // closed dialog has given up its row: the font arrives in the Change menu instead.
    const CLOSERS: [string, () => void][] = [
      ['Save', () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))],
      ['×', () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))],
      ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ]
    for (const [how, close] of CLOSERS) {
      it(`closed with ${how}`, async () => {
        onClose.mockClear()
        const onPlaced = vi.fn()
        const view = open({ onPlaced })
        name('Archivo')
        act(close)
        expect(onClose).toHaveBeenCalled()
        view.unmount() // what the ledger does on onClose
        const { done } = await drop(woff2(), 'a1/fonts/44444444-4444-4444-8444-444444444444.woff2')
        const hung = new Promise((r) => setTimeout(() => r('still waiting'), 300))
        expect(await Promise.race([done, hung])).toBeNull()
        expect(mAdd).toHaveBeenCalledTimes(1)
        // Exactly two arguments: the font, and NO slot to place it in.
        expect(mAdd.mock.calls[0]).toEqual([
          'a1',
          { label: 'Archivo', storagePath: 'a1/fonts/44444444-4444-4444-8444-444444444444.woff2', format: 'woff2', weight: null },
        ])
        expect(onPlaced).not.toHaveBeenCalled()
        expect(mToast).toHaveBeenCalledWith('Archivo was saved without its weight.')
      })
    }

    it('a ttf closed mid-upload knows its own weight, so nothing is said about it', async () => {
      const view = open()
      name('Archivo')
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
      view.unmount()
      const { done } = await drop(ttf(700))
      expect(await done).toBeNull()
      expect(mAdd.mock.calls[0]).toEqual(['a1', expect.objectContaining({ weight: 700 })])
      expect(mToast).not.toHaveBeenCalled()
    })

    it('an unsaved added row closed mid-upload is not saved by the late font (no slot, no title, no note)', async () => {
      const onPlaced = vi.fn()
      const view = open({ slot: 'custom_2', title: 'Gig posters', meta: { label: 'Gig posters', note: 'For merch' }, onPlaced })
      name('Archivo')
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
      view.unmount()
      const { done } = await drop(ttf(400))
      expect(await done).toBeNull()
      expect(mAdd.mock.calls[0]).toEqual(['a1', expect.objectContaining({ label: 'Archivo', weight: 400 })])
      expect(onPlaced).not.toHaveBeenCalled()
    })

    it('CRITICAL: the late upload\'s success does not close anything — it is not its dialog any more', async () => {
      // `onSuccess` is captured when the upload STARTS. Wired straight to onClose, a late one
      // closed whatever dialog the ledger showed by then — a different row's.
      onClose.mockClear()
      const view = open()
      name('Archivo')
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      const late = upload.opts!.onSuccess
      view.unmount()
      act(() => late?.())
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('the witness: an upload that finishes while its dialog is open closes it', () => {
      onClose.mockClear()
      open()
      name('Archivo')
      act(() => upload.opts!.onSuccess?.())
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('Save with nothing waiting just closes', () => {
    open()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    expect(onClose).toHaveBeenCalled()
    expect(mAdd).not.toHaveBeenCalled()
  })
})
