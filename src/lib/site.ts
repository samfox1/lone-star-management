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
  /** Apple/iTunes store link (union model) — can't be rebuilt from apple_id, so
   *  it's stored and threaded to the public link chain. */
  apple_url: string | null
  /** Whether this track has gated hosted audio. The raw path never leaves the
   *  server; the player streams it via the signed-URL route (slug + track id). */
  has_audio: boolean
  /** Collaborators (primary artist excluded), from Spotify sync. May be absent
   *  on revisions published before the feature — render with `?? []`. */
  featured_artists: string[]
  /** The release the track belongs to, from Spotify sync. May be absent on older
   *  revisions — render with `?? null`. */
  album_name: string | null
  /** The release this track is assigned to (umbrella membership), or null. */
  release_id: string | null
  sort_order: number
  /** Provenance (who created the row + which platforms carry it). Rides the
   *  snapshot for the doors' Released/Unreleased gate; public-safe (the ids are
   *  platform-URL components). Absent on revisions published before the union
   *  model — render with `?? null`. */
  source: string | null
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
  /** SoundCloud link (union model — stored, no id column). */
  soundcloud_url: string | null
  /** The manual "this song is released" flag (public even with no platform link). */
  released: boolean | null
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

export type SiteVideo = {
  id: string
  title: string
  provider: 'youtube' | 'soundcloud' | 'uploaded'
  /** Set for embeds (youtube/soundcloud); null for an uploaded (self-hosted) video. */
  embed_url: string | null
  /** Set for uploaded videos (path in the public `videos` bucket); null for embeds. */
  storage_path: string | null
  is_short?: boolean
  sort_order: number
}

export type SiteMedia = {
  purpose: 'hero_video' | 'profile_photo' | 'gallery_image'
  url: string
}

/** Editable site text as key → override value (published or working). Absent
 *  keys fall back to the template default (see lib/site-content-schema). */
export type SiteContent = Record<string, string>

/** Per-region class-name overrides as region_key → class string (published or
 *  working). Section regions use a plain key (e.g. 'hero_wordmark'); per-item
 *  regions use '<slot>:<itemId>'. Absent/empty keys fall back to the region's
 *  base classes (see SITE_STYLING_PLAN.md). */
export type SiteStyles = Record<string, string>

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
  videos: SiteVideo[]
  media: SiteMedia[]
  site_content: SiteContent
  styles: SiteStyles
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
  { onSiteOnly = false }: { onSiteOnly?: boolean } = {},
): Promise<T[]> {
  const rows = await listContent(supabase, type, artistId)
  // Visible-gated types (tour_date/merch/video) are hidden from the public door
  // when visible=false; drop them here too so preview matches the live site.
  const kept = onSiteOnly ? rows.filter((r) => r.visible !== false) : rows
  return kept.map((r) => publicSnapshot(type, r)) as T[]
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

  const [tracks, tour_dates, merch, links, videos, mediaRows, contentRows, styleRows] = await Promise.all([
    // Tracks mirror get_public_site: expose has_audio (never the raw audio_path)
    // and show ON-SITE tracks only — gated by the per-track `visible` flag, the
    // same rule the door now uses (Released is a library-only label — see
    // 20260710170000). So preview matches the live site.
    listContent(supabase, 'track', artistId).then((rows) =>
      rows
        .filter((r) => r.visible !== false)
        .map((r) => {
          const s = publicSnapshot('track', r) as Record<string, unknown>
          return {
            id: s.id as string,
            title: s.title as string,
            cover_url: (s.cover_url as string | null) ?? null,
            stream_url: (s.stream_url as string | null) ?? null,
            provider_url: (s.provider_url as string | null) ?? null,
            apple_url: (s.apple_url as string | null) ?? null,
            has_audio: s.audio_path != null,
            featured_artists: (s.featured_artists as string[] | null) ?? [],
            album_name: (s.album_name as string | null) ?? null,
            release_id: (s.release_id as string | null) ?? null,
            sort_order: (s.sort_order as number) ?? 0,
            source: (s.source as string | null) ?? null,
            spotify_id: (s.spotify_id as string | null) ?? null,
            apple_id: (s.apple_id as string | null) ?? null,
            deezer_id: (s.deezer_id as string | null) ?? null,
            soundcloud_url: (s.soundcloud_url as string | null) ?? null,
            released: (s.released as boolean | null) ?? false,
          } satisfies SiteTrack
        }),
    ),
    workingSection<SiteTourDate>(supabase, 'tour_date', artistId, { onSiteOnly: true }),
    workingSection<SiteMerch>(supabase, 'merch', artistId, { onSiteOnly: true }),
    workingSection<SiteLink>(supabase, 'link', artistId),
    workingSection<SiteVideo>(supabase, 'video', artistId, { onSiteOnly: true }),
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
    supabase
      .from('site_styles')
      .select('region_key, class_names')
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

  // Same region_key→class_names shape get_public_site's jsonb_object_agg produces
  // (empty/cleared class strings are dropped), so preview matches the public site.
  const styles = Object.fromEntries(
    (styleRows as { region_key: string; class_names: string | null }[])
      .filter((r) => r.class_names != null && r.class_names !== '')
      .map((r) => [r.region_key, r.class_names as string]),
  )

  return { artist, tracks, tour_dates, merch, links, videos, media, site_content, styles }
}
