// @vitest-environment jsdom
// The editor's conversation with the site frame, where every failure mode is silent.
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
import type { DroppedRegion, ManifestPage, TemplateManifest } from '@samfox1/site-bridge/manifest'

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
function mount(
  opts: {
    customSiteUrl?: string | null
    draft?: PublicSitePayload | null
    onFieldChange?: (key: string, value: string) => void
  } = {},
) {
  const frame = fakeFrame()
  const hook = renderHook(() =>
    useFrameBridge({
      artistId: 'a1',
      customSiteUrl: opts.customSiteUrl ?? null,
      draft: opts.draft ?? null,
      onFieldChange: opts.onFieldChange,
    }),
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


/* ── field-change: the one write that flows SITE → EDITOR (0.27.0) ──────────────────
 * ftbk's manager arranges the desktop by dragging icons; no panel control can express
 * that, so the site saves it. The manifest is the whole authorization. */
describe('a site saving a field it changed on the page', () => {
  /** Announce a manifest declaring one site-written field, then post a change. */
  function connectedWith(fields: { key: string; siteWritten?: boolean }[]) {
    const onFieldChange = vi.fn()
    const h = mount({ customSiteUrl: CUSTOM, onFieldChange })
    frameSays(
      {
        type: 'ready',
        manifest: {
          template: 'ftbk',
          fields: fields.map((f) => ({ ...f, label: f.key, type: 'text', target: { store: 'site_content', key: f.key } })),
          slots: [],
          styles: [],
          links: [],
        },
      },
      CUSTOM,
    )
    return { onFieldChange }
  }

  it('CRITICAL: a DECLARED field reaches the save path', () => {
    const { onFieldChange } = connectedWith([{ key: 'desktop_layout', siteWritten: true }])
    frameSays({ type: 'field-change', key: 'desktop_layout', value: '{"a":1}' }, CUSTOM)
    expect(onFieldChange).toHaveBeenCalledWith('desktop_layout', '{"a":1}')
  })

  it("CRITICAL: an UNDECLARED key is refused — a frame is a separate origin and may claim anything", () => {
    // Without this check the site could write any site_content key it named. The
    // declaration is the only thing that makes a key legitimate.
    const { onFieldChange } = connectedWith([{ key: 'desktop_layout', siteWritten: true }])
    frameSays({ type: 'field-change', key: 'artist_bio', value: 'hijacked' }, CUSTOM)
    expect(onFieldChange).not.toHaveBeenCalled()
  })

  it('CRITICAL: a field-change from the WRONG ORIGIN is dropped like every other message', () => {
    const { onFieldChange } = connectedWith([{ key: 'desktop_layout', siteWritten: true }])
    frameSays({ type: 'field-change', key: 'desktop_layout', value: 'evil' }, 'https://attacker.example')
    expect(onFieldChange).not.toHaveBeenCalled()
  })

  it('a change arriving BEFORE any manifest is refused (nothing is declared yet)', () => {
    const onFieldChange = vi.fn()
    mount({ customSiteUrl: CUSTOM, onFieldChange })
    frameSays({ type: 'field-change', key: 'desktop_layout', value: 'x' }, CUSTOM)
    expect(onFieldChange).not.toHaveBeenCalled()
  })
})

describe('multi-page: the fold holds ONE manifest per page (SITE_PAGES_PLAN.md D4)', () => {
  const PAGES = [
    { key: 'home', label: 'Home', path: '/' },
    { key: 'merch', label: 'Merch', path: '/merch' },
  ]
  /** An announce as the frame sends it: `page` names which page it describes, and the
   *  regions carry the same tag. */
  const announce = (page: string, styleKeys: string[]) => ({
    template: 'skeen',
    page,
    pages: PAGES,
    fields: [],
    slots: [],
    links: [],
    styles: styleKeys.map((key) => ({ key, label: key, page })),
  })

  it('keeps an earlier page’s regions when another page announces', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['hero']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['merch_grid']) }, CUSTOM)

    expect(result.current.manifest?.styles.map((s) => s.key)).toEqual(['hero', 'merch_grid'])
  })

  it('REMOVES a region the page stops declaring, instead of keeping it forever', () => {
    // Finding 14 from the 2026-09-03 review. A flat fold that only ever ADDS leaves a
    // region in the panels after the site is redeployed without it — still selectable,
    // still writing `site_content` rows for something nothing renders. The old
    // replace-on-`ready` semantics dropped it, so the fold must not be a regression.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['hero', 'retired_band']) }, CUSTOM)
    expect(result.current.manifest?.styles).toHaveLength(2)

    // The site redeploys without `retired_band` and re-announces the SAME page.
    frameSays({ type: 'ready', manifest: announce('home', ['hero']) }, CUSTOM)

    expect(result.current.manifest?.styles.map((s) => s.key)).toEqual(['hero'])
  })

  it('a re-announce of one page does not disturb another page’s regions', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['hero']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['merch_grid']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('home', ['hero', 'contact']) }, CUSTOM)

    expect(result.current.manifest?.styles.map((s) => s.key)).toEqual([
      'hero',
      'contact',
      'merch_grid',
    ])
  })

  it('duplicate resolution does not depend on VISIT order', () => {
    // First-DECLARED wins, so the same site yields the same panel whichever page the
    // manager happened to open first. Folding the held announces in arrival order would
    // have made the winner whatever they clicked.
    const homeFirst = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['shared']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['shared']) }, CUSTOM)
    const a = homeFirst.result.current.manifest?.styles[0]?.page
    homeFirst.unmount()

    const merchFirst = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('merch', ['shared']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('home', ['shared']) }, CUSTOM)
    const b = merchFirst.result.current.manifest?.styles[0]?.page

    expect(a).toBe('home')
    expect(b).toBe('home')
  })

  it('reports the dropped duplicate WITHOUT accumulating it on every re-announce', () => {
    // The frame re-announces per page constantly (after paint, on every `hello`). A
    // dropped list that appended each time would grow without bound.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['shared']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['shared']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['shared']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['shared']) }, CUSTOM)

    expect(result.current.droppedRegions).toHaveLength(1)
    expect(result.current.droppedRegions[0]).toMatchObject({ key: 'shared', page: 'merch' })
  })

  it('SINGLE-PAGE REGRESSION: an announce with no `page` still replaces cleanly', () => {
    // Every site deployed today announces no `page` and no `pages`. Two announces must
    // behave exactly as replace-on-`ready` always did.
    const { result } = mount({ customSiteUrl: CUSTOM })
    const one = { template: 'skeen', fields: [], slots: [], links: [], styles: [{ key: 'a', label: 'a' }, { key: 'gone', label: 'gone' }] }
    const two = { template: 'skeen', fields: [], slots: [], links: [], styles: [{ key: 'a', label: 'a' }] }
    frameSays({ type: 'ready', manifest: one }, CUSTOM)
    frameSays({ type: 'ready', manifest: two }, CUSTOM)

    expect(result.current.manifest?.styles.map((s) => s.key)).toEqual(['a'])
  })
})

