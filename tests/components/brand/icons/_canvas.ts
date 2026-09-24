/**
 * jsdom has no canvas and never loads images. The icon editor's promise is about WHAT it
 * asks a canvas to draw — the same framing on the board and in the exported file — so a
 * recorder is the honest stand-in: every `drawImage` is logged with the size of the canvas
 * it landed on, and `toBlob` really produces a blob so a save gets past the export.
 *
 * `FakeImage` fires onload on a microtask with a wide wordmark's size (the hard case), or
 * onerror for any src listed in `failing`. `srcs` records every image the editor loaded.
 * A src passed to `hold` does not load until the function it returns is called — a slow
 * network, on demand.
 *
 * Not a test file (no `.test.`), so vitest never runs it on its own.
 */
import { vi } from 'vitest'

export const LOGO = { width: 1000, height: 200 }

export type Draw = { size: number; args: number[] }
export const canvas = {
  draws: [] as Draw[],
  srcs: [] as string[],
  failing: new Set<string>(),
  held: new Map<string, (() => void)[]>(),
}

/** Hold every load of `src` until the returned function is called. */
export function hold(src: string): () => void {
  canvas.held.set(src, canvas.held.get(src) ?? [])
  return () => {
    const waiting = canvas.held.get(src) ?? []
    canvas.held.delete(src)
    waiting.forEach((fire) => fire())
  }
}

export function installCanvasFakes() {
  canvas.draws = []
  canvas.srcs = []
  canvas.failing = new Set()
  canvas.held = new Map()
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const size = this.width
    return {
      clearRect: () => {},
      drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
        canvas.draws.push({ size, args: [x, y, w, h] })
      },
    } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['png'], { type: 'image/png' }))
  }

  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    crossOrigin = ''
    width = LOGO.width
    height = LOGO.height
    naturalWidth = LOGO.width
    naturalHeight = LOGO.height
    set src(v: string) {
      canvas.srcs.push(v)
      const fire = () => (canvas.failing.has(v) ? this.onerror?.() : this.onload?.())
      const held = canvas.held.get(v)
      if (held) held.push(() => queueMicrotask(fire))
      else queueMicrotask(fire)
    }
  }
  vi.stubGlobal('Image', FakeImage)
}

/** The last box drawn onto a canvas of `size`. */
export const lastDrawAt = (size: number) => canvas.draws.filter((d) => d.size === size).at(-1)?.args

/**
 * Deterministic time for the icon editor's tests (fix round, 2026-09-23: three of them
 * flaked once under a loaded machine and never alone). Everything here runs on FAKE timers:
 *   • `settle()` flushes microtasks, effects and zero-delay work — an image "load", a draw,
 *     a save's chain of awaits — without any wall-clock wait;
 *   • `pass(ms)` moves the clock, so "nothing saved within the save window" is a fact about
 *     the code, not about how busy the machine was.
 * No `waitFor` polling (its interval would be a fake timer too): each step is flushed, then
 * asserted.
 */
export async function settle(rounds = 4): Promise<void> {
  const { act } = await import('@testing-library/react')
  for (let i = 0; i < rounds; i++) await act(async () => vi.advanceTimersByTimeAsync(0))
}

export async function pass(ms: number): Promise<void> {
  const { act } = await import('@testing-library/react')
  await act(async () => vi.advanceTimersByTimeAsync(ms))
  await settle()
}

/**
 * The end of every test: unmount (which may start the editor's save-on-close), let that save
 * finish HERE, and drop any `mockResolvedValueOnce` the test did not consume — `clearMocks`
 * clears call history but keeps queued once-values, which then answer the NEXT test's call.
 */
export async function drain(): Promise<void> {
  const { cleanup } = await import('@testing-library/react')
  cleanup()
  await settle(6)
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
}
