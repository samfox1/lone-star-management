/**
 * An empty published site: the shape `get_public_site` sends (the wire payload) and the shape a
 * built-in template renders (SiteData), with every list empty and every map blank. A test
 * overrides only what it is about.
 *
 * Code:     support file (not a test): typed against PublicSitePayload (@samfox1/site-bridge/payload)
 *           and SiteData (src/lib/site.ts)
 * Feature:  every test that hands code a published site: EPK, SEO builders, the site editor's
 *           frame, built-in templates
 * Tier:     STRICT (AGENTS.md "Test depth"): the shells are typed by the real payload types, so a
 *           required field added to the wire is ONE compile error here, not fifteen hand-built
 *           copies that each need the field (rule 4: derive, never hand-list).
 * What it provides:
 *           • sitePayload(over): the wire payload (media as storage paths)
 *           • siteData(over): the render shape (media as urls)
 *           • `over.artist` is merged INTO the default artist, so a test names only the artist
 *             fields it is about; every other key replaces the empty default
 * Not here: realistic, filled-in fixtures (tests/helpers/seo-jsonld-cases.ts pins the fact
 *           sheet's byte-for-byte output; tests/unit/site-editor/site-bridge-seo.test.ts keeps its
 *           own rich site).
 * Fixtures: the artist "Skeen" (id a1, a custom site), nothing published. Fresh arrays on every
 *           call, so one test's push never leaks into another's.
 */
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import type { SiteData } from '@/lib/site'

type Artist = PublicSitePayload['artist']
type Over<T> = Partial<Omit<T, 'artist'>> & { artist?: Partial<Artist> }

/** Every REQUIRED artist field, blank. Optional ones (genre, press fields…) stay absent. */
const artist = (): Artist => ({
  id: 'a1',
  slug: 'skeen',
  name: 'Skeen',
  bio: null,
  hero_image_url: null,
  template: 'custom',
  spotify_artist_id: null,
})

/** Every REQUIRED top-level field but `artist` and `media`, empty. Optional keys (brand,
 *  identity_links, published_at…) stay absent, as on the oldest door that still renders. */
const lists = () =>
  ({
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [],
    videos: [],
    site_content: {},
    styles: {},
    fonts: [],
    font_slots: {},
  }) satisfies Omit<PublicSitePayload, 'artist' | 'media'> & Omit<SiteData, 'artist' | 'media'>

/** The wire payload, nothing published. */
export function sitePayload({ artist: a, ...over }: Over<PublicSitePayload> = {}): PublicSitePayload {
  return { ...lists(), media: [], ...over, artist: { ...artist(), ...a } }
}

/** The render shape (SiteData: media resolved to urls), nothing published. */
export function siteData({ artist: a, ...over }: Over<SiteData> = {}): SiteData {
  return { ...lists(), media: [], ...over, artist: { ...artist(), ...a } }
}
