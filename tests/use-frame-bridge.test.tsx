// @vitest-environment jsdom
/**
 * useFrameBridge — the editor's conversation with the site frame.
 *
 * Every failure mode here is SILENT. A postMessage aimed at the wrong target origin
 * is dropped by the browser with no error; an inbound message from the wrong origin
 * that we fail to reject is a stranger driving the editor. Nothing throws, nothing
 * logs — the frame just sits there. So these assert the rules directly rather than
 * through a rendered iframe (jsdom won't load a cross-origin frame anyway).
 *
 * Two real bugs motivated this file, both of which shipped and neither of which the
 * previous "coverage" could catch:
 *   1. apply-field posted to `window.location.origin` — unreachable for a custom
 *      site on another origin.
 *   2. the test that looked like it covered `frameSrc` re-implemented the rule and
 *      asserted against its own copy, so it passed no matter what the shell did.
 *      These import the real functions.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { frameOrigin, frameSrc, useFrameBridge, HELLO_RETRY_MS, HELLO_TIMEOUT_MS } from '@/app/artists/[id]/(dashboard)/editor/use-frame-bridge'
import { BRIDGE_VERSION, FRAME_SOURCE } from '@samfox1/site-bridge/protocol'
import type { PublicSitePayload } from '@/lib/site'

const CUSTOM = 'https://skeen-website.vercel.app'

/** Every message the editor posted, by type. */
const posted = (frame: { postMessage: ReturnType<typeof vi.fn> }, type: string) =>
  frame.postMessage.mock.calls.filter((c) => (c[0] as { type?: string })?.type === type)

const draft: PublicSitePayload = {
  artist: {
    id: 'a1', slug: 'skeen', name: 'Skeen', bio: null,
    hero_image_url: null, template: 'classic', spotify_artist_id: null,
  },
  tracks: [], tour_dates: [], merch: [], links: [], videos: [],
  media: [{ purpose: 'gallery_image', path: 'a1/gallery/one.jpg' }],
  site_content: {},
  styles: {},
  fonts: [],
  font_slots: {},
}

/** A stand-in for the iframe's contentWindow — the thing we postMessage into. */
function fakeFrame() {
  const postMessage = vi.fn()
  // addEventListener too: the editor listens for the iframe's `load` to send `hello`.
  const el = {
    contentWindow: { postMessage },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLIFrameElement
  return { postMessage, el }
}

/** Mount the hook with a fake frame already attached, as the real iframe ref would be. */
function mount(opts: { customSiteUrl?: string | null; draft?: PublicSitePayload | null } = {}) {
  const frame = fakeFrame()
  const hook = renderHook(() =>
    useFrameBridge({ artistId: 'a1', customSiteUrl: opts.customSiteUrl ?? null, draft: opts.draft ?? null }),
  )
  hook.result.current.frameRef.current = frame.el
  return { ...hook, frame }
}

/** Simulate the frame posting to the editor from `origin`. */
function frameSays(msg: Record<string, unknown>, origin: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { v: BRIDGE_VERSION, source: FRAME_SOURCE, ...msg }, origin }),
    )
  })
}

describe('frameSrc — where the frame loads from', () => {
  it('uses the same-origin edit-mode route for a built-in template', () => {
    expect(frameSrc('a1', null)).toBe('/artists/a1/edit-frame')
  })

  it("uses a custom site's own /edit route", () => {
    expect(frameSrc('a1', CUSTOM)).toBe(`${CUSTOM}/edit`)
  })

  it('tolerates a trailing slash (no //edit)', () => {
    expect(frameSrc('a1', `${CUSTOM}/`)).toBe(`${CUSTOM}/edit`)
  })
})

describe('frameOrigin — the only origin we trust', () => {
  it("is the custom site's ORIGIN, not its full url", () => {
    // Posting to the full url would never match and the browser would drop it.
    expect(frameOrigin(`${CUSTOM}/edit`, 'http://localhost:3000')).toBe(CUSTOM)
  })

  it("falls back to the editor's own origin for a built-in template", () => {
    expect(frameOrigin(null, 'http://localhost:3000')).toBe('http://localhost:3000')
  })
})

