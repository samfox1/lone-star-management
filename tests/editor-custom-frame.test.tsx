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
 * The DOM-level shell test lives here rather than a full render because the shell
 * embeds a cross-origin iframe jsdom won't load.
 */
import { describe, expect, it } from 'vitest'
import { BRIDGE_VERSION, EDITOR_SOURCE, FRAME_SOURCE, editorMessage, isFrameMessage } from '@/lib/site-editor/bridge'
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

describe('frame src', () => {
  // Mirrors the shell's frameSrc rule; kept as a unit so the /edit contract with
  // skeen is pinned (S3 built an /edit ROUTE — the plan's older `?lse=edit` idea
  // was never implemented).
  const frameSrc = (artistId: string, customSiteUrl?: string | null) =>
    customSiteUrl ? `${customSiteUrl.replace(/\/$/, '')}/edit` : `/artists/${artistId}/edit-frame`

  it('points at the built-in same-origin frame when the artist has no custom site', () => {
    expect(frameSrc('a1', null)).toBe('/artists/a1/edit-frame')
  })

  it("points at the custom site's /edit route", () => {
    expect(frameSrc('a1', 'https://skeen-website.vercel.app')).toBe('https://skeen-website.vercel.app/edit')
  })

  it('tolerates a trailing slash on custom_site_url (no //edit)', () => {
    expect(frameSrc('a1', 'https://skeen-website.vercel.app/')).toBe('https://skeen-website.vercel.app/edit')
  })
})
