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
  fieldCurrentValue,
  manifestFor,
  type LibraryAsset,
  type TemplateManifest,
} from '@/lib/site-editor/manifest'
import { fieldRegion, itemMarker, itemRegion, parseItemMarker, slotRegion } from '@/lib/site-editor/markers'
import {
  BRIDGE_VERSION,
  editorMessage,
  frameMessage,
  isEditorMessage,
  isFrameMessage,
} from '@samfox1/site-bridge/protocol'
import {
  buildItemStyleControls,
  buildTextItemStyleControls,
  buildVideoItemStyleControls,
} from '@/lib/site-editor/style-controls'

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

describe('region helpers — emit marker attrs only in edit mode', () => {
  it('a template spreads these onto a region; empty when not editable', () => {
    expect(fieldRegion(true, 'shows_heading')).toEqual({ 'data-lse-field': 'shows_heading' })
    expect(fieldRegion(false, 'shows_heading')).toEqual({})
    expect(slotRegion(true, 'shows')).toEqual({ 'data-lse-slot': 'shows' })
    expect(slotRegion(false, 'shows')).toEqual({})
    expect(itemRegion(true, 'tour_date', 'abc-123')).toEqual({ 'data-lse-item': 'tour_date:abc-123' })
    expect(itemRegion(false, 'tour_date', 'abc-123')).toEqual({})
  })
})

describe('manifest — style + link regions', () => {
  it('every manifest declares both region lists, and each region is addressable', () => {
    // editor-shell reads `manifest.styles` straight into the Style panel and the editor
    // saves by region KEY, so a missing list is a crash and a duplicate key makes two
    // regions fight over one `site_styles` row. Built-in templates declare none today
    // (their DOM isn't style-tagged; a CUSTOM site posts its own edit-list on `ready`,
    // SITE_STYLING_PLAN.md D-D) — this holds either way.
    for (const m of Object.values(MANIFESTS) as TemplateManifest[]) {
      expect(Array.isArray(m.styles), `${m.template} styles`).toBe(true)
      expect(Array.isArray(m.links), `${m.template} links`).toBe(true)
      for (const r of [...m.styles, ...m.links]) {
        expect(r.key, `${m.template} region key`).toMatch(/^[A-Za-z0-9_]+$/)
        expect(r.label.length, `${m.template} ${r.key} label`).toBeGreaterThan(0)
      }
      const keys = m.styles.map((r) => r.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
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
        }
      })
    })
  }

  it('classic covers the core library sections', () => {
    const slotKeys = MANIFESTS.classic.slots.map((s) => s.key)
    expect(slotKeys).toEqual(expect.arrayContaining(['tracks', 'videos', 'tour_dates', 'merch', 'links']))
  })

  it('resolves a field current value from site_content and artist columns', () => {
    const m = MANIFESTS.cinematic
    const ctx = {
      template: 'cinematic',
      siteContent: { shows_heading: 'Gigs' },
      artist: { name: 'Skeen', bio: 'Bio text', hero_image_url: null },
    }
    expect(fieldCurrentValue(fieldByKey(m, 'shows_heading')!, ctx)).toBe('Gigs') // override
    expect(fieldCurrentValue(fieldByKey(m, 'work_heading')!, ctx)).toBe('Work') // template default
    expect(fieldCurrentValue(fieldByKey(m, 'artist_name')!, ctx)).toBe('Skeen')
    expect(fieldCurrentValue(fieldByKey(m, 'artist_bio')!, ctx)).toBe('Bio text')
    expect(fieldCurrentValue(fieldByKey(m, 'hero_image')!, ctx)).toBe('') // null → ''
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
    const msg = editorMessage({ type: 'apply-field', key: 'hero_tagline', value: 'hi' })
    expect(isEditorMessage(msg)).toBe(true)
    expect(isFrameMessage(msg)).toBe(false) // wrong source
  })

  it('carries the style + data-injection messages', () => {
    // No assertion on the NUMBER: pinning it fails on every legitimate protocol bump
    // while proving nothing about the wire. What the version has to DO — accept older
    // senders, refuse newer — is the skeen-mirror rule, covered in site-editor-bridge.
    const style = editorMessage({ type: 'apply-style', key: 'hero_wordmark', className: 'font-momo' })
    expect(isEditorMessage(style)).toBe(true)
    const select = frameMessage({ type: 'select', target: { kind: 'style', key: 'hero_wordmark' }, rect: { x: 0, y: 0, width: 1, height: 1 } })
    expect(isFrameMessage(select)).toBe(true)
  })

  it('rejects wrong version, wrong source, and non-objects', () => {
    expect(isFrameMessage({ v: 999, source: 'lse-frame', type: 'ready' })).toBe(false)
    expect(isFrameMessage({ v: BRIDGE_VERSION, source: 'evil', type: 'ready' })).toBe(false)
    expect(isFrameMessage(null)).toBe(false)
    expect(isFrameMessage('lse-frame')).toBe(false)
  })
})

