// What each icon is framed from, and what the "Select a logo…" menu lists.
/**
 * `iconLogoOptions` / `resolveIconSource` (brand/icons/icon-sources.ts): pure over the
 * Brand page's reads. `artists.<target>_source_media_id` is null for "the primary logo"
 * (BRAND_PAGE_PLAN.md, data model), may name any logo, or an image uploaded just for that
 * icon (`icon_source`, which the menu never lists — it is not a logo).
 */
import { describe, expect, it } from 'vitest'
import type { BrandLogo, BrandLogos } from '@/lib/brand'
import { iconLogoOptions, resolveIconSource } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/icons/icon-sources'

const logo = (id: string, purpose: BrandLogo['purpose'], label: string | null = null): BrandLogo => ({
  id,
  purpose,
  label,
  note: null,
  storagePath: `a1/brand/${id}.png`,
  sourcePath: null,
  sortOrder: 0,
})

const LOGOS: BrandLogos = {
  primary: logo('p', 'logo_primary'),
  secondary: logo('s', 'logo_secondary'),
  added: [logo('t', 'logo', 'Tour logo'), logo('m', 'logo', 'Monogram')],
}
const UPLOADS = [{ id: 'u1', storagePath: 'a1/brand/u1.png' }]

describe('iconLogoOptions', () => {
  it('lists Primary, Secondary, then every added logo by its title, in order', () => {
    expect(iconLogoOptions(LOGOS).map((o) => [o.id, o.label])).toEqual([
      ['p', 'Primary logo'],
      ['s', 'Secondary logo'],
      ['t', 'Tour logo'],
      ['m', 'Monogram'],
    ])
  })

  it('leaves out a built-in with no file — either one', () => {
    expect(iconLogoOptions({ primary: null, secondary: LOGOS.secondary, added: [] }).map((o) => o.id)).toEqual(['s'])
    expect(iconLogoOptions({ primary: LOGOS.primary, secondary: null, added: [] }).map((o) => o.id)).toEqual(['p'])
  })

  it('an added logo with no title is offered as "Logo", never a blank line', () => {
    expect(iconLogoOptions({ primary: null, secondary: null, added: [logo('x', 'logo', '')] })[0].label).toBe('Logo')
  })

  it('carries each logo\'s storage path', () => {
    expect(iconLogoOptions(LOGOS)[2].path).toBe('a1/brand/t.png')
  })
})

describe('resolveIconSource', () => {
  it('null means the primary logo', () => {
    expect(resolveIconSource(null, LOGOS, UPLOADS)).toEqual({ id: 'p', path: 'a1/brand/p.png', kind: 'logo' })
  })

  it('null with no primary logo is no source at all', () => {
    expect(resolveIconSource(null, { ...LOGOS, primary: null }, UPLOADS)).toEqual({ id: null, path: null, kind: 'none' })
  })

  it('an added logo resolves to that logo', () => {
    expect(resolveIconSource('m', LOGOS, UPLOADS)).toEqual({ id: 'm', path: 'a1/brand/m.png', kind: 'logo' })
  })

  it('an uploaded icon image resolves as an upload, not a logo', () => {
    expect(resolveIconSource('u1', LOGOS, UPLOADS)).toEqual({ id: 'u1', path: 'a1/brand/u1.png', kind: 'upload' })
  })

  it('an id that matches nothing falls back to the primary logo (what the FK does on delete)', () => {
    expect(resolveIconSource('gone', LOGOS, UPLOADS)).toEqual({ id: 'p', path: 'a1/brand/p.png', kind: 'logo' })
  })
})
