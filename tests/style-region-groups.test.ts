/**
 * `groupStyleRegions` (lib/site-editor/manifest) — the Style panel's outline.
 *
 * The inspector groups style regions into headed runs so the panel reads as a short
 * outline of the page instead of one flat list. A site MAY declare `group` per region;
 * when it doesn't, groups are inferred from the key prefix before the first `_`, but
 * only where two or more regions share that prefix — otherwise every one-off key would
 * become its own heading, which is noise, not structure.
 */
import { describe, expect, it } from 'vitest'
import { groupStyleRegions, sectionRowLabel, visibleStyleRegions, type ManifestStyleRegion } from '@/lib/site-editor/manifest'

const r = (key: string, group?: string): ManifestStyleRegion => ({ key, label: key, group })

/** Skeen's real region keys, in manifest order (lib/styles.ts). */
const SKEEN = [
  r('hero_wordmark'),
  r('hero_video'),
  r('hero_nav'),
  r('hero_socials'),
  r('shows_section'),
  r('work_section'),
  r('about_section'),
  r('gallery_section'),
  r('videos_section'),
  r('footer'),
]

describe('groupStyleRegions', () => {
  it('infers a group from a shared key prefix, collecting one-offs under the fallback', () => {
    const groups = groupStyleRegions(SKEEN)
    expect(groups.map(([heading]) => heading)).toEqual(['Hero', 'Sections'])
    expect(groups[0][1].map((x) => x.key)).toEqual(['hero_wordmark', 'hero_video', 'hero_nav', 'hero_socials'])
    // The six singleton keys (incl. the prefix-less `footer`) collect together.
    expect(groups[1][1].map((x) => x.key)).toEqual([
      'shows_section',
      'work_section',
      'about_section',
      'gallery_section',
      'videos_section',
      'footer',
    ])
  })

  it('does NOT invent a heading when nothing groups — one unlabelled run, manifest order', () => {
    const flat = [r('footer'), r('masthead'), r('sidebar')]
    expect(groupStyleRegions(flat)).toEqual([['', flat]])
  })

  it('a declared group always wins over the inferred one', () => {
    const groups = groupStyleRegions([r('hero_a', 'Top of page'), r('hero_b'), r('hero_c')])
    // hero_a opted out by declaring; the other two still share the `hero` prefix.
    expect(groups.map(([heading]) => heading)).toEqual(['Top of page', 'Hero'])
    expect(groups[0][1].map((x) => x.key)).toEqual(['hero_a'])
    expect(groups[1][1].map((x) => x.key)).toEqual(['hero_b', 'hero_c'])
  })

  it('a single declared group still suppresses the "nothing groups" shortcut', () => {
    // One declared group among otherwise-ungroupable keys must still be honoured,
    // rather than collapsing to the unlabelled run.
    const groups = groupStyleRegions([r('footer', 'Chrome'), r('masthead')])
    expect(groups).toEqual([
      ['Chrome', [r('footer', 'Chrome')]],
      ['Sections', [r('masthead')]],
    ])
  })

  it('preserves manifest order within a group and first-appearance order across groups', () => {
    const groups = groupStyleRegions([r('b_one'), r('a_one'), r('b_two'), r('a_two')])
    expect(groups.map(([heading]) => heading)).toEqual(['B', 'A'])
    expect(groups[0][1].map((x) => x.key)).toEqual(['b_one', 'b_two'])
  })

  it('never makes an EMPTY heading from a leading-underscore key', () => {
    // `_a`.split('_')[0] is '', which used to become a blank heading sitting beside
    // labelled ones — the blank run is only ever meant to be the whole-list fallback.
    // An empty prefix can't group, so nothing groups here at all — which is the
    // documented plain-list fallback, NOT a blank heading beside real ones.
    const groups = groupStyleRegions([r('_a'), r('_b'), r('footer')])
    expect(groups.map(([heading]) => heading)).toEqual([''])
    expect(groups[0][1].map((x) => x.key)).toEqual(['_a', '_b', 'footer'])
  })

  it('keeps a real heading when underscore keys sit beside a groupable prefix', () => {
    const groups = groupStyleRegions([r('_a'), r('_b'), r('hero_x'), r('hero_y')])
    expect(groups.map(([heading]) => heading)).toEqual(['Sections', 'Hero'])
    expect(groups[0][1].map((x) => x.key)).toEqual(['_a', '_b'])
  })

  it('takes a custom fallback heading', () => {
    const groups = groupStyleRegions([r('hero_a'), r('hero_b'), r('footer')], 'Elsewhere')
    expect(groups.map(([heading]) => heading)).toEqual(['Hero', 'Elsewhere'])
  })

  it('is empty for no regions', () => {
    expect(groupStyleRegions([])).toEqual([])
  })
})

describe('visibleStyleRegions — the Style tab shows SITE-WIDE styles only', () => {
  const regions: ManifestStyleRegion[] = [
    { key: 'page', label: 'Page background', scope: 'site' },
    { key: 'masthead', label: 'Masthead', scope: 'chrome' }, // bars list beside the page
    { key: 'hero_name', label: 'Hero title' },
    { key: 'work_section', label: 'Music section' },
  ]

  it('CRITICAL: browsing shows site-wide regions ONLY — per-element regions are click-to-edit', () => {
    // Sam, 2026-08-12: the old tab listed every region next to click-to-edit — two
    // places to edit the same thing. Browsing the tab now shows only what belongs to
    // no clickable element (the page itself).
    expect(visibleStyleRegions(regions, null).map((r) => r.key)).toEqual(['page', 'masthead'])
  })

  it("CRITICAL: a click FOCUSES — only the clicked region's controls, no site list around them", () => {
    // The second half of the same rule: clicking an element shows THAT element's
    // tools, not the element appended to the site-wide list (Sam's follow-up: the tab
    // must never become a second place to edit page parts).
    expect(visibleStyleRegions(regions, 'hero_name').map((r) => r.key)).toEqual(['hero_name'])
  })

  it('a stale selection that matches no region falls back to browsing', () => {
    expect(visibleStyleRegions(regions, 'gone').map((r) => r.key)).toEqual(['page', 'masthead'])
  })
})

describe('sectionRowLabel — no double headers (Sam, 2026-08-12)', () => {
  it('CRITICAL: strips the group word from a child label — "Hero" › "Name", not "Hero name"', () => {
    expect(sectionRowLabel('Hero', 'Hero name')).toBe('Name')
    expect(sectionRowLabel('Hero', 'Hero tagline')).toBe('Tagline')
  })

  it('a label that IS the heading collapses to empty — the row needs no repeat', () => {
    // "Footer" group over a "Footer" region: the heading already says it.
    expect(sectionRowLabel('Footer', 'Footer')).toBe('')
  })

  it('a label unrelated to the heading is untouched', () => {
    expect(sectionRowLabel('Site', 'Page background')).toBe('Page background')
    expect(sectionRowLabel('', 'Biography')).toBe('Biography')
  })

  it('case-insensitive, and only a whole leading word (not a prefix substring)', () => {
    expect(sectionRowLabel('hero', 'Hero Name')).toBe('Name')
    expect(sectionRowLabel('Foot', 'Footer')).toBe('Footer') // "Foot" is not the word "Footer"
  })
})
