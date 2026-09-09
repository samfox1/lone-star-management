// @vitest-environment jsdom
/**
 * N4 — THE TAG SURVIVES THE WIRE (SITE_PAGES_PLAN.md, "New hazards", P2's first test).
 *
 * Both halves of this were well tested in isolation and NOTHING crossed the join. The
 * plan named the gap and named what it would miss: "a `page: "about"` region declared in
 * a site's registry arriving in lone-star's panels under About… the one that would have
 * caught a tag dropped in `EDIT_LIST`'s style mapper, where the tag rides along
 * conditionally" (`skeen lib/editList.ts:360-365`).
 *
 * So this drives the REAL chain, no stubs in the middle: an announce off the wire →
 * `useFrameBridge`'s per-page fold → a `page-change` → `resolvePanelInputs` → the props
 * the inspector actually renders. A tag dropped anywhere along it fails here.
 *
 * What it deliberately does NOT do is import skeen. That repo's own suite pins its
 * registry (`sitePages.test.tsx`); this pins that lone-star does the right thing with
 * what arrives. The fixture is shaped like skeen's announce — untagged home regions, an
 * About page whose regions carry the tag — because that is the shape the bug hid in.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFrameBridge } from '@/app/artists/[id]/(dashboard)/editor/use-frame-bridge'
import { resolvePanelInputs } from '@/lib/site-editor/panel-inputs'
import { runtimeImageFields, runtimeTextFields } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'
import { BRIDGE_VERSION, FRAME_SOURCE } from '@samfox1/site-bridge/protocol'
import type { PublicSitePayload } from '@/lib/site'

const CUSTOM = 'https://skeen-website.vercel.app'

const PAGES = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'about', label: 'About', path: '/about' },
]

/**
 * An announce shaped like skeen's. Its style registry is announced WHOLE on every page
 * (`styles: STYLE_REGIONS.map(...)` — not DOM-derived, C1), which is exactly why the tag
 * has to carry the page dimension: both announces contain both pages' regions, and only
 * the tag tells them apart.
 */
const announce = (page: string) => ({
  template: 'skeen',
  page,
  pages: PAGES,
  bridgeVersion: '0.35.2',
  fields: [
    { key: 'hero_tagline', label: 'Hero tagline', type: 'text', target: { store: 'site_content', key: 'hero_tagline' } },
    { key: 'about_bio', label: 'Bio', type: 'text', target: { store: 'site_content', key: 'about_bio' }, page: 'about' },
  ],
  slots: [],
  links: [{ key: 'booking', label: 'Booking' }, { key: 'usb', label: 'USB', page: 'about' }],
  // Untagged = home, per the bridge's own rule. Tagged = the page named.
  styles: [
    { key: 'hero', label: 'Hero', base: 'text-4xl' },
    { key: 'footer', label: 'Footer', base: 'text-xs' },
    { key: 'about_bio_block', label: 'Bio block', base: 'text-base', page: 'about' },
    { key: 'about_close', label: 'Close ×', base: 'text-2xl', page: 'about' },
    { key: 'about_usb', label: 'USB', base: 'text-xl', page: 'about' },
  ],
})

const draft: PublicSitePayload = {
  artist: { id: 'a1', slug: 'skeen', name: 'Skeen', bio: null, hero_image_url: null, template: 'classic', spotify_artist_id: null },
  tracks: [], tour_dates: [], merch: [], links: [], videos: [], media: [],
  site_content: {}, styles: {}, fonts: [], font_slots: {},
}

function mount() {
  const el = {
    contentWindow: { postMessage: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLIFrameElement
  const hook = renderHook(() => useFrameBridge({ artistId: 'a1', customSiteUrl: CUSTOM, draft }))
  hook.result.current.frameRef.current = el
  return hook
}

const frameSays = (msg: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { v: BRIDGE_VERSION, source: FRAME_SOURCE, ...msg }, origin: CUSTOM }),
    )
  })

/** The panel props the inspector would render, for whatever page the frame reports. */
const panelsFor = (manifest: unknown, page: string | null) =>
  resolvePanelInputs({
    customSiteUrl: CUSTOM,
    manifest: manifest as never,
    page,
    draft,
    siteContent: {},
    local: { textFields: [], imageFields: [] },
    derive: { textFields: runtimeTextFields, imageFields: runtimeImageFields },
  })

describe('a page tag declared by a site reaches the panels under that page', () => {
  it('CRITICAL: announce → fold → page-change → the About panel holds only About', () => {
    const { result } = mount()
    frameSays({ type: 'ready', manifest: announce('home') })
    frameSays({ type: 'page-change', page: 'about' })

    expect(result.current.framePage, 'the frame’s page never reached the editor').toBe('about')
    const panels = panelsFor(result.current.manifest, result.current.framePage)
    expect(panels.styleRegions.map((r) => r.key)).toEqual(['about_bio_block', 'about_close', 'about_usb'])
    expect(panels.textFields.map((f) => f.key)).toEqual(['about_bio'])
    expect(panels.linkRegions.map((r) => r.key)).toEqual(['usb'])
  })

  it('CRITICAL: and switching back to Home restores Home’s, having lost nothing', () => {
    // The D4 fold's whole purpose, seen from the panel end: narrowing is a VIEW, never a
    // deletion. A filter that mutated the held manifest would empty Home on the way back.
    const { result } = mount()
    frameSays({ type: 'ready', manifest: announce('home') })
    frameSays({ type: 'page-change', page: 'about' })
    panelsFor(result.current.manifest, 'about')
    frameSays({ type: 'page-change', page: 'home' })

    expect(result.current.framePage).toBe('home')
    const panels = panelsFor(result.current.manifest, result.current.framePage)
    expect(panels.styleRegions.map((r) => r.key)).toEqual(['hero', 'footer'])
    expect(panels.textFields.map((f) => f.key)).toEqual(['hero_tagline'])
    expect(panels.linkRegions.map((r) => r.key)).toEqual(['booking'])
  })

  it('CRITICAL: a site whose regions carry NO tags still fills every panel', () => {
    // The regression that matters most, because it is every site but skeen: drop the tags
    // and the pages, and the panels must hold everything on whatever page is reported.
    const { result } = mount()
    /** The same announce with every `page` tag stripped — a site that predates pages. */
    const noTags = <T extends { page?: string }>(items: T[]): Omit<T, 'page'>[] =>
      items.map((item) => {
        const copy = { ...item }
        delete copy.page
        return copy
      })
    const base = announce('home')
    const untagged = {
      ...base,
      pages: undefined,
      styles: noTags(base.styles),
      fields: noTags(base.fields),
      links: noTags(base.links),
    }
    frameSays({ type: 'ready', manifest: untagged })

    expect(result.current.framePage, 'no declared pages means no page to be on').toBeNull()
    const panels = panelsFor(result.current.manifest, result.current.framePage)
    expect(panels.styleRegions).toHaveLength(5)
    expect(panels.textFields).toHaveLength(2)
    expect(panels.linkRegions).toHaveLength(2)
  })

  it('before the frame reports a page, the panels hold everything rather than nothing', () => {
    // The state on every load, for the beat between `ready` and the first `page-change`.
    // Filtering here would flash an empty inspector on a site that works fine.
    const { result } = mount()
    frameSays({ type: 'ready', manifest: announce('home') })

    expect(result.current.framePage).toBeNull()
    expect(panelsFor(result.current.manifest, result.current.framePage).styleRegions).toHaveLength(5)
  })
})
