/**
 * Site-editor RULEBOOK (phase 0) — pure unit tests, no DB. Locks the manifest ↔
 * marker ↔ bridge contract: every declared site-text field is an editable manifest
 * field, the library slots exist, the DOM item marker round-trips, and the bridge
 * message guards accept only well-formed, current-version, correctly-sourced
 * payloads.
 */
import { describe, expect, it } from 'vitest'
import { TEMPLATE_FIELDS } from '@/lib/site-content-schema'
import {
  MANIFESTS,
  fieldByKey,
  manifestFor,
  slotByKey,
  type LibraryAsset,
  type TemplateManifest,
} from '@/lib/site-editor/manifest'
import { itemMarker, parseItemMarker } from '@/lib/site-editor/markers'
import {
  BRIDGE_VERSION,
  editorMessage,
  frameMessage,
  isEditorMessage,
  isFrameMessage,
} from '@/lib/site-editor/bridge'

const ASSET_TYPES: LibraryAsset[] = ['track', 'video', 'image', 'merch', 'tour_date', 'link']

describe('markers — data-lse-item round-trip', () => {
  it('builds and parses an item marker (uuid ids survive the colon split)', () => {
    const id = '3f1e2d4c-5b6a-7890-abcd-ef0123456789'
    const marker = itemMarker('track', id)
    expect(marker).toBe(`track:${id}`)
    expect(parseItemMarker(marker)).toEqual({ assetType: 'track', id })
  })

  it('rejects malformed markers', () => {
    expect(parseItemMarker('nocolon')).toBeNull()
    expect(parseItemMarker('track:')).toBeNull() // empty id
    expect(parseItemMarker(':abc')).toBeNull() // empty type
    expect(parseItemMarker('bogus:abc')).toBeNull() // unknown asset type
  })
})

describe('manifest — coverage & shape', () => {
  it('has manifests for the built-in templates', () => {
    expect(manifestFor('classic')?.template).toBe('classic')
    expect(manifestFor('cinematic')?.template).toBe('cinematic')
    expect(manifestFor('does-not-exist')).toBeUndefined()
  })

  for (const template of ['classic', 'cinematic'] as const) {
    describe(template, () => {
      const manifest = MANIFESTS[template]

      it('exposes every declared site-text field as an editable field with a site_content target', () => {
        for (const f of TEMPLATE_FIELDS[template]) {
          const field = fieldByKey(manifest, f.key)
          expect(field, `${template} missing manifest field ${f.key}`).toBeDefined()
          expect(field!.target).toEqual({ store: 'site_content', key: f.key })
        }
      })

      it('has unique field keys and slot keys', () => {
        const fieldKeys = manifest.fields.map((f) => f.key)
        const slotKeys = manifest.slots.map((s) => s.key)
        expect(new Set(fieldKeys).size).toBe(fieldKeys.length)
        expect(new Set(slotKeys).size).toBe(slotKeys.length)
      })

      it('every field has a resolvable target and every slot accepts a known asset', () => {
        for (const f of manifest.fields) {
          expect(['site_content', 'artist', 'media']).toContain(f.target.store)
        }
        for (const s of manifest.slots) {
          expect(ASSET_TYPES, `${template} slot ${s.key}`).toContain(s.accepts)
          expect(slotByKey(manifest, s.key)).toBe(s)
        }
      })
    })
  }

  it('classic covers the core library sections', () => {
    const slotKeys = MANIFESTS.classic.slots.map((s) => s.key)
    expect(slotKeys).toEqual(expect.arrayContaining(['tracks', 'videos', 'tour_dates', 'merch', 'links']))
  })

  it('carries the profile fields (name / bio / hero image) on every template', () => {
    for (const m of Object.values(MANIFESTS) as TemplateManifest[]) {
      expect(fieldByKey(m, 'artist_name')?.target).toEqual({ store: 'artist', column: 'name' })
      expect(fieldByKey(m, 'hero_image')?.type).toBe('image')
    }
  })
})

describe('bridge — versioned, source-discriminated guards', () => {
  it('stamps and recognises a frame message', () => {
    const msg = frameMessage({ type: 'select', target: { kind: 'field', key: 'hero_tagline' }, rect: { x: 0, y: 0, width: 10, height: 5 } })
    expect(msg.v).toBe(BRIDGE_VERSION)
    expect(isFrameMessage(msg)).toBe(true)
    expect(isEditorMessage(msg)).toBe(false) // wrong source
  })

  it('stamps and recognises an editor message', () => {
    const msg = editorMessage({ type: 'set-device', device: 'mobile' })
    expect(isEditorMessage(msg)).toBe(true)
    expect(isFrameMessage(msg)).toBe(false)
  })

  it('rejects wrong version, wrong source, and non-objects', () => {
    expect(isFrameMessage({ v: 999, source: 'lse-frame', type: 'ready' })).toBe(false)
    expect(isFrameMessage({ v: BRIDGE_VERSION, source: 'evil', type: 'ready' })).toBe(false)
    expect(isFrameMessage(null)).toBe(false)
    expect(isFrameMessage('lse-frame')).toBe(false)
  })
})