describe('outbound: apply-field / apply-style', () => {
  it('posts to the CUSTOM frame origin — not the editor\'s own', () => {
    // The bug this exists for: posting window.location.origin to a cross-origin
    // frame is silently dropped, and the preview simply never updates.
    const { result, frame } = mount({ customSiteUrl: CUSTOM })
    act(() => result.current.applyField('hero_tagline', 'hi'))

    expect(frame.postMessage).toHaveBeenCalledTimes(1)
    const [msg, origin] = frame.postMessage.mock.calls[0]
    expect(origin).toBe(CUSTOM)
    expect(msg).toMatchObject({ type: 'apply-field', key: 'hero_tagline', value: 'hi', v: BRIDGE_VERSION })
  })

  it('posts to our own origin for a built-in frame', () => {
    const { result, frame } = mount({ customSiteUrl: null })
    act(() => result.current.applyStyle('hero_wordmark', 'text-9xl'))
    expect(frame.postMessage.mock.calls[0][1]).toBe(window.location.origin)
  })

  it('never posts to the "*" wildcard', () => {
    // '*' would hand the draft to whatever document occupied the frame.
    const { result, frame } = mount({ customSiteUrl: CUSTOM })
    act(() => result.current.applyStyle('footer', 'bg-black'))
    expect(frame.postMessage.mock.calls[0][1]).not.toBe('*')
  })
})

describe('inbound: the ready → init-data handshake', () => {
  it('answers a custom frame\'s `ready` with the draft', () => {
    const { frame } = mount({ customSiteUrl: CUSTOM, draft })
    frameSays({ type: 'ready' }, CUSTOM)

    const initData = frame.postMessage.mock.calls.find(([m]) => m.type === 'init-data')
    expect(initData).toBeDefined()
    expect(initData![0].site).toEqual(draft)
    expect(initData![1]).toBe(CUSTOM) // targeted, never '*'
  })

  it('captures a custom site\'s edit-list from `ready` (D-D)', () => {
    // The ONLY way the editor learns skeen's style regions.
    const manifest = { template: 'skeen', fields: [], slots: [], styles: [{ key: 'hero_wordmark', label: 'Hero' }] }
    const { result } = mount({ customSiteUrl: CUSTOM, draft })
    frameSays({ type: 'ready', manifest }, CUSTOM)
    expect(result.current.manifest?.styles).toEqual([{ key: 'hero_wordmark', label: 'Hero' }])
  })

  it('sends NOTHING to a built-in frame — it reads its own draft server-side', () => {
    const { frame } = mount({ customSiteUrl: null, draft: null })
    frameSays({ type: 'ready' }, window.location.origin)
    expect(frame.postMessage).not.toHaveBeenCalled()
  })
})

describe('inbound: origin + shape guards', () => {
  it('CRITICAL: ignores `ready` from the wrong origin', () => {
    // Otherwise any page that framed us could ask for the artist's draft.
    const { frame } = mount({ customSiteUrl: CUSTOM, draft })
    frameSays({ type: 'ready' }, 'https://evil.example')
    expect(frame.postMessage).not.toHaveBeenCalled()
  })

  it('CRITICAL: ignores a `select` from the wrong origin', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'select', target: { kind: 'style', key: 'footer' }, rect: {} }, 'https://evil.example')
    expect(result.current.selectedStyle).toBeNull()
  })

  it('ignores a right-origin message at the wrong bridge version', () => {
    const { frame } = mount({ customSiteUrl: CUSTOM, draft })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { v: BRIDGE_VERSION + 1, source: FRAME_SOURCE, type: 'ready' },
          origin: CUSTOM,
        }),
      )
    })
    expect(frame.postMessage).not.toHaveBeenCalled()
  })

  it('ignores unrelated postMessage traffic on the same origin', () => {
    const { frame } = mount({ customSiteUrl: CUSTOM, draft })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' }, origin: CUSTOM }))
    })
    expect(frame.postMessage).not.toHaveBeenCalled() // no source/version stamp
  })
})

