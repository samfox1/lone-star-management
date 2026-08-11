// @vitest-environment jsdom
/**
 * The compression gate a picked file passes through before upload
 * (BRIEF-asset-compression.md, skeen repo).
 *
 * The contract under test: `prepare(file)` resolves with the file to actually upload —
 * the original (within budget / declined), the compressed one (accepted), or null
 * (cancelled / gated). The pure verdict logic has its own suite (asset-budget.test.ts);
 * this one proves the MODAL honours it: no dialog for a clean file, a proposal for an
 * oversized image, no "Upload original" past the 4× ceiling, and a hard gate for video.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useBudgetGate } from '@/app/artists/[id]/(dashboard)/budget-gate'
import { DEFAULT_BUDGETS, type AssetBudget, type UploadKind } from '@/lib/site-editor/asset-budget'

// The DOM pipeline is mocked — jsdom has no canvas or createImageBitmap. Its real
// behaviour is covered by the pure geometry/walk tests; HERE the subject is the flow.
// A fake ImageBitmap whose only jobs are to carry dimensions and count closes —
// the gate measures the edge itself now (decode-once, 2026-08-11).
let closedBitmaps = 0
const fakeBitmap = (edge: number) => ({ width: edge, height: Math.round(edge * 0.75), close: () => { closedBitmaps += 1 } })
const decodeImageBitmap = vi.fn<(f: File) => Promise<ReturnType<typeof fakeBitmap> | null>>()
/** The old mock's shape, kept as the tests' vocabulary: an edge, or undefined for a
 *  failed decode. */
const decodeEdgePx = { mockResolvedValue: (edge: number | undefined) =>
  decodeImageBitmap.mockResolvedValue(edge === undefined ? null : fakeBitmap(edge)) }