/* ── a page the site STOPS declaring must LEAVE (2026-09-04 review) ────────────────────
 * skeen's `/about` exists only while the manager places the bio there (CONNECTING.md
 * §11). The fold held one announce per page and never let one go, so a page the site
 * stopped declaring kept its regions in the panels for the whole session — and the
 * switcher (P2) would have offered a page the frame could not show, with `set-page`
 * silently dead. The site's LATEST announce owns the page list; everything below pins
 * what that means. */
describe('multi-page: a page the latest announce no longer declares is evicted', () => {
  const pageOf = (key: string): ManifestPage => ({ key, label: key, path: key === 'home' ? '/' : `/${key}` })

  /** One region of EVERY kind the fold knows, all tagged `page`. Typed against
   *  `DroppedRegion['kind']` — the fold's own registry of lists — so a kind added there is
   *  a compile error here, not a witness quietly missing from the eviction check. */
  const everyKind = (page: string): Record<DroppedRegion['kind'], object[]> => ({
    fields: [{ key: `${page}_field`, label: 'f', type: 'text', target: { store: 'site_content', key: `${page}_field` }, page }],
    slots: [{ key: `${page}_slot`, label: 's', accepts: 'image', page }],
    styles: [{ key: `${page}_style`, label: 'st', page }],
    links: [{ key: `${page}_link`, label: 'l', page }],
    components: [{ key: `${page}_component`, label: 'c', count: 1, slots: [{ key: 'photo', label: 'Photo' }], page }],
    videoSlots: [{ kind: 'hero', role: `${page}_hero`, label: 'v', group: 'g', page }],
  })
  const KINDS = Object.keys(everyKind('x')) as DroppedRegion['kind'][]

  /** An announce as the frame sends it. `pages` undefined = the announce declares none. */
  const announce = (page: string, pages: string[] | undefined) => ({
    template: 'skeen',
    page,
    ...(pages ? { pages: pages.map(pageOf) } : {}),
    ...everyKind(page),
  })

  /** How many regions of each kind the held manifest carries for `page`. */
  const tagged = (m: TemplateManifest | null, page: string) =>
    Object.fromEntries(
      KINDS.map((k) => [k, ((m?.[k] ?? []) as { page?: string }[]).filter((r) => r.page === page).length]),
    )
  const ONE_EACH = Object.fromEntries(KINDS.map((k) => [k, 1]))
  const NONE = Object.fromEntries(KINDS.map((k) => [k, 0]))

  it('CRITICAL: evicts EVERY region of the undeclared page — after proving they were there', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    // About is announced FIRST on purpose: the old fold took `pages` from whichever held
    // announce came first in Map order, so a stale list from here would have shielded
    // About from eviction. Latest must win regardless of arrival order.
    frameSays({ type: 'ready', manifest: announce('about', ['home', 'about', 'merch']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('home', ['home', 'about', 'merch']) }, CUSTOM)
    // The witness: every kind of About region is in the panels.
    expect(tagged(result.current.manifest, 'about')).toEqual(ONE_EACH)

    // The manager hides the bio; the site re-announces the page it is showing, without About.
    frameSays({ type: 'ready', manifest: announce('home', ['home', 'merch']) }, CUSTOM)

    expect(tagged(result.current.manifest, 'about')).toEqual(NONE)
    expect(tagged(result.current.manifest, 'home')).toEqual(ONE_EACH)
    expect(result.current.manifest?.pages?.map((p) => p.key)).toEqual(['home', 'merch'])
  })

  it('the LATEST list is the manifest’s list, even when a held page still carries a stale one', () => {
    // Held announces are snapshots. Merch was visited while About existed, so its copy of
    // `pages` still names About; folding in declared order would make Merch's stale list
    // the last word and the switcher would offer a page the frame just said is gone.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['home', 'about', 'merch']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['home', 'about', 'merch']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('home', ['home', 'merch']) }, CUSTOM)

    expect(result.current.manifest?.pages?.map((p) => p.key)).toEqual(['home', 'merch'])
    // Merch itself is still declared, so its regions stay.
    expect(tagged(result.current.manifest, 'merch')).toEqual(ONE_EACH)
  })

  it('CRITICAL: framePage is dropped when the page it names is evicted', () => {
    // The bug one layer up: a switcher latched to a page the frame cannot show. framePage
    // is only ever admitted by checking `page-change` against the declaration, so losing
    // the declaration must un-admit it the same way.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['home', 'about']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('about', ['home', 'about']) }, CUSTOM)
    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)
    expect(result.current.framePage).toBe('about') // the witness

    frameSays({ type: 'ready', manifest: announce('home', ['home']) }, CUSTOM)
    expect(result.current.framePage).toBeNull()

    // And the frame cannot re-assert it: an undeclared page-change is a stranger.
    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)
    expect(result.current.framePage).toBeNull()
  })

  it('framePage SURVIVES a re-announce that still declares its page', () => {
    // The frame re-announces constantly (after paint, on every `hello`). A reset on every
    // announce would blank the switcher between every two messages.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['home', 'merch']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['home', 'merch']) }, CUSTOM)
    frameSays({ type: 'page-change', page: 'merch' }, CUSTOM)
    expect(result.current.framePage).toBe('merch')

    frameSays({ type: 'ready', manifest: announce('home', ['home', 'merch']) }, CUSTOM)
    expect(result.current.framePage).toBe('merch')
  })

  it('an announce that declares NO pages evicts nothing', () => {
    // No list means a one-page site, not a list that shrank to one. Held pages stay, and
    // — the latest announce owning the list — there is no list until the next one.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['home', 'merch']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('merch', ['home', 'merch']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('home', undefined) }, CUSTOM)

    expect(tagged(result.current.manifest, 'merch')).toEqual(ONE_EACH)
    expect(tagged(result.current.manifest, 'home')).toEqual(ONE_EACH)
    expect(result.current.manifest?.pages).toBeUndefined()
  })

  it('the latest announce is never evicted, even when its own list omits its page', () => {
    // A site whose tags and list disagree is a site bug; the fold's rule is misplaced,
    // never invisible (see the pure `mergeManifests` tests). Eviction must honour it.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: announce('home', ['home']) }, CUSTOM)
    frameSays({ type: 'ready', manifest: announce('nowhere', ['home']) }, CUSTOM)

    expect(tagged(result.current.manifest, 'nowhere')).toEqual(ONE_EACH)
    expect(tagged(result.current.manifest, 'home')).toEqual(ONE_EACH)
  })
})

