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
import { listTracks } from '@/lib/tracks'

export type SiteTrack = {
  id: string
  title: string
  cover_url: string | null
  stream_url: string | null
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
  tour_dates: unknown[]
  merch: unknown[]
  links: unknown[]
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

/**
 * Working (unpublished) site for an artist, assembled from live rows. RLS scopes
 * the read to the caller's tenant, so a non-owner gets null. Same shape as the
 * published site so the same template renders both.
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

  const tracks = await listTracks(supabase, artistId)

  return {
    artist,
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.title,
      cover_url: t.cover_url,
      stream_url: t.stream_url,
      sort_order: t.sort_order,
    })),
    tour_dates: [],
    merch: [],
    links: [],
  }
}
