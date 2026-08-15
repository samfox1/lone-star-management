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
import { groupByPrefix } from '@/lib/site-editor/manifest'
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
// A footer LINE: it sets type, so it is words. Not to be confused with skeen's `footer`
// region, which is the wrapper below — `text-center` on a `px-6 py-16` box is alignment,
// not type, and sizing it grew the whole section. See text-region-and-scale.test.ts.
const FOOTER: ManifestStyleRegion = {
  key: 'footer_line',
  label: 'Footer line',
  base: 'mt-auto px-6 py-16 text-center font-alt text-sm tracking-wide',
}
const FOOTER_WRAP: ManifestStyleRegion = {
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
  it('CRITICAL: a region NO field speaks for is not listed at all', () => {
    // It used to be, as a "Set by the site — restyle only" row, so a manager could
    // restyle text they cannot retype. In practice it filled the panel with things that
    // are not text to type — Operator's Tab buttons, Body copy, List rows and Section
    // stamps all sat there repeating the same unhelpful sentence (Sam, 2026-08-15).
    // They stay reachable by clicking the element in the preview, which is the
    // one-edit-path-per-thing rule this panel is built on.
    expect(textPanelEntries([], [HERO_WORDMARK, FOOTER])).toEqual([])
    expect(textPanelEntries([], [HERO_WORDMARK, HERO_VIDEO])).toEqual([])
    expect(textPanelEntries([], [POLAROID_WALL])).toEqual([])
  })

  it('CRITICAL: the panel is the manager\'s COPY — every row has words to type', () => {
    // The positive half. Without it, a function that returned [] for everything would
    // pass the rule above and empty the Text panel completely.
    const entries = textPanelEntries([field('hero_wordmark', 'Hero wordmark')], [HERO_WORDMARK, FOOTER])
    expect(entries.map((e) => e.key)).toEqual(['hero_wordmark'])
    expect(entries[0].field).not.toBeNull()
    // …and it still carries the region, so the row keeps its type controls.
    expect(entries[0].styleRegion?.key).toBe('hero_wordmark')
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

  it("CRITICAL: an ITEM-scoped region is not listed — its words are the library's", () => {
    // Song titles set type (font-serif text-2xl), so the text heuristic would list
    // them — but their words come from the Music section, not a text field (Sam,
    // 2026-08-12: "song titles are not set in the text section"). A site marks such
    // regions scope:'item'; their styling stays click-to-edit on the item.
    const entries = textPanelEntries(
      [],
      [{ key: 'song_title', label: 'Song titles', base: 'font-serif text-2xl', scope: 'item' }],
    )
    expect(entries).toHaveLength(0)
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

  it('only the fields are listed, in their declared order', () => {
    const entries = textPanelEntries(
      [field('polaroid_1_caption', 'Caption 1'), field('hero_wordmark', 'Hero wordmark')],
      [HERO_WORDMARK],
    )
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

describe('grouping a long text list', () => {
  it('CRITICAL: groups by key prefix, so 40 wrapped strings are not one scroll', () => {
    // Once a site wraps its text rather than declaring it, the panel goes from five rows
    // to forty. Flat, that is a wall. The prefixes a site already uses (hero_, tour_,
    // footer_) are the outline it means.
    const entries = [
      { key: 'hero_wordmark', label: 'Hero wordmark' },
      { key: 'hero_tagline', label: 'Hero tagline' },
      { key: 'tour_heading', label: 'Tour heading' },
      { key: 'tour_upcoming', label: 'Tour upcoming' },
      { key: 'footer_line', label: 'Footer line' },
    ]
    const grouped = groupByPrefix(entries)
    expect(grouped.map(([heading]) => heading)).toEqual(['Hero', 'Tour', 'Sections'])
    expect(grouped[0][1].map((e) => e.key)).toEqual(['hero_wordmark', 'hero_tagline'])
    // A lone prefix is not a group of one — it falls to the catch-all.
    expect(grouped[2][1].map((e) => e.key)).toEqual(['footer_line'])
  })

  it('a short list stays FLAT rather than inventing structure', () => {
    // Five captions under a heading called "Polaroid" is worse than five captions.
    const entries = [
      { key: 'a_one', label: 'One' },
      { key: 'b_two', label: 'Two' },
    ]
    expect(groupByPrefix(entries)).toEqual([['', entries]])
  })

  it('an empty list groups to nothing', () => {
    expect(groupByPrefix([])).toEqual([])
  })
})