/* ── a page change drops the selection it left behind (P2) ──────────────────────────
 * The same rule mode-switching already follows, and for the same reason stated there:
 * "a panel still showing a selected region while clicks work the site reads as a control
 * that has stopped responding."
 *
 * A page switch is the sharper case. The selected region is not merely un-clickable, it
 * is GONE — the frame rendered a different page and the element does not exist. The
 * panel would sit open on a Home heading while the frame shows About, its Size slider
 * writing overrides for something off screen, and the only way out would be to click
 * dead space on a page that has no such region to deselect from.
 */
describe('a page change clears what was selected on the page left behind', () => {
  const PAGES = [
    { key: 'home', label: 'Home', path: '/' },
    { key: 'about', label: 'About', path: '/about' },
  ]
  const manifest = {
    template: 'skeen',
    page: 'home',
    pages: PAGES,
    fields: [], slots: [], links: [{ key: 'usb', label: 'USB' }],
    styles: [{ key: 'hero', label: 'Hero' }],
  }

  it('CRITICAL: a style selection made on Home does not survive the move to About', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest }, CUSTOM)
    // The frame reports where it is BEFORE the manager touches anything — that is what a
    // real load does, and it is what makes the next report a MOVE rather than the editor
    // learning the page for the first time (see the null case below).
    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)
    frameSays({ type: 'select', target: { kind: 'style', key: 'hero' } }, CUSTOM)
    expect(result.current.selectedStyle?.key, 'the selection never arrived').toBe('hero')

    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)
    expect(result.current.selectedStyle).toBeNull()
  })

  it('CRITICAL: the link and region selections go too', () => {
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest }, CUSTOM)
    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)
    frameSays({ type: 'select', target: { kind: 'link', key: 'usb' } }, CUSTOM)
    frameSays({ type: 'select', target: { kind: 'field', key: 'hero_tagline' } }, CUSTOM)
    expect(result.current.selectedLink?.key).toBe('usb')
    expect(result.current.selectedRegion).not.toBeNull()

    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)
    expect(result.current.selectedLink).toBeNull()
    expect(result.current.selectedRegion).toBeNull()
  })

  it('an UNDECLARED page is ignored, and clears nothing', () => {
    // The page-change guard runs first. A frame naming a page the site never declared is
    // not a navigation, so nothing about the editor's state should move — including the
    // selection, which still points at a region that is still on screen.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest }, CUSTOM)
    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)
    frameSays({ type: 'select', target: { kind: 'style', key: 'hero' } }, CUSTOM)

    frameSays({ type: 'page-change', page: 'merch' }, CUSTOM)
    expect(result.current.framePage, 'an undeclared page must not become the current one').toBe('home')
    expect(result.current.selectedStyle?.key).toBe('hero')
  })

  it('CRITICAL: learning the page for the FIRST time is not a move, and clears nothing', () => {
    // `framePage` is null until the frame speaks. A selection made in that window was
    // made on the page the frame is ABOUT to name — it is not stale, and clearing it
    // would drop a region the manager just clicked.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest }, CUSTOM)
    frameSays({ type: 'select', target: { kind: 'style', key: 'hero' } }, CUSTOM)
    expect(result.current.framePage).toBeNull()

    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)
    expect(result.current.selectedStyle?.key).toBe('hero')
  })

  it('re-reporting the SAME page does not clear a selection', () => {
    // The frame re-announces constantly (after paint, on every `hello`), and a
    // `page-change` for the page already showing is one of those. Dropping the selection
    // there would make a region deselect itself a beat after a manager clicked it.
    const { result } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest }, CUSTOM)
    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)
    frameSays({ type: 'select', target: { kind: 'style', key: 'hero' } }, CUSTOM)

    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)
    expect(result.current.selectedStyle?.key).toBe('hero')
  })
})

