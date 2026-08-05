/**
 * What the Text panel LISTS.
 *
 * It used to list only the site's declared text FIELDS — on skeen that is five polaroid
 * captions and nothing else, so the hero wordmark, the nav, every section heading and the
 * footer were unreachable from the panel whose whole job is the site's words.
 *
 * A site declares two things that bear on text: `fields` (copy the manager TYPES) and
 * `styles` (regions the manager RESTYLES). Most text on a site is the second kind. The
 * panel now lists both, paired by key where they describe the same thing, so "the text
 * sections" means what a manager would point at on screen.
 */
import { describe, expect, it } from 'vitest'
import { textPanelEntries } from '@/lib/site-editor/text-panel'
import type { ManifestField, ManifestStyleRegion } from '@/lib/site-editor/manifest'

const field = (key: string, label: string): ManifestField => ({
  key,
  label,
  type: 'text',
  target: { store: 'site_content', key },
})

// Skeen's real shapes, abbreviated — the point is the BASE classes, which are the only
// signal distinguishing a text region from a media one.
const HERO_WORDMARK: ManifestStyleRegion = {
  key: 'hero_wordmark',
  label: 'Hero wordmark (SKEEN)',
  base: 'fx-glitch-mono font-alt text-[clamp(4rem,18vw,11rem)] font-black uppercase leading-none',
}
const HERO_VIDEO: ManifestStyleRegion = {
  key: 'hero_video',
  label: 'Hero video',
  base: 'absolute inset-0 h-full w-full object-cover',
}
const FOOTER: ManifestStyleRegion = {
  key: 'footer',
  label: 'Footer',
  base: 'mt-auto border-t border-border px-6 py-16 text-center',
}
const POLAROID_WALL: ManifestStyleRegion = {
  key: 'polaroid_wall',
  label: 'Polaroid wall',
  base: 'mx-auto flex max-w-[1400px] flex-wrap items-start justify-center gap-x-8 px-6',
}

describe('textPanelEntries', () => {
  it('CRITICAL: lists text-bearing STYLE REGIONS, not just declared fields', () => {
    // The bug this fixes: skeen declares only polaroid captions as fields, so a panel
    // driven by fields alone showed five rows and nothing else on an eleven-region site.
    const entries = textPanelEntries([], [HERO_WORDMARK, FOOTER])
    expect(entries.map((e) => e.key)).toEqual(['hero_wordmark', 'footer'])
    expect(entries[0].styleRegion?.key).toBe('hero_wordmark')
    // Nothing to type into: the site never declared this as editable copy.
    expect(entries[0].field).toBeNull()
  })

  it('CRITICAL: skips regions that are not text', () => {
    // A video region has no words in it; offering Font and Size there is nonsense the
    // manager has to learn to ignore.
    const entries = textPanelEntries([], [HERO_WORDMARK, HERO_VIDEO])
    expect(entries.map((e) => e.key)).toEqual(['hero_wordmark'])
  })

  it('a layout-only region is not text either', () => {
    // The polaroid WALL is a flex container: it positions cards, it does not set type.
    expect(textPanelEntries([], [POLAROID_WALL])).toEqual([])
  })

  it('pairs a field with the region of the same key — one row, both jobs', () => {
    const region: ManifestStyleRegion = { key: 'hero_title', label: 'Hero title', base: 'text-4xl font-bold' }
    const entries = textPanelEntries([field('hero_title', 'Hero title')], [region])
    expect(entries).toHaveLength(1)
    expect(entries[0].field?.key).toBe('hero_title')
    expect(entries[0].styleRegion?.key).toBe('hero_title')
  })

  it('an explicit styleKey pairs a field with a region named differently', () => {
    const region: ManifestStyleRegion = { key: 'polaroid_caption', label: 'Polaroid caption', base: 'text-sm' }
    const f = { ...field('polaroid_1_caption', 'Polaroid 1 caption'), styleKey: 'polaroid_caption' }
    const entries = textPanelEntries([f], [region])
    // ONE row: the caption, styled by the shared region — not a caption row plus an
    // orphan region row saying the same thing twice.
    expect(entries).toHaveLength(1)
    expect(entries[0].field?.key).toBe('polaroid_1_caption')
    expect(entries[0].styleRegion?.key).toBe('polaroid_caption')
  })

  it('several fields may share one region without duplicating it', () => {
    const region: ManifestStyleRegion = { key: 'polaroid_caption', label: 'Polaroid caption', base: 'text-sm' }
    const fields = [1, 2, 3].map((n) => ({
      ...field(`polaroid_${n}_caption`, `Polaroid ${n} caption`),
      styleKey: 'polaroid_caption',
    }))
    const entries = textPanelEntries(fields, [region])
    expect(entries).toHaveLength(3)
    expect(entries.every((e) => e.styleRegion?.key === 'polaroid_caption')).toBe(true)
  })

  it('fields come first, then regions the fields did not claim', () => {
    // The manager's own copy is what they came for; the site's other text areas follow.
    const entries = textPanelEntries([field('polaroid_1_caption', 'Caption 1')], [HERO_WORDMARK])
    expect(entries.map((e) => e.key)).toEqual(['polaroid_1_caption', 'hero_wordmark'])
  })

  it('an email field is still listed — it is copy the manager types', () => {
    const f: ManifestField = { key: 'booking_email', label: 'Booking email', type: 'email', target: { store: 'site_content', key: 'booking_email' } }
    expect(textPanelEntries([f], []).map((e) => e.key)).toEqual(['booking_email'])
  })

  it('an IMAGE field is not text', () => {
    const f: ManifestField = { key: 'hero_image', label: 'Hero image', type: 'image', target: { store: 'artist', column: 'hero_image_url' } }
    expect(textPanelEntries([f], [])).toEqual([])
  })

  it('handles a site that declares neither', () => {
    expect(textPanelEntries([], [])).toEqual([])
    expect(textPanelEntries(undefined, undefined)).toEqual([])
  })
})
