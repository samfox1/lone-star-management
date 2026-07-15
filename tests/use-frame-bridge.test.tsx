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
import { frameOrigin, frameSrc, useFrameBridge } from '@/app/artists/[id]/(dashboard)/editor/use-frame-bridge'
import { BRIDGE_VERSION, FRAME_SOURCE } from '@/lib/site-editor/bridge'
import type { PublicSitePayload } from '@/lib/site'

const CUSTOM = 'https://skeen-website.vercel.app'

const draft: PublicSitePayload = {
  artist: {
    id: 'a1', slug: 'skeen', name: 'Skeen', bio: null,
    hero_image_url: null, template: 'classic', spotify_artist_id: null,
  },
  tracks: [], tour_dates: [], merch: [], links: [], videos: [],
  media: [{ purpose: 'gallery_image', path: 'a1/gallery/one.jpg' }],
  site_content: {},
  styles: {},
}

/** A stand-in for the iframe's contentWindow — the thing we postMessage into. */
function fakeFrame() {
  const postMessage = vi.fn()
  return { postMessage, el: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement }
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
  it('reports a style-region click so the inspector can focus it', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'select', target: { kind: 'style', key: 'hero_wordmark' }, rect: {} }, CUSTOM)
    expect(result.current.selectedStyle).toBe('hero_wordmark')
  })

  it('ignores non-style selects (no tool for them yet)', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'select', target: { kind: 'field', key: 'hero_tagline' }, rect: {} }, CUSTOM)
    expect(result.current.selectedStyle).toBeNull()
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
