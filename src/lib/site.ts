/**
 * Site data assembly — the shape both the public site and the manager preview
 * render. One template, two data sources:
 *
 *   getPublishedSite(slug)    -> PUBLISHED data (latest revisions, public read
 *                                path). What fans see.
 *   getWorkingSite(artistId)  -> WORKING/draft rows (RLS-scoped). What a manager
 *                                previews before publishing.
 *
 * Keeping one shape means /preview is a true visual preview of /[slug], not a
 * separate mock (PLAN decision #7).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { type PublishableEntity, listContent, publicSnapshot } from '@/lib/content'

export type SiteTrack = {
  id: string
  title: string
  cover_url: string | null
  stream_url: string | null
  /** Link-out URL for sources that don't host audio (e.g. Deezer). */
  provider_url: string | null
  sort_order: number
}

export type SiteTourDate = {
  id: string
  date: string
  venue: string | null
  city: string | null
  country: string | null
  ticket_url: string | null
}

export type SiteMerch = {
  id: string
  title: string
  image_url: string | null
  // Postgres `numeric` serializes as a string over JSON to preserve precision,
  // so price is a string at runtime (both published and working paths).
  price: number | string | null
  url: string | null
}

export type SiteLink = {
  id: string
  label: string
  url: string
  sort_order: number
}

export type SiteMedia = {
  purpose: 'hero_video' | 'profile_photo' | 'gallery_image'
  url: string
}

/** Editable site text as key → override value (published or working). Absent
 *  keys fall back to the template default (see lib/site-content-schema). */
export type SiteContent = Record<string, string>

/** Public URL for an object in the `media` storage bucket. */
export function mediaUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`
}

export type SiteData = {
  artist: {
    id: string
    slug: string
    name: string
    bio: string | null
    hero_image_url: string | null
    template: string
    spotify_artist_id: string | null
  }
  tracks: SiteTrack[]
  tour_dates: SiteTourDate[]
  merch: SiteMerch[]
  links: SiteLink[]
  media: SiteMedia[]
  site_content: SiteContent
}

/** Map the rpc's media ({purpose, path}) to public URLs. */
function toSiteMedia(raw: { purpose: SiteMedia['purpose']; path: string }[]): SiteMedia[] {
  return (raw ?? []).map((m) => ({ purpose: m.purpose, url: mediaUrl(m.path) }))
}

/** Published site for a slug, via the public read path. null if no such artist. */
export async function getPublishedSite(
  supabase: SupabaseClient,
  slug: string,
): Promise<SiteData | null> {
  const { data, error } = await supabase.rpc('get_public_site', { p_slug: slug })
  if (error) throw new Error(error.message)
  if (!data) return null
  const site = data as SiteData & { media: { purpose: SiteMedia['purpose']; path: string }[] }
  return { ...site, media: toSiteMedia(site.media) }
}

async function workingSection<T>(
  supabase: SupabaseClient,
  type: PublishableEntity,
  artistId: string,
): Promise<T[]> {
  const rows = await listContent(supabase, type, artistId)
  return rows.map((r) => publicSnapshot(type, r)) as T[]
}

/**
 * Working (unpublished) site for an artist, assembled from live rows through
 * the SAME public-safe projection as a published snapshot, so preview matches
 * the public site exactly. RLS scopes the read, so a non-owner gets null.
 */
export async function getWorkingSite(
  supabase: SupabaseClient,
  artistId: string,
): Promise<SiteData | null> {
  const { data: artist } = await supabase
    .from('artists')
    .select('id, slug, name, bio, hero_image_url, template, spotify_artist_id')
    .eq('id', artistId)
    .single()
  if (!artist) return null

  const [tracks, tour_dates, merch, links, mediaRows, contentRows] = await Promise.all([
    workingSection<SiteTrack>(supabase, 'track', artistId),
    workingSection<SiteTourDate>(supabase, 'tour_date', artistId),
    workingSection<SiteMerch>(supabase, 'merch', artistId),
    workingSection<SiteLink>(supabase, 'link', artistId),
    supabase
      .from('media')
      .select('purpose, storage_path, sort_order')
      .eq('artist_id', artistId)
      .order('sort_order')
      .order('created_at') // secondary key — matches get_public_site's media order
      .then(({ data }) => data ?? []),
    supabase
      .from('site_content')
      .select('key, value')
      .eq('artist_id', artistId)
      .then(({ data }) => data ?? []),
  ])

  const media = toSiteMedia(
    (mediaRows as { purpose: SiteMedia['purpose']; storage_path: string }[]).map((m) => ({
      purpose: m.purpose,
      path: m.storage_path,
    })),
  )

  // Same key→value shape get_public_site's jsonb_object_agg produces, so preview
  // matches the public site. Null values (cleared overrides) are dropped.
  const site_content = Object.fromEntries(
    (contentRows as { key: string; value: string | null }[])
      .filter((r) => r.value != null)
      .map((r) => [r.key, r.value as string]),
  )

  return { artist, tracks, tour_dates, merch, links, media, site_content }
}
