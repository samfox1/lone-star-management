/**
 * THE CONTRACT PACKAGE IS THE CONTRACT (SITE_BRIDGE_PLAN.md phase 1).
 *
 * `@samfox1/site-bridge` owns what the editor and every connected site must agree on:
 * the protocol, the wire payload, and the manifest schema. This suite pins two things —
 * that the package really is the single source (the editor's historical import paths
 * are shims onto it, not copies beside it), and the protocol fixtures a site's own
 * suite can mirror. When skeen migrates (phase 2), its tests import these same shapes;
 * a change that breaks this file is a change every deployed site will feel.
 */
import { describe, expect, it } from 'vitest'
import * as pkg from '@samfox1/site-bridge'
import { FONT_SLOTS as fontsShimSlots } from '@/lib/fonts'
import * as markersShim from '@/lib/site-editor/markers'
import * as styleApplyShim from '@/lib/site-editor/style-apply'
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import type { PublicSitePayload as ShimPayload, SiteData, SiteMedia } from '@/lib/site'

describe('single source — the shims re-export the package, never redefine it', () => {
  it('CRITICAL: the surviving shims re-export the package by IDENTITY', () => {
    // Identity, not shape: a hand-copied guard would be equal by behavior today and
    // free to drift tomorrow — the exact disease the package exists to cure. (The
    // protocol shim itself was retired in the 2026-08-07 deepening — its importers
    // reach the package directly now — so this pins the shims that remain because
    // they carry real local content beside the re-exports.)
    expect(markersShim.FIELD_ATTR).toBe(pkg.FIELD_ATTR)
    expect(markersShim.MARKED).toBe(pkg.MARKED)
    expect(styleApplyShim.colorToken).toBe(pkg.colorToken)
    expect(styleApplyShim.resolveRegionStyle).toBe(pkg.resolveRegionStyle)
    expect(styleApplyShim.MANAGED_STYLE_PROPS).toBe(pkg.MANAGED_STYLE_PROPS)
  })

  it('CRITICAL: FONT_SLOTS reached through @/lib/fonts IS the package’s value', () => {
    expect(fontsShimSlots).toBe(pkg.FONT_SLOTS)
  })

  it('SiteData derives from the wire payload — media is the only divergence', () => {
    // Compile-time: if site.ts ever redefines the payload instead of deriving from the
    // package, these assignments stop typechecking. (Runtime body is trivially true —
    // the assertions are the type annotations.)
    const wire = null as unknown as PublicSitePayload
    const shim: ShimPayload = wire // package assignable to shim…
    // …AND the reverse (2026-08-07 review: one direction alone lets the shim silently
    // re-WIDEN — extra optional fields, unknown-typed members — and still compile).
    const back: PublicSitePayload = null as unknown as ShimPayload
    const derived: Omit<SiteData, 'media'> = wire // everything but media flows through
    const media: SiteMedia = { purpose: 'gallery_image', url: 'https://x/y.jpg' }
    expect([shim, back, derived, media].length).toBe(4)
  })
})

describe('the highlight style is the package’s, and paints only the region', () => {
  it('CRITICAL: no page-wide wash — a marked region paints INSIDE its own box', () => {
    // Sam, 2026-08-08, clicking a social icon in skeen's preview: "this weird container
    // opens below". The shells' hand-mirrored rule carried
    // `box-shadow:0 0 0 9999px rgba(37,99,235,.06)` to dim the page. That only ever
    // worked for an element with no clipping ancestor, and `applyHighlightToDom` marks
    // EVERY match: skeen's socials render in the hero AND the footer, so the hero's
    // wash was clipped to nothing by `overflow-hidden` while the footer's painted an
    // edged grey rectangle across the page. Any future marker rendered twice would
    // bring it back, which is why this is pinned and not merely deleted.
    expect(pkg.HIGHLIGHT_CSS).not.toMatch(/box-shadow/)
    // A spread that big is the specific shape of the bug, whatever property carries it.
    expect(pkg.HIGHLIGHT_CSS).not.toMatch(/9999px/)
  })

  it('targets the marker attribute it is built from, and still rings', () => {
    // Built from the constant, so a rename cannot leave a stale selector behind.
    expect(pkg.HIGHLIGHT_CSS).toContain(`[${pkg.HIGHLIGHT_ATTR}]`)
    expect(pkg.HIGHLIGHT_CSS).toMatch(/outline:3px solid/)
  })
})

describe('protocol fixtures — what every connected site can also pin', () => {
  it('stamps and accepts its own messages, both directions', () => {
    const fromFrame = pkg.frameMessage({ type: 'select', target: { kind: 'field', key: 'k' }, rect: { x: 0, y: 0, width: 1, height: 1 } })
    const fromEditor = pkg.editorMessage({ type: 'highlight', target: { kind: 'item', assetType: 'track', id: 't1' } })
    expect(pkg.isFrameMessage(fromFrame)).toBe(true)
    expect(pkg.isEditorMessage(fromEditor)).toBe(true)
    // Direction discrimination: each side ignores its own echoes.
    expect(pkg.isFrameMessage(fromEditor)).toBe(false)
    expect(pkg.isEditorMessage(fromFrame)).toBe(false)
  })

  it('CRITICAL: accepts OLDER versions and refuses NEWER — the un-bumpable-protocol fix', () => {
    // The two sides deploy separately, forever. Exact-match acceptance means whichever
    // bumps first drops EVERY message from the other, hello included (the 2026-08-04
    // lockout). Older-accepted degrades a bump to “one message type ignored”.
    const older = { ...pkg.frameMessage({ type: 'deselect' }), v: pkg.BRIDGE_VERSION - 1 }
    const newer = { ...pkg.frameMessage({ type: 'deselect' }), v: pkg.BRIDGE_VERSION + 1 }
    expect(pkg.isFrameMessage(older)).toBe(true)
    expect(pkg.isFrameMessage(newer)).toBe(false)
  })

  it('selectTargetKey is stable — panels compare against it, sites highlight by it', () => {
    expect(pkg.selectTargetKey({ kind: 'field', key: 'tour_heading' })).toBe('field:tour_heading')
    expect(pkg.selectTargetKey({ kind: 'item', assetType: 'track', id: 's1' })).toBe('item:track:s1')
  })
})
