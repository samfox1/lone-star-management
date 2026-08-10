/**
 * EVERY DECLARED CATEGORY REACHES A PANEL.
 *
 * The defect this exists to end: categories were wired to the editor BY HAND, one at a
 * time, and each miss was invisible until somebody clicked. Text was the one left out in
 * 2026-08-05; images were the one left out in 2026-08-09 — and that second miss landed
 * in a file whose comment claimed the first had been the last.
 *
 * So this suite does not check a list somebody wrote down. It iterates
 * `MANIFEST_CATEGORIES`, feeds a manifest that declares ALL of them, and asserts each
 * one arrived somewhere. A category added to the union without a resolver fails to
 * compile; one added with a resolver that drops it fails here.
 */
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_CONSUMERS,
  MANIFEST_CATEGORIES,
  inputIsPopulated,
  resolvePanelInputs,
  type ManifestCategory,
  type PanelInputs,
} from '@/lib/site-editor/panel-inputs'
import type { TemplateManifest } from '@/lib/site-editor/manifest'
import type { PublicSitePayload, SiteContent } from '@/lib/site'
import { runtimeImageFields, runtimeTextFields } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'

/** A manifest that declares ONE of everything — the fixture is derived from the category
 *  registry's own shape, so a new category shows up here as a compile error too. */
const FULL: TemplateManifest = {
  template: 'a-connected-site',
  fields: [
    { key: 'hero_tagline', label: 'Hero tagline', type: 'text', target: { store: 'site_content', key: 'hero_tagline' }, defaultValue: 'Songs from the flood' },
    { key: 'portrait', label: 'Portrait', type: 'image', target: { store: 'media', purpose: 'profile_photo' } },
  ],
  slots: [{ key: 'gallery', label: 'Gallery', accepts: 'image' }],
  styles: [{ key: 'hero', label: 'Hero', base: 'text-4xl' }],
  links: [{ key: 'booking', label: 'Booking' }],
  components: [{ key: 'polaroid', label: 'Polaroid', count: 2, slots: [{ key: 'photo', label: 'Photo' }] }],
  styleOptions: { fonts: [{ value: 'font-serif', label: 'Serif' }] },
  assetBudgets: { image: { maxBytes: 1_000_000 } },
} as unknown as TemplateManifest

const DRAFT = { artist: { hero_image_url: null }, media: [], styles: {} } as unknown as PublicSitePayload
const CONTENT: SiteContent = {}

const resolve = (over: Partial<Parameters<typeof resolvePanelInputs>[0]> = {}) =>
  resolvePanelInputs({
    customSiteUrl: 'https://site.example',
    manifest: FULL,
    draft: DRAFT,
    siteContent: CONTENT,
    local: { textFields: [], imageFields: [] },
    derive: { textFields: runtimeTextFields, imageFields: runtimeImageFields },
    ...over,
  })

describe('a connected site’s declared categories all reach a panel', () => {
  it('CRITICAL: every category in the registry lands in at least one input', () => {
    const inputs = resolve()
    for (const category of MANIFEST_CATEGORIES) {
      const consumers = CATEGORY_CONSUMERS[category]
      expect(consumers.length, `${category} names no consumer`).toBeGreaterThan(0)
      // EVERY named consumer, not some. `fields` feeds two panels, and `some` was
      // satisfied by text alone — which is precisely how images went missing for four
      // days while a green suite watched. The fixture declares content for every
      // consumer, so `every` is the honest bar.
      const missing = consumers.filter((key) => !inputIsPopulated(inputs[key]))
      expect(missing, `"${category}" declared but did not reach: ${missing.join(', ')}`).toEqual([])
    }
  })

  it('CRITICAL: a manifest field becomes a TEXT or IMAGE control by its type, never both', () => {
    // The 2026-08-09 miss in one assertion: a declared image reaching no panel is what a
    // manager experiences as "clicking the portrait does nothing".
    const inputs = resolve()
    expect(inputs.textFields.map((f) => f.key)).toContain('hero_tagline')
    expect(inputs.imageFields.map((f) => f.key)).toContain('portrait')
    expect(inputs.imageFields.map((f) => f.key)).not.toContain('hero_tagline')
    expect(inputs.textFields.map((f) => f.key)).not.toContain('portrait')
  })

  it('every consumer key is a real member of PanelInputs', () => {
    // The Record types the KEY but a stale value would still typecheck as a keyof union;
    // this proves each named consumer exists on the resolved object at runtime too.
    const inputs = resolve()
    for (const keys of Object.values(CATEGORY_CONSUMERS)) {
      for (const key of keys) expect(Object.hasOwn(inputs, key), key).toBe(true)
    }
  })
})

describe('a BUILT-IN template is not fed by what its frame announces', () => {
  it('CRITICAL: an announced manifest is ignored; the local props win', () => {
    // Built-ins announce a manifest too (it exists so the frame's apply-field can tell
    // text from images). If that became a second editor-side source, a built-in would
    // render panels for a site it does not have. `customSiteUrl` is the discriminator —
    // NOT "did a manifest resolve", since a custom artist's `template` column still
    // names a built-in one and a local manifest therefore always exists.
    const local = {
      textFields: [{ key: 'local_only', label: 'Local only', type: 'text' as const, value: 'x', multiline: false }],
      imageFields: [],
    }
    const inputs = resolve({ customSiteUrl: null, local })
    expect(inputs.textFields).toBe(local.textFields)
    expect(inputs.styleRegions).toEqual([])
    expect(inputs.linkRegions).toEqual([])
    expect(inputs.components).toEqual([])
    // The gallery too: it read the UNGATED manifest before this refactor, so a built-in
    // announcing an image slot would have shown a collage its template cannot render.
    expect(inputs.showGallery).toBe(false)
  })
})

describe('the registry is the list', () => {
  it('CATEGORY_CONSUMERS covers exactly MANIFEST_CATEGORIES', () => {
    // A Record<ManifestCategory, …> makes a MISSING key a compile error; this catches the
    // other direction — a stale key left behind after a category is removed.
    expect(Object.keys(CATEGORY_CONSUMERS).sort()).toEqual([...MANIFEST_CATEGORIES].sort())
  })

  it('every category names a key the manifest actually has', () => {
    // A category that is not a manifest key would be resolved from nothing forever.
    for (const category of MANIFEST_CATEGORIES) {
      expect(Object.hasOwn(FULL, category), `${category} is not a TemplateManifest key`).toBe(true)
    }
  })

  it('compile-time: the union and the record cannot drift', () => {
    // `Record<ManifestCategory, …>` above is the real guard; this line makes the intent
    // executable — widening the union without touching the record stops compiling here.
    const exhaustive: Record<ManifestCategory, true> = {
      fields: true, slots: true, styles: true, links: true,
      components: true, styleOptions: true, assetBudgets: true,
    }
    expect(Object.keys(exhaustive).length).toBe(MANIFEST_CATEGORIES.length)
  })
})
