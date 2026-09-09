/**
 * THE PANELS SHOW THE PAGE THE FRAME IS SHOWING (SITE_PAGES_PLAN.md D5, P2).
 *
 * P1 taught the editor to MERGE one announce per page into a single manifest, so by the
 * time a manager has visited Home and About the manifest holds both pages' regions. That
 * is correct as a store and wrong as a panel: standing on About, the Style panel listed
 * every one of Home's forty regions, and clicking one highlighted nothing, because the
 * element is not in the frame.
 *
 * The rule this pins is the bridge's own, stated at `PageScoped` in manifest.ts:
 * an ABSENT tag means "the first declared page". That is what makes every existing
 * single-page manifest correct without touching it, and it is why skeen needs no change
 * — its home regions are untagged and its About regions carry `page: "about"`.
 *
 * Three failures this suite exists to catch, all of which look identical from the outside
 * (a panel with the wrong things in it):
 *   - filtering a category that is site-WIDE (fonts, budgets) — controls vanish per page;
 *   - failing to filter a category that is page-scoped — Home's regions leak onto About;
 *   - filtering at all before the frame has said which page it shows (`page: null`),
 *     which is the state every single-page site is in forever.
 */
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_IS_PAGE_SCOPED,
  CATEGORY_CONSUMERS,
  MANIFEST_CATEGORIES,
  onPage,
  resolvePanelInputs,
} from '@/lib/site-editor/panel-inputs'
import type { TemplateManifest } from '@/lib/site-editor/manifest'
import type { PublicSitePayload, SiteContent } from '@/lib/site'
import { runtimeImageFields, runtimeTextFields } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'

const PAGES = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'about', label: 'About', path: '/about' },
]

/**
 * A two-page site whose every page-scoped category declares ONE untagged region (Home,
 * by the absent-tag rule) and ONE tagged `about`. Derived per category below rather than
 * hand-listed per panel, so a category that gains a page dimension is covered here the
 * moment it is added to the registry.
 */
const TWO_PAGE: TemplateManifest = {
  template: 'a-connected-site',
  pages: PAGES,
  fields: [
    { key: 'hero_tagline', label: 'Hero tagline', type: 'text', target: { store: 'site_content', key: 'hero_tagline' } },
    { key: 'about_bio', label: 'Bio', type: 'text', target: { store: 'site_content', key: 'about_bio' }, page: 'about' },
    { key: 'portrait', label: 'Portrait', type: 'image', target: { store: 'media', purpose: 'profile_photo' } },
    { key: 'about_shot', label: 'About shot', type: 'image', target: { store: 'media', purpose: 'profile_photo' }, page: 'about' },
  ],
  slots: [
    { key: 'gallery', label: 'Gallery', accepts: 'image' },
    { key: 'about_wall', label: 'About wall', accepts: 'image', page: 'about' },
  ],
  styles: [
    { key: 'hero', label: 'Hero', base: 'text-4xl' },
    { key: 'about_bio_block', label: 'Bio block', base: 'text-base', page: 'about' },
  ],
  links: [
    { key: 'booking', label: 'Booking' },
    { key: 'usb', label: 'USB', page: 'about' },
  ],
  components: [
    { key: 'polaroid', label: 'Polaroid', count: 2, slots: [{ key: 'photo', label: 'Photo' }] },
    { key: 'about_card', label: 'About card', count: 1, slots: [{ key: 'photo', label: 'Photo' }], page: 'about' },
  ],
  videoSlots: [
    { kind: 'hero', role: 'hero_landscape', label: 'Landscape', group: 'Landing page' },
    { kind: 'hero', role: 'bio_background', label: 'Bio background', group: 'About page', page: 'about' },
  ],
  // Site-WIDE. These belong to no page and must survive every switch.
  styleOptions: { fonts: [{ value: 'font-serif', label: 'Serif' }] },
  assetBudgets: { image: { maxBytes: 1_000_000 } },
  itemStyling: false,
} as unknown as TemplateManifest

