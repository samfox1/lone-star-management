// The Site / SEO bar and the Brand bar each light for what their own Publish ships.
/**
 * Media is split between two Publish buttons (2026-09-28): the Site / SEO Publish ships the
 * site's photos (`SITE_MEDIA_SLICE`), the Brand bar the logos and icons. A bar that lights
 * for the other button's half can never be cleared from its own page: press Publish, and it
 * stays up. So each bar must count exactly its own half.
 *
 * One fake world per case (no database), read by all three readers at once: the SEO bar
 * (`siteUnpublished` over `diffUnpublished`), the nav dots (`dirtyBySeg`) and the Brand bar
 * (`brandPending`). Everything is published and unchanged — the profile included — apart
 * from the media each case plants.
 */
import { describe, expect, it } from 'vitest'
import { diffUnpublished, publicSnapshot, siteUnpublished, type ContentRow } from '@/lib/content'
import { brandPending } from '@/lib/brand'
import { dirtyBySeg } from '@/app/artists/[id]/(dashboard)/sections'
import { fakeClient, type Call } from '@tests/helpers/fake-client'

const A = 'a1'

const media = (id: string, purpose: string): ContentRow => ({
  id,
  artist_id: A,
  purpose,
  storage_path: `${A}/x/${id}.png`,
  sort_order: 1,
  created_at: '2026-09-01T00:00:00+00:00',
  on_site: true,
  orientation: null,
  site_role: null,
  label: null,
  collection: null,
  alt: null,
  kind: 'photo',
})
const published = (row: ContentRow) => ({ entity_type: 'media', entity_id: row.id, data: publicSnapshot('media', row) })

/** `working`: the media rows now. `live`: media published before them. */
function world({ working = [], live = [] }: { working?: ContentRow[]; live?: ContentRow[] }) {
  const profile = { entity_type: 'artist', entity_id: A, data: {} } // published, and the same as now
  return fakeClient((c: Call) => {
    if (c.op === 'rpc') return { data: [profile, ...live.map(published)] }
    if (c.table === 'media') return { data: working, count: working.length }
    if (c.table === 'artists' && c.terminal === 'single') return { data: {} } // the profile row
    if (c.table === 'artists') return { data: null } // the browser bar, the icon sources
    return { data: [], count: 0 }
  }).client
}

async function bars(client: ReturnType<typeof world>) {
  const diff = await diffUnpublished(client, A)
  const dots = dirtyBySeg(diff)
  return {
    seo: siteUnpublished(diff),
    brand: (await brandPending(client, A)).dirty,
    siteDot: dots.site,
    brandDot: dots.brand,
    whole: diff.media.dirty,
  }
}

describe('each bar lights for its own Publish', () => {
  it('CRITICAL: a draft Brand logo lights the Brand bar, NOT the SEO bar', async () => {
    expect(await bars(world({ working: [media('logo-1', 'logo_primary')] }))).toEqual({
      seo: false,
      brand: true,
      siteDot: false,
      brandDot: true,
      // The dashboard's Publish (publishAll) ships every media row, so it still counts it.
      whole: true,
    })
  })

  it('CRITICAL: a draft site photo lights the SEO bar, NOT the Brand bar', async () => {
    expect(await bars(world({ working: [media('photo-1', 'gallery_image')] }))).toEqual({
      seo: true,
      brand: false,
      siteDot: true,
      brandDot: false,
      whole: true,
    })
  })

  it('a published logo deleted in draft is Brand’s change too, judged by its published copy', async () => {
    expect(await bars(world({ live: [media('logo-1', 'logo')] }))).toEqual({
      seo: false,
      brand: true,
      siteDot: false,
      brandDot: true,
      whole: true,
    })
  })

  it('the witness: nothing changed lights nothing', async () => {
    const photo = media('photo-1', 'gallery_image')
    expect(await bars(world({ working: [photo], live: [photo] }))).toEqual({
      seo: false,
      brand: false,
      siteDot: false,
      brandDot: false,
      whole: false,
    })
  })
})
