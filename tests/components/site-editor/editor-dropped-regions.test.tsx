// @vitest-environment jsdom
// When two pages claim the same region key, the DEVELOPER is told (a console warning); the
//   manager is not.
/**
 * N3, REVISED (Sam, 2026-09-28): A DROPPED REGION IS A DEVELOPER'S PROBLEM.
 *
 * Region keys are one flat namespace across every page (D3), so two pages naming the same
 * region share one saved style, and the D4 merge keeps the first. N3 surfaced that as a
 * banner in the inspector: "“heading” is declared twice (home and merch)… renaming one in
 * the site's code separates them." That is site-code bookkeeping in front of a manager who
 * can do nothing about it, so it moved to the console, where the person who can rename a
 * key will see it. The site's own contract check (`duplicate-key`) is the real gate.
 *
 * Light on purpose (AGENTS.md "Test depth"): the log names the collision once, and the
 * editor shows the manager nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { droppedRegionsWarning, useFrameBridge } from '@/app/artists/[id]/(dashboard)/editor/use-frame-bridge'
import { EditorShell } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'
import { BRIDGE_VERSION, FRAME_SOURCE } from '@samfox1/site-bridge/protocol'
import type { DroppedRegion } from '@samfox1/site-bridge/manifest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => import('@tests/helpers/connections-actions'))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => import('@tests/helpers/editor-actions'))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({ MediaUploader: () => null, GallerySlotUploader: () => null }))
// The shell measures its frame panel with a ResizeObserver; jsdom has none.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const CUSTOM = 'https://skeen-website.vercel.app'
const PAGES = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'merch', label: 'Merch', path: '/merch' },
]
const announce = (page: string, styleKeys: string[]) => ({
  template: 'skeen', page, pages: PAGES, fields: [], slots: [], links: [],
  styles: styleKeys.map((key) => ({ key, label: key, page })),
})

function frameSays(msg: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { v: BRIDGE_VERSION, source: FRAME_SOURCE, ...msg }, origin: CUSTOM }))
  })
}

function mountBridge() {
  const hook = renderHook(() => useFrameBridge({ artistId: 'a1', customSiteUrl: CUSTOM, draft: null }))
  hook.result.current.frameRef.current = {
    contentWindow: { postMessage: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLIFrameElement
  return hook
}

describe('a region key declared on two pages is logged for developers', () => {
  it('names the key and both pages, once, however often the frame re-announces', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mountBridge()
    frameSays({ type: 'ready', manifest: announce('home', ['heading']) })
    frameSays({ type: 'ready', manifest: announce('merch', ['heading']) })
    frameSays({ type: 'ready', manifest: announce('merch', ['heading']) }) // re-announce
    frameSays({ type: 'ready', manifest: announce('merch', ['heading']) })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('"heading" (home and merch)')
  })

  it('a site with no collision logs nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mountBridge()
    frameSays({ type: 'ready', manifest: announce('home', ['hero']) })
    frameSays({ type: 'ready', manifest: announce('merch', ['merch_grid']) })
    expect(warn).not.toHaveBeenCalled()
  })

  it('a duplicate INSIDE one page names that page once, not "merch and merch"', () => {
    const d: DroppedRegion = { kind: 'styles', key: 'heading', page: 'merch', keptPage: 'merch' }
    const text = droppedRegionsWarning([d])
    expect(text).toContain('"heading" (merch)')
    expect(text.match(/merch/g)).toHaveLength(1)
  })
})

describe('the manager sees none of it', () => {
  it('the editor shows no "declared twice" notice for a site that has one', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <EditorShell
        artistId="a1" customSiteUrl={CUSTOM} draft={null} photos={[]} imageFields={[]} textFields={[]}
        siteContent={{}} links={[]} supportLinks={[]} linkValues={{}} videos={[]} merch={[]} releases={[]} tours={[]}
      />,
    )
    frameSays({ type: 'ready', manifest: announce('home', ['heading']) })
    frameSays({ type: 'ready', manifest: announce('merch', ['heading']) })
    expect(console.warn).toHaveBeenCalled() // the premise: the collision really happened
    expect(screen.queryByText(/declared twice/i)).toBeNull()
  })
})
