// @vitest-environment jsdom
/**
 * A REGION KEY USED ON TWO PAGES IS A BUG THE BUILD MUST CATCH (SITE_PAGES_PLAN.md A6/P5).
 *
 * Region keys are ONE FLAT NAMESPACE across every page (D3): `page` is a tag for grouping,
 * never part of the key, because `site_styles` rows are keyed by the bare key and a prefix
 * syntax would have cost a migration. The price of that decision is this collision — two
 * pages declaring `hero` share one override row — and nothing caught it:
 *
 *   - the DB's unique constraint makes the two SHARE a row rather than conflict;
 *   - `frame.ts` applies a style by `querySelectorAll` on the key, so it dresses both
 *     elements on whichever page is showing;
 *   - and the D4 merge quietly resolves it first-wins.
 *
 * So a manager restyles the merch heading and the About heading changes too, with nothing
 * anywhere saying why. A6 asked for the guard in two layers; this is the BUILD-TIME half,
 * which a connecting site runs in its own suite over the union of its pages. The runtime
 * half is `droppedRegions`, surfaced in the editor (tests/editor-dropped-regions.test.tsx).
 *
 * The test A6 named as vacuous (`tests/site-editor.test.ts`) stays vacuous and honest —
 * it runs over built-in manifests that declare no styles. THIS is the one that bites.
 */
import { describe, expect, it } from 'vitest'
import { checkContract } from '@samfox1/site-bridge/contract'
import { STYLE_ATTR, FIELD_ATTR, SLOT_ATTR, LINK_ATTR } from '@samfox1/site-bridge/markers'

/** A DOM carrying every marker a manifest below declares, so rule 2 is satisfied and the
 *  only findings are the ones each test is about. */
function domFor(keys: { style?: string[]; field?: string[]; slot?: string[]; link?: string[] }) {
  const el = document.createElement('div')
  for (const k of keys.style ?? []) el.appendChild(mark(STYLE_ATTR, k))
  for (const k of keys.field ?? []) el.appendChild(mark(FIELD_ATTR, k))
  for (const k of keys.slot ?? []) el.appendChild(mark(SLOT_ATTR, k))
  for (const k of keys.link ?? []) el.appendChild(mark(LINK_ATTR, k))
  return el
}
const mark = (attr: string, key: string) => {
  const n = document.createElement('div')
  n.setAttribute(attr, key)
  return n
}

const run = (manifest: unknown, dom: Element) =>
  checkContract({ manifest: manifest as never, publicDom: document.createElement('div'), editableDom: dom })

const dupes = (findings: { check: string; detail: string }[]) =>
  findings.filter((f) => f.check === 'duplicate-key')

const PAGES = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'merch', label: 'Merch', path: '/merch' },
]

describe('duplicate-key — one key, two pages', () => {
  it('CRITICAL: two STYLE regions sharing a key are reported, naming both pages', () => {
    const manifest = {
      template: 't', pages: PAGES, fields: [], slots: [], links: [],
      styles: [
        { key: 'heading', label: 'Home heading', base: 'text-2xl' },
        { key: 'heading', label: 'Merch heading', base: 'text-xl', page: 'merch' },
      ],
    }
    const found = dupes(run(manifest, domFor({ style: ['heading'] })))
    expect(found, 'a shared key was not reported').toHaveLength(1)
    // The detail has to be actionable: WHICH key, and which two pages fight over it.
    expect(found[0].detail).toContain('heading')
    expect(found[0].detail).toContain('merch')
  })

  it('CRITICAL: a UNIQUE key across pages is not reported', () => {
    // The witness. A checker that flagged everything would satisfy the test above and be
    // useless — and this is the shape every real site is in.
    const manifest = {
      template: 't', pages: PAGES, fields: [], slots: [], links: [],
      styles: [
        { key: 'home_heading', label: 'Home', base: 'text-2xl' },
        { key: 'merch_heading', label: 'Merch', base: 'text-xl', page: 'merch' },
      ],
    }
    expect(dupes(run(manifest, domFor({ style: ['home_heading', 'merch_heading'] })))).toEqual([])
  })

  it('CRITICAL: it checks every LIST, not only styles', () => {
    // Fields, slots and links are keyed the same way and collide the same way: a field
    // key is a `site_content` row, a slot key is a photo collection.
    const manifest = {
      template: 't', pages: PAGES,
      fields: [
        { key: 'tagline', label: 'A', type: 'text', target: { store: 'site_content', key: 'tagline' } },
        { key: 'tagline', label: 'B', type: 'text', target: { store: 'site_content', key: 'tagline' }, page: 'merch' },
      ],
      slots: [
        { key: 'gallery', label: 'A', accepts: 'image' },
        { key: 'gallery', label: 'B', accepts: 'image', page: 'merch' },
      ],
      links: [
        { key: 'shop', label: 'A' },
        { key: 'shop', label: 'B', page: 'merch' },
      ],
      styles: [],
    }
    const found = dupes(run(manifest, domFor({ field: ['tagline'], slot: ['gallery'], link: ['shop'] })))
    expect(found.map((f) => f.detail.match(/"([^"]+)"/)?.[1]).sort()).toEqual(['gallery', 'shop', 'tagline'])
  })

  it('CRITICAL: the same key in DIFFERENT lists is fine — namespaces are per list', () => {
    // A field `usb` and a link `usb` are different rows in different tables, and skeen
    // deliberately names a region after the field it dresses. Flagging that would make
    // the check unusable on the site it was written for.
    const manifest = {
      template: 't', pages: PAGES, slots: [],
      fields: [{ key: 'usb', label: 'USB', type: 'text', target: { store: 'site_content', key: 'usb' } }],
      links: [{ key: 'usb', label: 'USB' }],
      styles: [{ key: 'usb', label: 'USB', base: 'text-sm' }],
    }
    expect(dupes(run(manifest, domFor({ field: ['usb'], link: ['usb'], style: ['usb'] })))).toEqual([])
  })

  it('a key repeated on ONE page is still a duplicate', () => {
    // Two entries with the same key and the same tag are the same collision with a
    // simpler cause — a copy-paste in the registry.
    const manifest = {
      template: 't', pages: PAGES, fields: [], slots: [], links: [],
      styles: [
        { key: 'heading', label: 'A', base: 'text-2xl', page: 'merch' },
        { key: 'heading', label: 'B', base: 'text-xl', page: 'merch' },
      ],
    }
    expect(dupes(run(manifest, domFor({ style: ['heading'] })))).toHaveLength(1)
  })

  it('a site with NO pages is checked too — a repeat is a repeat', () => {
    // Every site before pages. The rule is about the KEY namespace, which has always been
    // flat; pages only made the collision easy to create by accident.
    const manifest = {
      template: 't', fields: [], slots: [], links: [],
      styles: [
        { key: 'heading', label: 'A', base: 'text-2xl' },
        { key: 'heading', label: 'B', base: 'text-xl' },
      ],
    }
    expect(dupes(run(manifest, domFor({ style: ['heading'] })))).toHaveLength(1)
  })
})
