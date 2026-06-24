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
import { type EntityType, listContent, publicSnapshot } from '@/lib/content'

export type SiteTrack = {
  id: string
  title: string
  cover_url: string | null
  stream_url: string | null
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

export type SiteData = {
  artist: {
    id: string
    slug: string
    name: string
    bio: string | null
    hero_image_url: string | null
  }
  tracks: SiteTrack[]
  tour_dates: SiteTourDate[]
  merch: SiteMerch[]
  links: SiteLink[]
}

/** Published site for a slug, via the public read path. null if no such artist. */
export async function getPublishedSite(
  supabase: SupabaseClient,
  slug: string,
): Promise<SiteData | null> {
  const { data, error } = await supabase.rpc('get_public_site', { p_slug: slug })
  if (error) throw new Error(error.message)
  return (data as SiteData | null) ?? null
}

async function workingSection<T>(
  supabase: SupabaseClient,
  type: EntityType,
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
    .select('id, slug, name, bio, hero_image_url')
    .eq('id', artistId)
    .single()
  if (!artist) return null

  const [tracks, tour_dates, merch, links] = await Promise.all([
    workingSection<SiteTrack>(supabase, 'track', artistId),
    workingSection<SiteTourDate>(supabase, 'tour_date', artistId),
    workingSection<SiteMerch>(supabase, 'merch', artistId),
    workingSection<SiteLink>(supabase, 'link', artistId),
  ])

  return { artist, tracks, tour_dates, merch, links }
}
