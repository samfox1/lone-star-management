/**
 * THE CONTRACT PACKAGE IS THE CONTRACT (SITE_BRIDGE_PLAN.md phase 1).
 *
 * `@lone-star/site-bridge` owns what the editor and every connected site must agree on:
 * the protocol, the wire payload, and the manifest schema. This suite pins two things —
 * that the package really is the single source (the editor's historical import paths
 * are shims onto it, not copies beside it), and the protocol fixtures a site's own
 * suite can mirror. When skeen migrates (phase 2), its tests import these same shapes;
 * a change that breaks this file is a change every deployed site will feel.
 */
import { describe, expect, it } from 'vitest'
import * as pkg from '@lone-star/site-bridge'
import * as protocolShim from '@/lib/site-editor/bridge'
import { FONT_SLOTS as fontsShimSlots } from '@/lib/fonts'
import type { PublicSitePayload } from '@lone-star/site-bridge/payload'
import type { PublicSitePayload as ShimPayload, SiteData, SiteMedia } from '@/lib/site'

describe('single source — the shims re-export the package, never redefine it', () => {
  it('CRITICAL: the protocol reached through @/lib/site-editor/bridge IS the package’s', () => {
    // Identity, not shape: a hand-copied guard would be equal by behavior today and
    // free to drift tomorrow — the exact disease the package exists to cure.
    expect(protocolShim.isFrameMessage).toBe(pkg.isFrameMessage)
    expect(protocolShim.isEditorMessage).toBe(pkg.isEditorMessage)
    expect(protocolShim.frameMessage).toBe(pkg.frameMessage)
    expect(protocolShim.editorMessage).toBe(pkg.editorMessage)
    expect(protocolShim.selectTargetKey).toBe(pkg.selectTargetKey)
    expect(protocolShim.BRIDGE_VERSION).toBe(pkg.BRIDGE_VERSION)
  })

  it('CRITICAL: FONT_SLOTS reached through @/lib/fonts IS the package’s value', () => {
    expect(fontsShimSlots).toBe(pkg.FONT_SLOTS)
  })

  it('SiteData derives from the wire payload — media is the only divergence', () => {
    // Compile-time: if site.ts ever redefines the payload instead of deriving from the
    // package, these assignments stop typechecking. (Runtime body is trivially true —
    // the assertions are the type annotations.)
    const wire = null as unknown as PublicSitePayload
    const shim: ShimPayload = wire // identical types or this line errors
    const derived: Omit<SiteData, 'media'> = wire // everything but media flows through
    const media: SiteMedia = { purpose: 'gallery_image', url: 'https://x/y.jpg' }
    expect([shim, derived, media].length).toBe(3)
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