describe('slice-1 effect controls reach both item panels (2026-08-10)', () => {
  it('CRITICAL: the FILTERS reach all three media surfaces; box controls only where they act', () => {
    // One builder feeds the filters everywhere (filterControls) — a filter acts on
    // whatever pixels are in the box, full-bleed hero video included (Sam, 2026-08-10:
    // those slots had "only speed and transparency"). Crop is image/video-element only:
    // object-fit cannot reach inside an iframe, so offering it on an embed is the
    // silent no-op this panel must never contain.
    const imageIds = buildItemStyleControls().map((c) => c.id)
    const embedIds = buildVideoItemStyleControls('embed').map((c) => c.id)
    const fileIds = buildVideoItemStyleControls('file').map((c) => c.id)
    for (const id of ['grayscale', 'sepia', 'brightness', 'contrast', 'saturate', 'soften']) {
      expect(imageIds, `image ${id}`).toContain(id)
      expect(embedIds, `embed ${id}`).toContain(id)
      expect(fileIds, `file ${id}`).toContain(id)
    }
    // Crop: images only. Tilt: anything with a visible box — not the full-bleed file.
    expect(imageIds).toContain('fit')
    expect(embedIds).not.toContain('fit')
    expect(embedIds).not.toContain('fitPosition')
    expect(fileIds).not.toContain('fit')
    expect(imageIds).toContain('tilt')
    expect(embedIds).toContain('tilt')
    expect(fileIds).not.toContain('tilt')
    // And speed stays impossible on an embed — CSS has no reach into YouTube's player.
    expect(embedIds).not.toContain('speed')
  })

  it('text panels offer shadow and outline', () => {
    const ids = buildTextItemStyleControls().map((c) => c.id)
    expect(ids).toContain('textShadow')
    expect(ids).toContain('textStroke')
    expect(ids).toContain('textGlow')
  })

  it('every effect control OWNS its tokens and only its tokens', () => {
    // `owns` is how a control finds its value in the stored string and how Reset knows
    // what to strip; two controls claiming one token corrupt each other on write.
    const all = [...buildItemStyleControls(), ...buildTextItemStyleControls()]
    const probes: Record<string, string> = {
      grayscale: 'bw-50', sepia: 'sepia-30', brightness: 'brightness-120', contrast: 'contrast-80',
      saturate: 'saturate-150', soften: 'soften-[4px]', tilt: 'tilt-[-6deg]',
      fit: 'fit-cover', fitPosition: 'fit-top', textShadow: 'textshadow-6', textStroke: 'textstroke-[2px]', textGlow: 'textglow-3',
    }
    for (const [id, token] of Object.entries(probes)) {
      const owners = all.filter((c) => c.owns(token)).map((c) => c.id)
      expect(owners, token).toEqual([id])
    }
  })
})
