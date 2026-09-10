/**
 * MULTI-PAGE manifests (SITE_PAGES_PLAN.md P1) — pure, no DB, no DOM.
 *
 * A site's `/edit` shell renders ONE page at a time and re-announces per page, because
 * `withDomTextFields()` can only read the DOM in front of it. So the editor receives a
 * SEQUENCE of partial manifests and has to fold them into one. Everything below pins
 * that fold.
 *
 * Written RED first (2026-09-03): `mergeManifests`, `ManifestPage`, `page?` and the
 * `set-page` / `page-change` messages did not exist when these were written, and each
 * assertion was seen failing for the right reason before the implementation landed.
 */
import { describe, expect, it } from 'vitest'
import {
  mergeManifests,
  type ManifestField,
  type ManifestPage,
  type ManifestStyleRegion,
  type TemplateManifest,
} from '@samfox1/site-bridge/manifest'
import {
  BRIDGE_VERSION,
  editorMessage,
  frameMessage,
  isEditorMessage,
  isFrameMessage,
} from '@samfox1/site-bridge/protocol'

const PAGES: ManifestPage[] = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'merch', label: 'Merch', path: '/merch' },
]

/** A manifest for ONE page, shaped the way a real announce arrives. */
function announce(
  page: string | undefined,
  parts: {
    fields?: Partial<ManifestField>[]
    styles?: Partial<ManifestStyleRegion>[]
    pages?: ManifestPage[]
  },
): TemplateManifest {
  return {
    template: 'skeen',
    pages: parts.pages,
    fields: (parts.fields ?? []).map((f) => ({
      key: f.key!,
      label: f.label ?? f.key!,
      type: 'text' as const,
      target: { store: 'site_content' as const, key: f.key! },
      ...(page ? { page } : {}),
      ...f,
    })),
    slots: [],
    styles: (parts.styles ?? []).map((s) => ({
      key: s.key!,
      label: s.label ?? s.key!,
      ...(page ? { page } : {}),
      ...s,
    })),
    links: [],
  }
}

describe('mergeManifests — the fold that makes per-page announces safe', () => {
  it('KEEPS an earlier page’s regions when a later page announces', () => {
    // THE bug D4 exists to stop: switch to Merch and Home's text silently vanishes from
    // the Text panel. Replacing instead of merging is the whole failure.
    const home = announce('home', { pages: PAGES, fields: [{ key: 'hero_line' }] })
    const merch = announce('merch', { pages: PAGES, fields: [{ key: 'merch_heading' }] })

    const { manifest } = mergeManifests(mergeManifests(null, home).manifest, merch)

    expect(manifest.fields.map((f) => f.key)).toEqual(['hero_line', 'merch_heading'])
  })

  it('is IDEMPOTENT — re-announcing the same page does not duplicate its regions', () => {
    // The frame announces more than once per page by design (`announce` is re-posted
    // after paint, and again whenever the editor says `hello`). A fold that appended
    // would grow the Text panel on every re-announce.
    const home = announce('home', { pages: PAGES, fields: [{ key: 'hero_line' }] })
    const once = mergeManifests(null, home).manifest
    const twice = mergeManifests(once, home).manifest

    expect(twice.fields).toHaveLength(1)
    expect(twice.styles).toHaveLength(0)
  })

  it('orders regions by the DECLARED pages sequence, never by visit order', () => {
    // A7 in the plan. `manifest.ts`'s rule is that an untagged photo belongs to the FIRST
    // declared image slot; under a visit-ordered fold, "first" becomes whichever page the
    // manager happened to open first, and skeen's untagged gallery photos change
    // collection. Visiting Merch BEFORE Home must not reorder anything.
    const home = announce('home', { pages: PAGES, styles: [{ key: 'home_band' }] })
    const merch = announce('merch', { pages: PAGES, styles: [{ key: 'merch_grid' }] })

    const merchFirst = mergeManifests(mergeManifests(null, merch).manifest, home).manifest

    expect(merchFirst.styles.map((s) => s.key)).toEqual(['home_band', 'merch_grid'])
  })

  it('a region with no `page` sorts with the FIRST page, so a one-page site is unmoved', () => {
    const one = announce(undefined, {
      fields: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
    })
    const { manifest } = mergeManifests(null, one)
    expect(manifest.fields.map((f) => f.key)).toEqual(['a', 'b', 'c'])
  })

  it('SINGLE-PAGE REGRESSION: a manifest declaring no pages folds to itself, deep-equal', () => {
    // The P1 acceptance test. Every site deployed today declares no `pages`, so this is
    // the assertion that says "we changed nothing for them".
    const site: TemplateManifest = {
      template: 'skeen',
      fields: [
        {
          key: 'hero_line',
          label: 'Hero line',
          type: 'text',
          target: { store: 'site_content', key: 'hero_line' },
        },
      ],
      slots: [{ key: 'gallery', label: 'Gallery', accepts: 'image' }],
      styles: [{ key: 'hero', label: 'Hero', base: 'text-4xl' }],
      links: [{ key: 'usb', label: 'USB' }],
      bridgeVersion: '0.33.5',
      styleOptions: { fonts: [{ value: 'font-momo', label: 'Momo' }] },
    }

    const { manifest, dropped } = mergeManifests(null, site)

    expect(manifest).toEqual(site)
    expect(dropped).toEqual([])
  })

  it('DROPS a duplicate key from a later page and REPORTS it (A6 — nothing else catches this)', () => {
    // The DB has `unique (artist_id, region_key)`, so two pages claiming one key share
    // one `site_styles` row and edits leak between pages with no error anywhere.
    // First-declared wins, deterministically, and the loser is named.
    const home = announce('home', {
      pages: PAGES,
      styles: [{ key: 'card_title', base: 'text-sm' }],
    })
    const merch = announce('merch', {
      pages: PAGES,
      styles: [{ key: 'card_title', base: 'text-lg' }],
    })

    const { manifest, dropped } = mergeManifests(mergeManifests(null, home).manifest, merch)

    expect(manifest.styles).toHaveLength(1)
    expect(manifest.styles[0]!.base).toBe('text-sm')
    expect(dropped).toEqual([{ kind: 'styles', key: 'card_title', page: 'merch', keptPage: 'home' }])
  })

  it('a duplicate WITHIN one page is reported too, not silently deduped', () => {
    const bad = announce('home', {
      pages: PAGES,
      fields: [{ key: 'dupe' }, { key: 'dupe' }],
    })
    const { manifest, dropped } = mergeManifests(null, bad)

    expect(manifest.fields).toHaveLength(1)
    expect(dropped).toHaveLength(1)
  })

  it('carries site-WIDE declarations forward when a page omits them', () => {
    // `styleOptions` is the site's palette and `about` its bio placement — facts about
    // the SITE, not the page. A page that omits them must not blank the Style panel's
    // colour swatches.
    const home = announce('home', { pages: PAGES, fields: [{ key: 'a' }] })
    home.styleOptions = { textColors: [{ value: 'text-flash-1', label: 'Red', hex: '#e2483d' }] }
    home.bridgeVersion = '0.34.0'

    const merch = announce('merch', { pages: PAGES, fields: [{ key: 'b' }] })

    const { manifest } = mergeManifests(mergeManifests(null, home).manifest, merch)

    expect(manifest.styleOptions?.textColors?.[0]?.value).toBe('text-flash-1')
    expect(manifest.bridgeVersion).toBe('0.34.0')
    expect(manifest.pages).toEqual(PAGES)
  })

  it('a page NOT in the declared list keeps its regions rather than dropping them', () => {
    // Degrade to "shown at the end", never to "invisible". A site whose `pages` list and
    // region tags disagree is a site bug, and swallowing the regions hides it.
    const stray = announce('nowhere', { pages: PAGES, styles: [{ key: 'stray' }] })
    const home = announce('home', { pages: PAGES, styles: [{ key: 'home_band' }] })

    const { manifest } = mergeManifests(mergeManifests(null, home).manifest, stray)

    expect(manifest.styles.map((s) => s.key)).toEqual(['home_band', 'stray'])
  })
})

