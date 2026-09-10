// @vitest-environment jsdom
// The tab-icon controls, checked by what they ask the canvas to draw.
/**
 * FaviconEditor — the controls behind the tab icon.
 *
 * jsdom has no canvas implementation, so `getContext` is stubbed with a recorder. That
 * is not a limitation here, it is the point: what matters is WHAT the component asks the
 * canvas to draw, and that both canvases are driven from the same framing. The pixel
 * work itself is `drawFavicon`, unit-tested in brand.test.ts.
 *
 * The claim under test is the product promise: the true-size preview is the file that
 * gets served, so anything that could make the two disagree has to fail here.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FaviconEditor } from '@/app/artists/[id]/(dashboard)/brand/favicon-editor'
import { DEFAULT_FRAMING, FAVICON_PREVIEW_SIZE, FAVICON_SIZE, faviconDrawBox } from '@/lib/brand'

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  setBrandAssetAction: vi.fn(async () => ({})),
  saveFramingAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }),
}))

const LOGO = { width: 1000, height: 200 } // a wide wordmark — the hard case

/** Every drawImage the component issued, tagged with the canvas size it drew onto. */
let draws: { size: number; args: number[] }[] = []

beforeEach(() => {
  draws = []
  // One recorder per canvas; `size` comes from the canvas the context belongs to.
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    // Read the size off the canvas HERE rather than holding on to the element: the
    // width is fixed by the time a context is asked for, and it keeps the closure from
    // capturing `this`.
    const size = this.width
    return {
      clearRect: () => {},
      drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
        draws.push({ size, args: [x, y, w, h] })
      },
    } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext

  // jsdom never loads images: fire onload synchronously with the natural size set.
  class FakeImage {
    onload: (() => void) | null = null
    crossOrigin = ''
    width = LOGO.width
    height = LOGO.height
    naturalWidth = LOGO.width
    naturalHeight = LOGO.height
    set src(_v: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderEditor = async (framing = DEFAULT_FRAMING) => {
  const view = render(
    <FaviconEditor artistId="a1" logoUrl="https://img.example/logo.png" initialFraming={framing} />,
  )
  await waitFor(() => expect(draws.length).toBeGreaterThan(0))
  return view
}

describe('FaviconEditor', () => {
  it('offers nothing to frame when there is no primary logo', () => {
    render(<FaviconEditor artistId="a1" logoUrl={null} initialFraming={DEFAULT_FRAMING} />)
    expect(screen.getByText(/Add a primary logo/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Zoom')).toBeNull()
  })

  it('CRITICAL: the true-size preview canvas is really 32px — not a flattering enlargement', () => {
    // If this ever became a scaled-up canvas, the manager would be approving something
    // legible that a browser tab then renders as a smudge.
    render(<FaviconEditor artistId="a1" logoUrl="https://x/l.png" initialFraming={DEFAULT_FRAMING} />)
    const preview = screen.getByLabelText('Tab icon at true size') as HTMLCanvasElement
    expect(preview.width).toBe(FAVICON_PREVIEW_SIZE)
    expect(preview.height).toBe(FAVICON_PREVIEW_SIZE)
  })

  it('CRITICAL: both canvases draw the SAME framing, each scaled to its own size', async () => {
    await renderEditor()
    const bySize = new Map(draws.map((d) => [d.size, d.args]))
    for (const [size, args] of bySize) {
      const box = faviconDrawBox(LOGO, DEFAULT_FRAMING, size)
      expect(args, `canvas ${size}`).toEqual([box.x, box.y, box.width, box.height])
    }
    expect(bySize.size).toBe(2) // the working view and the true-size preview
  })

  it('zooming redraws larger on every canvas', async () => {
    await renderEditor()
    const before = new Map(draws.map((d) => [d.size, d.args]))
    draws = []

    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '3' } })
    await waitFor(() => expect(draws.length).toBeGreaterThan(0))

    for (const d of draws) {
      const [, , w] = d.args
      expect(w).toBeGreaterThan(before.get(d.size)![2])
    }
  })

  it('CRITICAL: "Move up" moves the logo up, and "Move down" moves it back', async () => {
    await renderEditor()
    const yAt = () => draws.find((d) => d.size === FAVICON_PREVIEW_SIZE)!.args[1]
    const start = yAt()

    draws = []
    fireEvent.click(screen.getByRole('button', { name: 'Move logo up' }))
    await waitFor(() => expect(draws.length).toBeGreaterThan(0))
    const up = yAt()
    expect(up).toBeLessThan(start) // a smaller y is higher on the canvas

    draws = []
    fireEvent.click(screen.getByRole('button', { name: 'Move logo down' }))
    await waitFor(() => expect(draws.length).toBeGreaterThan(0))
    expect(yAt()).toBeCloseTo(start)
  })

  it('Reset returns to the whole logo, centred', async () => {
    await renderEditor({ zoom: 4, offsetY: 0.4 })
    draws = []
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(draws.length).toBeGreaterThan(0))

    const drawn = draws.find((d) => d.size === FAVICON_PREVIEW_SIZE)!.args
    const box = faviconDrawBox(LOGO, DEFAULT_FRAMING, FAVICON_PREVIEW_SIZE)
    expect(drawn).toEqual([box.x, box.y, box.width, box.height])
  })

  it('opens with the SAVED framing, not the default', async () => {
    const saved = { zoom: 2.5, offsetY: -0.2 }
    await renderEditor(saved)
    const drawn = draws.find((d) => d.size === FAVICON_PREVIEW_SIZE)!.args
    const box = faviconDrawBox(LOGO, saved, FAVICON_PREVIEW_SIZE)
    expect(drawn).toEqual([box.x, box.y, box.width, box.height])
  })
})

describe('FaviconEditor — saving', () => {
  it('CRITICAL: saves the framing BEFORE the asset, so a failed upload keeps the adjustment', async () => {
    const { saveFramingAction, setBrandAssetAction } = await import(
      '@/app/artists/[id]/(dashboard)/brand/actions'
    )
    // jsdom canvases cannot encode: stub the export so the save path can be exercised.
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['png'], { type: 'image/png' }))
    }
    await renderEditor()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save tab icon' }))
    })

    await waitFor(() => expect(vi.mocked(setBrandAssetAction)).toHaveBeenCalled())
    const framingOrder = vi.mocked(saveFramingAction).mock.invocationCallOrder[0]
    const assetOrder = vi.mocked(setBrandAssetAction).mock.invocationCallOrder[0]
    expect(framingOrder).toBeLessThan(assetOrder)
    expect(vi.mocked(setBrandAssetAction).mock.calls[0][1]).toBe('favicon')
  })

  it('CRITICAL: exports at FAVICON_SIZE, not at the 32px preview size', async () => {
    // The preview is what the manager JUDGES; the file has to be big enough for a
    // retina tab and the home-screen icon. Exporting the preview would ship a
    // 32px image that every other surface then upscales into mush.
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['png'], { type: 'image/png' }))
    }
    // A NON-default framing on purpose. With the default, "exports the manager's framing"
    // and "exports the default framing" are the same assertion, and a bug that ignored
    // the manager's adjustment entirely would sail through. (A mutation check caught
    // exactly that, 2026-08-04.)
    const chosen = { zoom: 3.5, offsetY: -0.35 }
    await renderEditor(chosen)
    draws = []

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save tab icon' }))
    })

    await waitFor(() => expect(draws.some((d) => d.size === FAVICON_SIZE)).toBe(true))
    const exported = draws.find((d) => d.size === FAVICON_SIZE)!.args
    const box = faviconDrawBox(LOGO, chosen, FAVICON_SIZE)
    expect(exported).toEqual([box.x, box.y, box.width, box.height])

    // The whole product promise in one line: the file written is the framing the
    // true-size preview was showing when the manager pressed save.
    const previewBox = faviconDrawBox(LOGO, chosen, FAVICON_PREVIEW_SIZE)
    const ratio = FAVICON_SIZE / FAVICON_PREVIEW_SIZE
    expect(exported[2]).toBeCloseTo(previewBox.width * ratio)
    expect(exported[1]).toBeCloseTo(previewBox.y * ratio)
  })
})
