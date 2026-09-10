// @vitest-environment jsdom
// A page tag declared by a site survives the wire and reaches the panels with its page.
/**
 * N4 — THE PAGE TAG SURVIVES THE WIRE (SITE_PAGES_PLAN.md "New hazards").
 *
 * Both halves were well tested in isolation and nothing crossed the join. The plan named
 * the gap and what it would miss: "a `page: "about"` region declared in a site's registry
 * arriving in lone-star's panels under About… the one that would have caught a tag
 * dropped in `EDIT_LIST`'s style mapper, where the tag rides along conditionally"
 * (`skeen lib/editList.ts`).
 *
 * So this drives the real chain with no stubs in the middle: an announce off the wire →
 * `useFrameBridge`'s per-page fold → `resolvePanelInputs` → `runtimeTextFields` → the
 * props the Text panel renders. A tag dropped anywhere along it fails here.
 *
 * NOTE the shape this pins, after the tabs were rejected (Sam, 2026-09-09): the panel is
 * NOT narrowed to the page in the frame. It holds every page's copy at once, and About's
 * row carries the page so a click can send the frame there. Which is only possible
 * because skeen declares its fields STATICALLY — one announce, from any page, carries them
 * all. A DOM-derived field would appear only after the frame had already been there.
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
  { key: 'merch', label: 'Merch', path: '/merch' },
]

/** An announce shaped like skeen's: every page carries the whole static declaration. */
const announce = (page: string) => ({
  template: 'skeen',
  page,
  pages: PAGES,
  bridgeVersion: '0.35.2',
  fields: [
    { key: 'hero_tagline', label: 'Tagline', type: 'text', target: { store: 'site_content', key: 'hero_tagline' } },
    { key: 'artist_bio', label: 'About', type: 'text', target: { store: 'artist', column: 'bio' }, page: 'about' },
  ],
  // The merch SLOT, tagged (P4): the only thing that says merch items live on /merch.
  slots: [{ key: 'merch', label: 'Merch', accepts: 'merch', page: 'merch' }],
  links: [],
  styles: [
    { key: 'hero', label: 'Hero', base: 'text-4xl' },
    { key: 'about_bio_block', label: 'Bio block', base: 'text-base', page: 'about' },
  ],
})

const draft: PublicSitePayload = {
  artist: { id: 'a1', slug: 'skeen', name: 'Skeen', bio: 'skeen is a band from texas.', hero_image_url: null, template: 'classic', spotify_artist_id: null },
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

const panels = (manifest: unknown) =>
  resolvePanelInputs({
    customSiteUrl: CUSTOM,
    manifest: manifest as never,
    draft,
    siteContent: {},
    local: { textFields: [], imageFields: [] },
    derive: { textFields: runtimeTextFields, imageFields: runtimeImageFields },
  })

describe('a page tag declared by a site reaches the Text panel with its page', () => {
  it('CRITICAL: one announce from HOME carries About’s copy, tagged and headed', () => {
    // The load-bearing claim of the no-tabs design. The frame has never been to /about,
    // and the panel must still list its copy — otherwise there is no row to click and no
    // way to get there.
    const { result } = mount()
    frameSays({ type: 'ready', manifest: announce('home') })

    const text = panels(result.current.manifest).textFields
    const bio = text.find((f) => f.key === 'artist_bio')
    expect(bio, 'About’s copy never reached the panel from Home’s announce').toBeDefined()
    expect(bio?.page).toBe('about')
    expect(bio?.pageLabel).toBe('About')
    expect(bio?.value, 'the artist-column target did not resolve').toBe('skeen is a band from texas.')
  })

  it('CRITICAL: Home’s copy is there too, and carries NO page heading', () => {
    // The panel shows everything — no filtering, no tabs — and the first page stays
    // unheaded so every existing site's panel is unchanged.
    const { result } = mount()
    frameSays({ type: 'ready', manifest: announce('home') })

    const text = panels(result.current.manifest).textFields
    expect(text.map((f) => f.key)).toEqual(['hero_tagline', 'artist_bio'])
    expect(text.find((f) => f.key === 'hero_tagline')?.pageLabel).toBeUndefined()
  })

  it('CRITICAL: visiting About does not drop Home’s copy, and does not duplicate its own', () => {
    // The D4 fold seen from the panel end. The static declaration means both announces
    // carry both fields, so a fold that appended rather than merged would list each twice.
    const { result } = mount()
    frameSays({ type: 'ready', manifest: announce('home') })
    frameSays({ type: 'page-change', page: 'about' })
    frameSays({ type: 'ready', manifest: announce('about') })

    expect(panels(result.current.manifest).textFields.map((f) => f.key)).toEqual([
      'hero_tagline',
      'artist_bio',
    ])
  })

  it('CRITICAL: a site whose fields carry no tags heads nothing', () => {
    // Every site but skeen. Strip the tags and the pages and the panel must look exactly
    // as it did before any of this existed.
    const { result } = mount()
    const base = announce('home')
    const untagged = {
      ...base,
      pages: undefined,
      fields: base.fields.map((f) => {
        const copy = { ...f } as { page?: string }
        delete copy.page
        return copy
      }),
    }
    frameSays({ type: 'ready', manifest: untagged })

    const text = panels(result.current.manifest).textFields
    expect(text).toHaveLength(2)
    for (const f of text) expect(f.pageLabel).toBeUndefined()
  })
})

describe('a slot’s page tag reaches the item panels', () => {
  it('CRITICAL: one announce from HOME says merch items live on /merch', () => {
    // The P4 round trip's first hop, off the wire: the Merch panel has never shown the
    // frame /merch, and it must still know to send it there before highlighting a card.
    const { result } = mount()
    frameSays({ type: 'ready', manifest: announce('home') })
    expect(panels(result.current.manifest).itemPages.merch).toBe('merch')
  })
})