describe('inbound: select routing', () => {
  it("CRITICAL: a 'measured' reply lands in measuredRegion — panel editors park on it", () => {
    // Bridge 0.25.2 (Sam: "The transparency slider isnt lined up properly, same error
    // as before"): a panel-opened item editor asks the frame to measure; the answer
    // must arrive here keyed, so the editor can match it to the open item.
    const { result } = mount({ customSiteUrl: CUSTOM })
    const measured = { fontSizePx: 16, lineHeightPx: null, letterSpacingPx: 0, padTopPx: 0, padBottomPx: 0, padLeftPx: 0, padRightPx: 0, gapPx: null, childWidthPx: null, opacity: 0.4, transformScale: null, borderWidthPx: 0, radiusPx: 0 }
    frameSays({ type: 'measured', key: 'slot:backdrop_1_desktop', measured }, CUSTOM)
    expect(result.current.measuredRegion).toEqual({ key: 'slot:backdrop_1_desktop', measured })
  })

  it('reports a style-region click so the inspector can focus it — key, nonce, measurement', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    const measured = { fontSizePx: 16, lineHeightPx: 27.2, letterSpacingPx: 0, padTopPx: 0, padBottomPx: 0, padLeftPx: 0, padRightPx: 0, gapPx: null, childWidthPx: null }
    frameSays({ type: 'select', target: { kind: 'style', key: 'hero_wordmark' }, rect: {}, measured }, CUSTOM)
    expect(result.current.selectedStyle).toMatchObject({ key: 'hero_wordmark', nonce: 1, measured })
    // A style select is NOT an image region — it doesn't also fire selectedRegion.
    expect(result.current.selectedRegion).toBeNull()

    // A REPEAT click on the same region is a new gesture: the nonce ticks (the
    // Listen-button lesson, 2026-08-17 — a bare key never re-fired).
    frameSays({ type: 'select', target: { kind: 'style', key: 'hero_wordmark' }, rect: {} }, CUSTOM)
    expect(result.current.selectedStyle).toMatchObject({ key: 'hero_wordmark', nonce: 2 })
  })

  it('reports a field/slot/item click as selectedRegion (the inspector decides if it\'s an image)', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'select', target: { kind: 'field', key: 'hero_image' }, rect: {} }, CUSTOM)
    expect(result.current.selectedRegion?.target).toEqual({ kind: 'field', key: 'hero_image' })
    expect(result.current.selectedStyle).toBeNull()
  })

  it('bumps the nonce so re-clicking the SAME region re-fires the focus', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'select', target: { kind: 'item', assetType: 'image', id: 'g1' }, rect: {} }, CUSTOM)
    const first = result.current.selectedRegion!.nonce
    frameSays({ type: 'select', target: { kind: 'item', assetType: 'image', id: 'g1' }, rect: {} }, CUSTOM)
    expect(result.current.selectedRegion!.nonce).toBe(first + 1)
  })
})

describe('outbound: highlight / clear-highlight', () => {
  it('posts a highlight for a tile click, targeted at the frame origin', () => {
    const { result, frame } = mount({ customSiteUrl: CUSTOM })
    act(() => result.current.applyHighlight({ kind: 'field', key: 'hero_image' }))
    const [msg, origin] = frame.postMessage.mock.calls[0]
    expect(origin).toBe(CUSTOM)
    expect(msg).toMatchObject({ type: 'highlight', target: { kind: 'field', key: 'hero_image' } })
  })

  it('posts clear-highlight on deselect', () => {
    const { result, frame } = mount({ customSiteUrl: CUSTOM })
    act(() => result.current.clearHighlight())
    expect(frame.postMessage.mock.calls[0][0]).toMatchObject({ type: 'clear-highlight' })
  })
})

