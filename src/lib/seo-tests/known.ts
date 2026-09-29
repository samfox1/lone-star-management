/**
 * WHAT TAPIR KNOWS about an artist, for the SEO / GEO tests to compare the live site against
 * (`SeoKnown`, types.ts).
 *
 * `published` comes from the PUBLIC DOOR — the same `get_public_site` / `get_public_releases`
 * calls a connected site makes — never from the working (draft) rows. A draft is not supposed to
 * be on the site yet, so comparing the site to it would fail a site that is exactly right.
 *
 * `siteUrl` is the artist's CUSTOM site, judged by the same rules as everywhere else: `isCustom`
 * (a custom site with a usable address) AND `isPublicSiteUrl` WITHOUT the loopback hatch, because
 * this server fetches it (the SSRF rule in lib/custom-site). A template site, a localhost dev
 * site or a private address is "no site connected": every test is `unknown`, nothing is fetched.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublicSitePayload, SiteRelease } from '@samfox1/site-bridge/payload'
import { resolveSeo, siteFacts } from '@samfox1/site-bridge/seo'
import { isCustom, isPublicSiteUrl } from '@/lib/custom-site'
import { mediaUrl } from '@/lib/storage-url'
import type { SeoKnown } from './types'

type SiteRow = { site_kind?: string | null; custom_site_url?: string | null }

/** The origin the tests may fetch for this artist, or null. */
export function seoSiteOrigin(row: SiteRow | null | undefined): string | null {
  if (!row || !isCustom(row) || typeof row.custom_site_url !== 'string') return null
  const raw = row.custom_site_url.trim()
  if (!isPublicSiteUrl(raw)) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/** Only these are PHOTOS a person sees on the site. Logos, icons and video are not. */
const PHOTO_PURPOSES = new Set(['profile_photo', 'gallery_image'])

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/** The shape the bridge accepts before it writes `open.spotify.com/artist/<id>` into the fact
 *  card (`sameAsFrom`). known.test.ts checks this against `sameAsFrom` itself. */
const SPOTIFY_ID = /^[A-Za-z0-9]+$/

/**
 * The door's payload as `SeoKnown.published`. Pure. Title, description and share image are what
 * a bridge site computes from this same payload (`resolveSeo`: the manager's override, else the
 * artist's own data, else an honest default), so a test compares the page to what it SHOULD say.
 */
export function publishedFromPayload(site: PublicSitePayload, releases: readonly SiteRelease[]): NonNullable<SeoKnown['published']> {
  const seo = resolveSeo(site)
  // The Facts as the fact card reads them (`siteFacts`: every rule re-applied), from the same
  // published payload, so a test compares the card to what it SHOULD state.
  const facts = siteFacts(site)
  const spotify = typeof site.artist?.spotify_artist_id === 'string' ? site.artist.spotify_artist_id : ''
  const links: NonNullable<SeoKnown['published']>['links'] = []
  const seen = new Set<string>()
  for (const l of site.links ?? []) {
    if (typeof l?.url !== 'string' || l.url === '') continue
    seen.add(l.url)
    links.push({ label: text(l.label), url: l.url, onSite: true })
  }
  // Identity links ride the fact card whether or not they are buttons; a button is listed once.
  for (const l of site.identity_links ?? []) {
    if (typeof l?.url !== 'string' || l.url === '' || seen.has(l.url)) continue
    seen.add(l.url)
    links.push({ label: text(l.label), url: l.url, onSite: false })
  }
  return {
    bio: text(site.artist?.bio),
    genre: text(site.artist?.genre),
    location: text(site.artist?.location),
    seoTitle: text(seo.title),
    seoDescription: text(seo.description),
    ogImage: text(seo.ogImage),
    links,
    // `isPast` is the manager's "already played" flag, not date math: a test compares `date` to
    // `today` itself, so the two can disagree and the test can say so.
    tourDates: (site.tour_dates ?? []).map((t) => ({ date: text(t.date), venue: text(t.venue), city: text(t.city), isPast: t.is_past === true })),
    releases: releases.filter((r) => typeof r?.title === 'string').map((r) => ({ title: r.title, releasedOn: text(r.release_date) })),
    photos: (site.media ?? [])
      .filter((m) => PHOTO_PURPOSES.has(m.purpose) && typeof m.path === 'string' && m.path !== '')
      .map((m) => ({ url: mediaUrl(m.path), alt: text(m.alt) })),
    publishedAt: text(site.published_at),
    region: text(facts.region),
    country: text(facts.country),
    countryCode: facts.countryCode,
    // The bridge's rule (`artistNode`): Person only when it says Person; else a musician.
    artistType: site.artist?.schema_type === 'Person' ? 'Person' : 'MusicGroup',
    spotifyArtistId: SPOTIFY_ID.test(spotify) ? spotify : null,
  }
}

export type ReadKnownOptions = { now?: number }

/**
 * Read what Tapir knows. Throws when the artist cannot be read or the door errors: a run that
 * cannot read its own side must fail loudly, not compare the site against nothing.
 */
export async function readKnown(supabase: SupabaseClient, artistId: string, opts: ReadKnownOptions = {}): Promise<SeoKnown> {
  const today = new Date(opts.now ?? Date.now()).toISOString().slice(0, 10)
  const { data: artist, error } = await supabase
    .from('artists')
    .select('slug, name, site_kind, custom_site_url')
    .eq('id', artistId)
    .maybeSingle()
  if (error) throw new Error(`artists: ${error.message}`)
  if (!artist) throw new Error('Artist not found.')
  const row = artist as { slug?: string | null; name?: string | null } & SiteRow
  const siteUrl = seoSiteOrigin(row)
  const slug = typeof row.slug === 'string' ? row.slug : ''

  const [site, releases] = await Promise.all([
    supabase.rpc('get_public_site', { p_slug: slug }),
    supabase.rpc('get_public_releases', { p_slug: slug }),
  ])
  if (site.error) throw new Error(`get_public_site: ${site.error.message}`)
  if (releases.error) throw new Error(`get_public_releases: ${releases.error.message}`)
  const payload = (site.data ?? null) as PublicSitePayload | null
  // No revision at all = nothing published: `published_at` is max(revisions.published_at).
  const published = payload && payload.published_at ? publishedFromPayload(payload, Array.isArray(releases.data) ? (releases.data as SiteRelease[]) : []) : null

  return {
    artistName: text(payload?.artist?.name) ?? text(row.name) ?? '',
    siteUrl,
    today,
    published,
  }
}