/* ── highlighting something that lives on another page ──────────────────────────────
 * Sam, 2026-09-09: there are no page tabs. The Text panel lists every page's copy, and
 * clicking an entry is what moves the frame — "clicking it should highlight the about
 * text on the about page".
 *
 * So a highlight can name a page. When that page is not the one showing, the frame has to
 * get there FIRST: highlighting immediately would aim at an element that does not exist
 * yet, and the frame would answer with nothing while the panel row looked selected. The
 * request is therefore held until the frame reports it arrived.
 */
describe('a highlight can name a page, and waits for the frame to get there', () => {
  const PAGES = [
    { key: 'home', label: 'Home', path: '/' },
    { key: 'about', label: 'About', path: '/about' },
  ]
  const manifest = {
    template: 'skeen', page: 'home', pages: PAGES,
    fields: [{ key: 'artist_bio', label: 'About', type: 'text', target: { store: 'artist', column: 'bio' }, page: 'about' }],
    slots: [], links: [], styles: [],
  }
  const target = { kind: 'field' as const, key: 'artist_bio' }

  const onAbout = () => {
    const h = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest }, CUSTOM)
    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)
    return h
  }

  it('CRITICAL: a highlight for ANOTHER page asks the frame to move, and does not fire yet', () => {
    const { result, frame } = onAbout()
    act(() => result.current.applyHighlight(target, 'about'))

    expect(posted(frame, 'set-page'), 'the frame was never asked to move').toHaveLength(1)
    expect(posted(frame, 'set-page')[0][0]).toMatchObject({ page: 'about' })
    expect(posted(frame, 'highlight'), 'highlighted an element that is not rendered yet').toHaveLength(0)
  })

  it('CRITICAL: it fires once the frame reports it arrived', () => {
    const { result, frame } = onAbout()
    act(() => result.current.applyHighlight(target, 'about'))
    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)

    expect(posted(frame, 'highlight')).toHaveLength(1)
    expect(posted(frame, 'highlight')[0][0]).toMatchObject({ target })
  })

  it('CRITICAL: it fires only ONCE — the frame re-reports its page constantly', () => {
    // `page-change` arrives again after paint and on every `hello`. A held request that
    // re-fired on each would re-highlight a region the manager had since deselected.
    const { result, frame } = onAbout()
    act(() => result.current.applyHighlight(target, 'about'))
    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)
    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)

    expect(posted(frame, 'highlight')).toHaveLength(1)
  })

  it('CRITICAL: a highlight for the page ALREADY showing fires straight away', () => {
    const { result, frame } = onAbout()
    act(() => result.current.applyHighlight(target, 'home'))

    expect(posted(frame, 'set-page'), 'asked the frame to move to where it already is').toHaveLength(0)
    expect(posted(frame, 'highlight')).toHaveLength(1)
  })

  it('CRITICAL: no page named means fire now — every caller that predates pages', () => {
    const { result, frame } = onAbout()
    act(() => result.current.applyHighlight(target))

    expect(posted(frame, 'set-page')).toHaveLength(0)
    expect(posted(frame, 'highlight')).toHaveLength(1)
  })

  it('a held request is dropped if the frame lands somewhere else', () => {
    // The manager clicked About and then navigated the site themselves. Firing on the
    // wrong page would highlight whatever happens to share that key, or nothing at all.
    const { result, frame } = onAbout()
    act(() => result.current.applyHighlight(target, 'about'))
    frameSays({ type: 'page-change', page: 'home' }, CUSTOM)

    expect(posted(frame, 'highlight')).toHaveLength(0)
    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)
    expect(posted(frame, 'highlight'), 'a dropped request must stay dropped').toHaveLength(0)
  })

  it('on a site with no pages, a named page is ignored rather than stalling', () => {
    // `framePage` is null forever on every site that declares none. Holding the request
    // for a `page-change` that will never come would make the panel row do nothing.
    const h = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: { template: 'skeen', fields: [], slots: [], links: [], styles: [] } }, CUSTOM)
    act(() => h.result.current.applyHighlight(target, 'about'))

    expect(posted(h.frame, 'highlight')).toHaveLength(1)
    expect(posted(h.frame, 'set-page')).toHaveLength(0)
  })
})