describe('teardown', () => {
  it('stops listening on unmount', () => {
    // A leaked listener would keep answering `ready` with a stale draft.
    const { unmount, frame } = mount({ customSiteUrl: CUSTOM, draft })
    unmount()
    frameSays({ type: 'ready' }, CUSTOM)
    expect(frame.postMessage).not.toHaveBeenCalled()
  })
})

describe('hello — the editor asks until the frame answers', () => {
  it('keeps asking, then stops once the frame speaks', () => {
    // The frame announcing on its own was a race the editor could lose: this listener
    // re-attaches whenever `draft` changes, and a `ready` posted in the gap is dropped
    // silently. Both sides pushing means connecting no longer depends on who was first.
    vi.useFakeTimers()
    try {
      const { frame } = mount({ customSiteUrl: CUSTOM })
      act(() => {
        vi.advanceTimersByTime(HELLO_RETRY_MS * 3)
      })
      expect(posted(frame, 'hello').length).toBeGreaterThan(1)
      expect(posted(frame, 'hello')[0][1]).toBe(CUSTOM) // never '*'

      frameSays({ type: 'ready', manifest: { template: 'skeen', fields: [], slots: [], styles: [] } }, CUSTOM)
      const settled = posted(frame, 'hello').length
      act(() => {
        vi.advanceTimersByTime(HELLO_RETRY_MS * 10)
      })
      expect(posted(frame, 'hello')).toHaveLength(settled)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up asking rather than polling a dead frame forever', () => {
    vi.useFakeTimers()
    try {
      const { frame } = mount({ customSiteUrl: CUSTOM })
      act(() => {
        vi.advanceTimersByTime(HELLO_TIMEOUT_MS + HELLO_RETRY_MS * 20)
      })
      const stopped = posted(frame, 'hello').length
      act(() => {
        vi.advanceTimersByTime(HELLO_RETRY_MS * 20)
      })
      expect(posted(frame, 'hello')).toHaveLength(stopped)
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers a draft that arrives AFTER the frame was ready', () => {
    // `ready` only carries the draft if one is loaded; arriving first left the frame
    // waiting forever for data the editor already had.
    const frame = fakeFrame()
    const hook = renderHook(
      ({ d }: { d: PublicSitePayload | null }) =>
        useFrameBridge({ artistId: 'a1', customSiteUrl: CUSTOM, draft: d }),
      { initialProps: { d: null as PublicSitePayload | null } },
    )
    hook.result.current.frameRef.current = frame.el
    frameSays({ type: 'ready' }, CUSTOM)
    expect(posted(frame, 'init-data')).toHaveLength(0) // nothing to send yet

    hook.rerender({ d: draft })
    expect(posted(frame, 'init-data')).toHaveLength(1)
    expect(posted(frame, 'init-data')[0][1]).toBe(CUSTOM)
  })
})

describe('the editor’s mode survives a frame reload', () => {
  const CUSTOM_SITE = 'https://site.example'

  it('CRITICAL: a fresh `ready` re-asserts browse — the toolbar and the frame cannot split', () => {
    // 2026-08-10 review. The frame resets to `edit` whenever its page reloads, and in
    // browse mode every NAVIGATION is a reload. Without the re-send, the toolbar said
    // Browse while every click selected regions — the exact confusion the toggle exists
    // to prevent.
    const { result, frame } = mount({ customSiteUrl: CUSTOM_SITE })
    act(() => result.current.setMode('browse'))
    expect(posted(frame, 'set-mode')).toHaveLength(1)

    // The site navigates; the new page announces itself.
    frameSays({ type: 'ready' }, CUSTOM_SITE)
    const modes = posted(frame, 'set-mode')
    expect(modes).toHaveLength(2)
    expect((modes[1][0] as { mode?: string }).mode).toBe('browse')
  })

  it('in edit mode a fresh `ready` sends nothing extra — edit is the frame’s own default', () => {
    const { frame } = mount({ customSiteUrl: CUSTOM_SITE })
    frameSays({ type: 'ready' }, CUSTOM_SITE)
    expect(posted(frame, 'set-mode')).toHaveLength(0)
  })
})