const DRAFT = { artist: { hero_image_url: null }, media: [], styles: {} } as unknown as PublicSitePayload
const CONTENT: SiteContent = {}

const resolve = (page: string | null, manifest: TemplateManifest = TWO_PAGE) =>
  resolvePanelInputs({
    customSiteUrl: 'https://site.example',
    manifest,
    page,
    draft: DRAFT,
    siteContent: CONTENT,
    local: { textFields: [], imageFields: [] },
    derive: { textFields: runtimeTextFields, imageFields: runtimeImageFields },
  })

/** Every key a page-scoped category resolved to, as plain strings — the shapes differ
 *  (key / role), so this asks each input for its identity the way its panel does. */
const idsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).map((v) => String(v?.key ?? v?.role ?? ''))

describe('a region belongs to the page it is tagged with; absent means the FIRST page', () => {
  it('CRITICAL: standing on About, Home’s regions are gone and About’s are there', () => {
    const about = resolve('about')
    expect(idsOf(about.styleRegions)).toEqual(['about_bio_block'])
    expect(idsOf(about.textFields)).toEqual(['about_bio'])
    expect(idsOf(about.imageFields)).toEqual(['about_shot'])
    expect(idsOf(about.imageCollections)).toEqual(['about_wall'])
    expect(idsOf(about.linkRegions)).toEqual(['usb'])
    expect(idsOf(about.components)).toEqual(['about_card'])
    expect(idsOf(about.videoSlots)).toEqual(['bio_background'])
  })

  it('CRITICAL: standing on Home, the UNTAGGED regions are the ones that show', () => {
    // The other half of the rule, and the one that would be vacuous alone: a filter that
    // dropped everything tagged would pass the About case above only by accident.
    const home = resolve('home')
    expect(idsOf(home.styleRegions)).toEqual(['hero'])
    expect(idsOf(home.textFields)).toEqual(['hero_tagline'])
    expect(idsOf(home.imageFields)).toEqual(['portrait'])
    expect(idsOf(home.imageCollections)).toEqual(['gallery'])
    expect(idsOf(home.linkRegions)).toEqual(['booking'])
    expect(idsOf(home.components)).toEqual(['polaroid'])
    expect(idsOf(home.videoSlots)).toEqual(['hero_landscape'])
  })

  it('CRITICAL: site-WIDE categories never filter — they belong to no page', () => {
    // Fonts, budgets and the styling lock are facts about the SITE. Filtering them would
    // empty the font picker the moment a manager stepped off Home, which reads as the
    // editor breaking rather than as a page having no fonts of its own.
    for (const page of [null, 'home', 'about']) {
      const inputs = resolve(page)
      expect(inputs.styleOptions, `styleOptions on ${page}`).toEqual(TWO_PAGE.styleOptions)
      expect(inputs.assetBudgets, `assetBudgets on ${page}`).toEqual(TWO_PAGE.assetBudgets)
      expect(inputs.itemStyling, `itemStyling on ${page}`).toBe(false)
    }
  })

  it('CRITICAL: the P1 regression — no page yet means nothing filters', () => {
    // `framePage` is null until the frame's first `page-change`, and forever on a site
    // that declares no pages. Filtering in that state would blank every panel on load.
    const unknown = resolve(null)
    expect(idsOf(unknown.styleRegions)).toEqual(['hero', 'about_bio_block'])
    expect(idsOf(unknown.textFields).sort()).toEqual(['about_bio', 'hero_tagline'])
    expect(idsOf(unknown.linkRegions)).toEqual(['booking', 'usb'])
  })

  it('CRITICAL: a site that declares NO pages is untouched, whatever page is named', () => {
    // Every site before this feature. Its regions are untagged and its manifest has no
    // `pages`, so there is no first page to belong to and nothing to filter against.
    const onePage = { ...TWO_PAGE, pages: undefined } as unknown as TemplateManifest
    const named = resolve('home', onePage)
    expect(idsOf(named.styleRegions)).toEqual(['hero', 'about_bio_block'])
    expect(idsOf(named.linkRegions)).toEqual(['booking', 'usb'])
  })

  it('CRITICAL: a page named with NO manifest is harmless, not a crash', () => {
    // Not reachable through the editor today — `framePage` is only ever set to a page the
    // manifest declared, so a page without a manifest cannot arise. It is asserted anyway
    // because the alternative is a TypeError: narrowing a null manifest would reach for
    // `manifest.pages` on nothing. A mutation run found this branch unwatched (Stryker,
    // 2026-09-09), and an unwatched crash path is one a later refactor walks into.
    const inputs = resolve('about', null as unknown as TemplateManifest)
    expect(inputs.styleRegions).toEqual([])
    expect(inputs.textFields).toEqual([])
  })

  it('a region tagged with an UNDECLARED page shows on the first page, never nowhere', () => {
    // The fold's own principle at manifest.ts `rank`: "degrade to misplaced, never to
    // invisible". A tag naming a page the site stopped declaring must not delete the
    // manager's only route to that region.
    const stale = {
      ...TWO_PAGE,
      styles: [{ key: 'ghost', label: 'Ghost', base: 'text-sm', page: 'merch' }],
    } as unknown as TemplateManifest
    expect(idsOf(resolve('home', stale).styleRegions)).toEqual(['ghost'])
    expect(idsOf(resolve('about', stale).styleRegions)).toEqual([])
  })
})