/**
 * HONEST LIMIT (AGENTS.md: say so rather than leaving a reassuring green).
 *
 * The two stamp tests below passed BEFORE `set-page` and `page-change` existed, and they
 * still would if both were deleted from the union: `editorMessage` / `frameMessage` spread
 * whatever they are handed, so nothing about the message TYPE is checked at runtime. What
 * actually enforces the union is `tsc` — an undeclared type is a compile error at every
 * call site, which is why `npm run typecheck` is the gate for this pair, not vitest.
 *
 * They are kept because they DO bite on the two things that can regress at runtime: the
 * stamping (v + source) and the source discrimination, which is what stops each side
 * acting on its own echoes. The BRIDGE_VERSION assertion bites properly on its own.
 */
describe('protocol — set-page / page-change are ADDITIVE', () => {
  it('does NOT move BRIDGE_VERSION', () => {
    // The three deployed sites (skeen, ftbk, wren) each ship their own bridge copy. A
    // bump makes whichever side raises it first drop EVERY message from the other,
    // `ready` included — the frame then announces into the void and looks identical to a
    // wrong origin. Additive messages are ignored by an older peer instead.
    expect(BRIDGE_VERSION).toBe(2)
  })

  it('stamps and recognises `set-page` (editor → frame)', () => {
    const msg = editorMessage({ type: 'set-page', page: 'merch' })
    expect(msg).toMatchObject({ type: 'set-page', page: 'merch', v: BRIDGE_VERSION })
    expect(isEditorMessage(msg)).toBe(true)
    // The frame must never mistake it for one of its own.
    expect(isFrameMessage(msg)).toBe(false)
  })

  it('stamps and recognises `page-change` (frame → editor)', () => {
    // Trap 7: the editor cannot read a cross-origin iframe's location, so browse-mode
    // navigation is only ever knowable because the frame says so.
    const msg = frameMessage({ type: 'page-change', page: 'merch' })
    expect(msg).toMatchObject({ type: 'page-change', page: 'merch', v: BRIDGE_VERSION })
    expect(isFrameMessage(msg)).toBe(true)
    expect(isEditorMessage(msg)).toBe(false)
  })
})