const compressImageFile = vi.fn()
vi.mock('@/lib/site-editor/compress-image', () => ({
  decodeImageBitmap: (f: File) => decodeImageBitmap(f),
  compressImageFile: (f: File, b: AssetBudget, pre?: unknown) => compressImageFile(f, b, pre),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const POLAROID: AssetBudget = { maxEdgePx: 1200, maxBytes: 400_000, mime: 'image/webp' }
const VIDEO: AssetBudget = { maxBytes: 25_000_000 }

/** A fake file of an exact byte size without allocating it. */
function fakeFile(size: number, type = 'image/jpeg', name = 'photo.jpg'): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const SMALL_WEBP = new File(['tiny'], 'photo.webp', { type: 'image/webp' })

/** Mounts the gate and exposes prepare()'s resolution for assertions. */
function Probe({ kind, budget, file }: { kind: UploadKind; budget: AssetBudget | null; file: File }) {
  const gate = useBudgetGate(kind, budget)
  const [result, setResult] = useState<string>('pending')
  return (
    <div>
      <button
        onClick={() => {
          void gate.prepare(file).then((f) => setResult(f === null ? 'null' : f.name))
        }}
      >
        pick
      </button>
      <output>{result}</output>
      {gate.modal}
    </div>
  )
}

const pick = () => fireEvent.click(screen.getByText('pick'))
const result = () => screen.getByRole('status').textContent

describe('useBudgetGate', () => {
  it('CRITICAL: a file within budget resolves untouched, with NO dialog', async () => {
    decodeEdgePx.mockResolvedValue(1100)
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(300_000)} />)
    pick()
    await waitFor(() => expect(result()).toBe('photo.jpg'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(compressImageFile).not.toHaveBeenCalled()
  })

  it('CRITICAL: no budget falls back to the FLOOR — an image is never ungated', async () => {
    // This asserted the reverse until 2026-08-06: no budget, no gate. Since budgets only
    // reach the app through the editor's frame bridge, that left every dashboard door
    // (Photos, Media, Brand) and every built-in template storing originals. Sam noticed
    // by uploading a photo and watching nothing happen.
    decodeEdgePx.mockResolvedValue(4000)
    compressImageFile.mockResolvedValue({ file: SMALL_WEBP, width: 2400, height: 1800, fits: true })
    render(<Probe kind="image" budget={null} file={fakeFile(50_000_000)} />)
    pick()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(compressImageFile).toHaveBeenCalledWith(expect.anything(), DEFAULT_BUDGETS.image, expect.objectContaining({ width: expect.any(Number) })))
  })

  it('CRITICAL: the floor still leaves the un-shrinkable alone', async () => {
    // No kind at all (a PDF rider, a song master) and formats the canvas would damage
    // (an animated GIF keeps one frame) must pass straight through. A floor that blocked
    // either would be a wall in front of an upload that worked yesterday, and the modal's
    // only advice would be "make it smaller yourself".
    render(<Probe kind={undefined as unknown as UploadKind} budget={null} file={fakeFile(50_000_000)} />)
    pick()
    await waitFor(() => expect(result()).toBe('photo.jpg'))

    cleanup()
    render(<Probe kind="image" budget={null} file={fakeFile(9_000_000, 'image/gif', 'loop.gif')} />)
    pick()
    await waitFor(() => expect(result()).toBe('loop.gif'))
    expect(decodeImageBitmap).not.toHaveBeenCalled()
  })

  it('an oversized image opens the proposal; accepting resolves the COMPRESSED file', async () => {
    decodeEdgePx.mockResolvedValue(4000)
    compressImageFile.mockResolvedValue({ file: SMALL_WEBP, width: 1200, height: 900, fits: true })
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(4_200_000, 'image/jpeg', 'big.jpg')} />)
    pick()

    // The proposal shows both ends of the trade so the manager can see what they keep.
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('4.0 MB')
    expect(dialog.textContent).toContain('1200')
    fireEvent.click(screen.getByRole('button', { name: /compress/i }))
    await waitFor(() => expect(result()).toBe('photo.webp'))
    expect(compressImageFile).toHaveBeenCalledWith(expect.anything(), POLAROID, expect.objectContaining({ width: expect.any(Number) }))
  })

  it('declining uploads the ORIGINAL — the budget is a default, not a cage', async () => {
    decodeEdgePx.mockResolvedValue(4000)
    compressImageFile.mockResolvedValue({ file: SMALL_WEBP, width: 1200, height: 900, fits: true })
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(900_000, 'image/jpeg', 'keep.jpg')} />)
    pick()
    fireEvent.click(await screen.findByRole('button', { name: /original/i }))
    await waitFor(() => expect(result()).toBe('keep.jpg'))
  })

  it('CRITICAL: past 4× over budget, "Upload original" is not offered', async () => {
    // 400KB budget × 4 = 1.6MB; 5MB is far past it. A file that size is never the right
    // upload, so the only ways out are compress or cancel.
    decodeEdgePx.mockResolvedValue(6000)
    compressImageFile.mockResolvedValue({ file: SMALL_WEBP, width: 1200, height: 900, fits: true })
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(5_000_000)} />)
    pick()
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: /original/i })).toBeNull()
    expect(screen.getByRole('button', { name: /compress/i })).toBeTruthy()
  })

  it('cancelling resolves null — nothing uploads', async () => {
    decodeEdgePx.mockResolvedValue(4000)
    compressImageFile.mockResolvedValue({ file: SMALL_WEBP, width: 1200, height: 900, fits: true })
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(4_200_000)} />)
    pick()
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(result()).toBe('null'))
  })

  it('CRITICAL: a within-budget HEIC still opens the proposal, with NO "Upload original"', async () => {
    // The iPhone default. Size is irrelevant — the media bucket refuses image/heic and
    // Chrome/Firefox visitors can't render one, so the raw file must never ship. The
    // manager's only ways out are the converted file or cancel.
    decodeEdgePx.mockResolvedValue(800)
    compressImageFile.mockResolvedValue({ file: SMALL_WEBP, width: 800, height: 600, fits: true })
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(90_000, 'image/heic', 'IMG_4021.heic')} />)
    pick()

    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: /original/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /compress/i }))
    await waitFor(() => expect(result()).toBe('photo.webp'))
  })

  it('a blank-mime HEIC is caught too — the gate hands the NAME to the verdict', async () => {
    // Windows reports no mime for .heic. The pure verdict already detects by extension;
    // this pins that the gate actually passes file.name through, without which that
    // detection is dead code on the one OS that needs it.
    decodeEdgePx.mockResolvedValue(800)
    compressImageFile.mockResolvedValue({ file: SMALL_WEBP, width: 800, height: 600, fits: true })
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(90_000, '', 'IMG_4021.heic')} />)
    pick()

    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /compress/i }))
    await waitFor(() => expect(result()).toBe('photo.webp'))
  })

  it('CRITICAL: a HEIC this browser cannot decode GATES with the Safari/export fix', async () => {
    // Chrome and Firefox cannot decode HEIC (Safari can). compressImageFile throws, and
    // the fallback gate copy must NOT be the GIF/SVG one — "would be damaged by
    // re-encoding" tells a manager holding an iPhone photo nothing. The copy this pins
    // names the format and both ways forward: Safari, or export a JPEG from Photos.
    decodeEdgePx.mockResolvedValue(undefined)
    compressImageFile.mockRejectedValue(new Error('createImageBitmap: unsupported source'))
    render(<Probe kind="image" budget={POLAROID} file={fakeFile(9_000_000, 'image/heic', 'IMG_4021.heic')} />)
    pick()

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.textContent).toMatch(/HEIC/))
    expect(dialog.textContent).toMatch(/Safari/)
    expect(dialog.textContent).toMatch(/JPEG/i)
    expect(screen.queryByRole('button', { name: /compress/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(result()).toBe('null'))
  })

  it('CRITICAL: an oversized video GATES — instructions, no compress button, null', async () => {
    // The browser does not transcode video; pretending otherwise would hang a laptop for
    // minutes and produce something worse than any export tool.
    render(<Probe kind="video" budget={VIDEO} file={fakeFile(200_000_000, 'video/mp4', 'clip.mov')} />)
    pick()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/1080p|export/i)
    expect(screen.queryByRole('button', { name: /compress/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /cancel|close/i }))
    await waitFor(() => expect(result()).toBe('null'))
    expect(compressImageFile).not.toHaveBeenCalled()
  })

  it('a video within budget passes silently', async () => {
    render(<Probe kind="video" budget={VIDEO} file={fakeFile(18_000_000, 'video/mp4', 'clip.mp4')} />)
    pick()
    await waitFor(() => expect(result()).toBe('clip.mp4'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
