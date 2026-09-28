// What the site editor's Revert (and Restore version) may put back, per kind: the SHAPE
//   of its reach, read from the registry rather than trusted from a reading of the list.
/**
 * `EDITOR_RESTORE` is the whole of Revert's reach (Sam, 2026-09-28). Two kinds of rule:
 *
 *   whole      rows the editor makes itself (styles, site text, the USB/Merch/booking
 *              buttons, contact rows): edited ones go back, added ones go, deleted ones
 *              come back.
 *   placement  rows that exist without the editor — a connection, a song, a show, a
 *              product, a photo, a video. Only WHERE and WHETHER they sit on the site
 *              comes back (on_site, sort_order, site_role). Never deleted, never
 *              re-inserted, never their content.
 *
 * The integration suite (tests/integration/publish/restore-published.test.ts) proves the
 * database does what these rules say. This file pins the rules themselves, so a new
 * column or kind added to a rule by hand has to get past them.
 */
import { describe, expect, it } from 'vitest'
import {
  ARTIST_SNAPSHOT,
  EDITOR_PROFILE_COLUMNS,
  EDITOR_RESTORE,
  PUBLISHABLE,
  isEditorOwnedLink,
} from '@/lib/content'
import { BRAND_KINDS, BRAND_MEDIA_PURPOSES } from '@/lib/brand'

/** The only columns a placement rule may write. Presence, order, slot: never content. */
const PLACEMENT_COLUMNS = new Set(['on_site', 'sort_order', 'site_role'])

describe('EDITOR_RESTORE — placement rules never touch content', () => {
  const placement = EDITOR_RESTORE.filter((r) => r.mode === 'placement')

  it('there are placement rules at all (a vacuous pass would read as safety)', () => {
    expect(placement.length).toBeGreaterThan(0)
  })

  it('CRITICAL: every placement rule writes only on_site / sort_order / site_role', () => {
    for (const r of placement) {
      for (const c of r.columns) expect(PLACEMENT_COLUMNS.has(c), `${r.type}.${c}`).toBe(true)
      for (const c of Object.keys(r.offSite ?? {})) expect(PLACEMENT_COLUMNS.has(c), `${r.type} offSite.${c}`).toBe(true)
    }
  })

  it('CRITICAL: taking a row off the site means on_site=false or site_role=null — never anything else', () => {
    for (const r of placement) {
      expect(r.offSite, `${r.type} needs an off-site patch`).toBeTruthy()
      for (const [c, v] of Object.entries(r.offSite ?? {})) {
        if (c === 'on_site') expect(v).toBe(false)
        if (c === 'site_role') expect(v).toBeNull()
      }
    }
  })

  it('CRITICAL: a connection’s URL and label are never in reach (they are edited in Connections)', () => {
    const connection = EDITOR_RESTORE.find(
      (r) => r.type === 'link' && r.mode === 'placement',
    )
    expect(connection, 'connections must have their own placement rule').toBeTruthy()
    expect(connection!.columns).not.toContain('url')
    expect(connection!.columns).not.toContain('label')
    // …and it decides by the row: an ordinary profile link is the connection's.
    const row = { label: 'Threads', url: 'https://www.threads.com/@x', role: null }
    expect(connection!.owns?.(row, undefined)).toBe(true)
  })
})

describe('EDITOR_RESTORE — every column it reads is one the log carries', () => {
  it('CRITICAL: each rule’s columns are in that type’s published snapshot', () => {
    // A column the snapshot does not carry would be "restored" to null on every row.
    for (const r of EDITOR_RESTORE) {
      const snap: readonly string[] = PUBLISHABLE[r.type].snapshot
      for (const c of r.columns) expect(snap, `${r.type}.${c}`).toContain(c)
    }
  })

  it('CRITICAL: the profile columns Revert restores are published profile columns', () => {
    for (const c of EDITOR_PROFILE_COLUMNS) expect(ARTIST_SNAPSHOT).toContain(c)
    // The three the editor edits (Text: name, bio; Images: hero), and only those. The
    // press kit, template and ids are other pages' — a site Revert must not reach them.
    expect([...EDITOR_PROFILE_COLUMNS].sort()).toEqual(['bio', 'hero_image_url', 'name'])
  })
})

describe('EDITOR_RESTORE — Brand is not in reach (Sam: "No brand revert for now")', () => {
  it('CRITICAL: no brand-only kind is restored by the editor', () => {
    const reach = new Set<string>(EDITOR_RESTORE.map((r) => r.type))
    for (const k of BRAND_KINDS) if (k !== 'media') expect(reach.has(k), k).toBe(false)
  })

  it('CRITICAL: no media rule owns a brand purpose (a logo, an icon)', () => {
    // Derived from the Brand page's own list, so a purpose added there is covered here.
    const media = EDITOR_RESTORE.filter((r) => r.type === 'media')
    expect(media.length).toBeGreaterThan(0)
    for (const r of media)
      for (const purpose of BRAND_MEDIA_PURPOSES) {
        const row = { purpose, storage_path: 'x' }
        expect(r.owns?.(row, undefined) ?? true, `${purpose}`).toBe(false)
        expect(r.owns?.(undefined, row) ?? true, `${purpose} (snapshot side)`).toBe(false)
      }
  })
})

describe('isEditorOwnedLink — whose links row is it?', () => {
  it('a role-bound button is the editor’s', () => {
    expect(isEditorOwnedLink({ role: 'usb', url: 'https://x.example' })).toBe(true)
  })
  it('a contact row (mailto:, tel:, a bare email) is the editor’s', () => {
    expect(isEditorOwnedLink({ role: null, url: 'mailto:book@x.example' })).toBe(true)
    expect(isEditorOwnedLink({ role: null, url: 'tel:+15125550100' })).toBe(true)
    expect(isEditorOwnedLink({ role: null, url: 'book@x.example' })).toBe(true)
  })
  it('CRITICAL: a profile link is NOT — it is a connection’s', () => {
    expect(isEditorOwnedLink({ role: null, url: 'https://www.threads.com/@x' })).toBe(false)
    expect(isEditorOwnedLink({ url: 'https://instagram.com/x' })).toBe(false)
  })
  it('nothing at all is not the editor’s', () => {
    expect(isEditorOwnedLink(undefined)).toBe(false)
  })
})