describe('every category has DECIDED whether it belongs to a page', () => {
  it('CRITICAL: the page-scope registry covers the category registry exactly', () => {
    // AGENTS.md rule 4. A hand-written list silently omits every future category — which
    // is the exact defect CATEGORY_CONSUMERS was built to end one layer up. A new
    // category is a compile error in the Record and a failure here if the Record is
    // widened to a partial.
    expect(Object.keys(CATEGORY_IS_PAGE_SCOPED).sort()).toEqual([...MANIFEST_CATEGORIES].sort())
  })

  it('CRITICAL: every category marked page-scoped actually filters', () => {
    // The registry is a claim; this makes it evidence. For each scoped category, the
    // regions on Home and the regions on About must DIFFER — a category listed as scoped
    // whose resolver forgot to filter fails here rather than in a manager's panel.
    const home = resolve('home')
    const about = resolve('about')
    const scoped = MANIFEST_CATEGORIES.filter((c) => CATEGORY_IS_PAGE_SCOPED[c])
    expect(scoped.length, 'no category is page-scoped — the registry is inert').toBeGreaterThan(0)
    for (const category of scoped) {
      for (const consumer of CATEGORY_CONSUMERS[category]) {
        expect(idsOf(home[consumer]), `${category} → ${consumer} did not filter`).not.toEqual(
          idsOf(about[consumer]),
        )
      }
    }
  })
})

describe('onPage — the predicate the resolver leans on', () => {
  const items = [{ key: 'a' }, { key: 'b', page: 'about' }, { key: 'c', page: 'home' }]

  it('CRITICAL: an absent page argument returns the list unfiltered', () => {
    expect(onPage(items, null, PAGES)).toEqual(items)
  })

  it('CRITICAL: an absent tag reads as the FIRST declared page, not as "everywhere"', () => {
    // The load-bearing half. Were untagged read as site-wide, About would carry every one
    // of Home's regions and the switcher would change almost nothing on screen.
    expect(onPage(items, 'home', PAGES)?.map((i) => i.key)).toEqual(['a', 'c'])
    expect(onPage(items, 'about', PAGES)?.map((i) => i.key)).toEqual(['b'])
  })

  it('an undefined list stays undefined — an absent category is not an empty one', () => {
    // `videoSlots: undefined` and `videoSlots: []` resolve the same downstream, but the
    // manifest is passed on to the fold and to `checkContract`, and inventing an empty
    // array there would turn "declares nothing" into "declares none".
    expect(onPage(undefined, 'home', PAGES)).toBeUndefined()
  })

  it('no declared pages means no filtering, even with a page named', () => {
    expect(onPage(items, 'home', undefined)).toEqual(items)
    expect(onPage(items, 'home', [])).toEqual(items)
  })
})
