// @vitest-environment jsdom
/**
 * S4 Slice 2 — embedding a CUSTOM site in the editor (SITE_STYLING_PLAN.md §5).
 *
 * Two things this pins, both of which fail silently rather than loudly:
 *
 * 1. The init-data WIRE SHAPE. A custom site (skeen) resolves media against its
 *    OWN Supabase URL, so it needs the raw `path`. `SiteData` has already replaced
 *    `path` with a lone-star-built `url`, so posting SiteData would hand the frame
 *    `path: undefined` — mapSite would blank every hero clip and gallery image with
 *    no error. getWorkingSitePayload must emit `{purpose, path}`.
 * 2. ORIGIN discipline. postMessage must target the frame's origin (never '*'), and
 *    inbound frame messages must be checked against it. A wrong target origin makes
 *    the browser drop the message silently — the frame just never populates.
 *
 * Scope: the init-data PAYLOAD (what we put on the wire). The shell's side of the
 * conversation — frameSrc, origin discipline, the ready→init-data handshake — is
 * covered against the REAL implementation in tests/use-frame-bridge.test.tsx.
 * A `frame src` block here once re-implemented the shell's rule and asserted
 * against its own copy, so it passed regardless of what the shell did; it's gone.
 */
import { describe, expect, it } from 'vitest'
import { BRIDGE_VERSION, EDITOR_SOURCE, FRAME_SOURCE, editorMessage, isFrameMessage } from '@lone-star/site-bridge/protocol'
import type { PublicSitePayload } from '@/lib/site'

/** A frame `ready` announcement, as skeen's mountFrameBridge posts it. */
const readyMsg = { v: BRIDGE_VERSION, source: FRAME_SOURCE, type: 'ready', manifest: { styles: [] } }

const draft: PublicSitePayload = {
  artist: {
    id: 'a1', slug: 'skeen', name: 'Skeen', bio: null,
    hero_image_url: null, template: 'classic', spotify_artist_id: null,
  },
  tracks: [], tour_dates: [], merch: [], links: [], videos: [],
  media: [{ purpose: 'gallery_image', path: 'a1/gallery/one.jpg' }],
  site_content: {},
  styles: { hero_wordmark: 'text-9xl' },
  fonts: [],
  font_slots: {},
}

describe('init-data payload — the wire shape a custom site consumes', () => {
  it('carries media as a raw PATH, never a resolved url', () => {
    const msg = editorMessage({ type: 'init-data', site: draft })
    const media = (msg as { site: PublicSitePayload }).site.media[0] as Record<string, unknown>
    // skeen does mediaPublicUrl(itsOwnSupabaseUrl, m.path) — a `url` here means it
    // would read m.path === undefined and render nothing.
    expect(media.path).toBe('a1/gallery/one.jpg')
    expect(media).not.toHaveProperty('url')
  })

  it('is stamped with the editor source + current bridge version', () => {
    const msg = editorMessage({ type: 'init-data', site: draft })
    expect(msg.source).toBe(EDITOR_SOURCE)
    expect(msg.v).toBe(BRIDGE_VERSION)
  })

  it('carries styles through, so a custom site renders draft class overrides', () => {
    const msg = editorMessage({ type: 'init-data', site: draft })
    expect((msg as { site: PublicSitePayload }).site.styles).toEqual({ hero_wordmark: 'text-9xl' })
  })
})

describe('frame ready → editor responds with init-data', () => {
  it('accepts a ready message from the frame', () => {
    // The trigger is `ready`, not the iframe load event: load can fire before the
    // frame's bridge mounts its listener, and the injected draft would be dropped.
    expect(isFrameMessage(readyMsg)).toBe(true)
    expect((readyMsg as { type: string }).type).toBe('ready')
  })

  it('ignores a ready message at the wrong bridge version', () => {
    expect(isFrameMessage({ ...readyMsg, v: BRIDGE_VERSION + 1 })).toBe(false)
  })

  it("ignores the editor's own echoed messages", () => {
    // Both documents share a window message bus; without the source discriminator
    // the editor would answer its own init-data.
    expect(isFrameMessage(editorMessage({ type: 'init-data', site: draft }))).toBe(false)
  })
})