/* ── the ref that `applyHighlight` reads must not outlive an eviction ──────────────── */
describe('an evicted page clears the ref applyHighlight decides from', () => {
  const pageOf = (key: string) => ({ key, label: key, path: key === 'home' ? '/' : `/${key}` })
  const target = { kind: 'field' as const, key: 'artist_bio' }
  const manifest = (pages: string[]) => ({
    template: 'skeen', page: 'home', pages: pages.map(pageOf),
    fields: [], slots: [], links: [], styles: [],
  })

  it('CRITICAL: after the frame’s page leaves the declaration, a highlight fires now', () => {
    // `framePage` goes null on eviction. If the REF kept the dead page, applyHighlight
    // would compare against it, decide the target is elsewhere, and hold a request for a
    // `page-change` that is never coming — the row would silently do nothing.
    const { result, frame } = mount({ customSiteUrl: CUSTOM })
    frameSays({ type: 'ready', manifest: manifest(['home', 'about']) }, CUSTOM)
    frameSays({ type: 'page-change', page: 'about' }, CUSTOM)
    expect(result.current.framePage).toBe('about')

    // The bio moves off its own page; the site re-announces without /about.
    frameSays({ type: 'ready', manifest: manifest(['home']) }, CUSTOM)
    expect(result.current.framePage).toBeNull()

    // Named a DIFFERENT page from the evicted one, deliberately: naming 'about' would
    // match the stale ref and fire by accident, proving nothing. `framePage` is null now,
    // which means the editor does not know where the frame is — and "don't know" fires
    // immediately rather than holding for a `page-change` nobody promised.
    act(() => result.current.applyHighlight(target, 'home'))
    expect(posted(frame, 'highlight'), 'the request stalled on a stale page ref').toHaveLength(1)
    expect(posted(frame, 'set-page')).toHaveLength(0)
  })
})
