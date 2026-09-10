/**
 * Which style region dresses a given text field.
 *
 * The Text panel edits WORDS (site_content); a style region edits how they LOOK
 * (site_styles). They were entirely separate, so styling a sentence meant typing it in
 * one panel and then hunting for the right region in another. This is the pairing rule
 * that lets Font/Size/Boldness sit beside the input.
 *
 * The rule has to fail SAFE in both directions: an unmatched field shows no controls
 * (rather than writing into some other element's region), and a declared styleKey naming
 * a region that does not exist shows none either (rather than saving into a key nothing
 * renders, which is invisible until a manager wonders why nothing changed).
 */
import { describe, expect, it } from 'vitest'
import { styleRegionForField } from '@/lib/site-editor/manifest'
import type { ManifestField, ManifestStyleRegion } from '@/lib/site-editor/manifest'

const field = (over: Partial<ManifestField> = {}): ManifestField => ({
  key: 'hero_title',
  label: 'Hero title',
  type: 'text',
  target: { store: 'site_content', key: 'hero_title' },
  ...over,
})

const regions: ManifestStyleRegion[] = [
  { key: 'hero_title', label: 'Hero title' },
  { key: 'hero_subtitle', label: 'Hero subtitle' },
  { key: 'about_copy_block', label: 'About block' },
]

describe('styleRegionForField', () => {
  it('pairs a field with the region of the same key — the ordinary case', () => {
    // Sites already name both after the thing on screen, so the common case needs no
    // extra declaration and no change on the site's side.
    expect(styleRegionForField(field(), regions)?.key).toBe('hero_title')
  })

  it('an explicit styleKey WINS over the matching key', () => {
    // Several fields can share one styled block (a paragraph of copy made of three
    // inputs). Without the override they would each style themselves and the block's
    // real region would be unreachable from the Text panel.
    const f = field({ key: 'hero_title', styleKey: 'about_copy_block' })
    expect(styleRegionForField(f, regions)?.key).toBe('about_copy_block')
  })

  it('CRITICAL: a field with no matching region yields NO controls', () => {
    // Not a fallback to the first region, and not a silent write into a neighbour: a
    // field nobody declared a region for is simply unstyleable here.
    expect(styleRegionForField(field({ key: 'nowhere' }), regions)).toBeNull()
  })

  it('CRITICAL: a styleKey naming a region that does not exist yields NO controls', () => {
    // The trap this guards: offering controls that save into a key nothing renders. The
    // manager changes the font, nothing happens, and there is no error to explain it.
    const f = field({ styleKey: 'typo_region' })
    expect(styleRegionForField(f, regions)).toBeNull()
  })

  it('handles a site that declares no regions at all', () => {
    // The built-in templates today. No regions means no styling controls, not a crash.
    expect(styleRegionForField(field(), [])).toBeNull()
    expect(styleRegionForField(field(), undefined as unknown as ManifestStyleRegion[])).toBeNull()
  })

  it('returns the REGION, not just its key, so the caller can label the controls', () => {
    // "Hero title Size" reads; "hero_title Size" is a key leaking into the UI.
    expect(styleRegionForField(field(), regions)?.label).toBe('Hero title')
  })
})
