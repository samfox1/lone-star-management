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
import { ARTIST_SNAPSHOT, type PublishableEntity, listContent, publicSnapshot } from '@/lib/content'
import { FONT_SLOTS, type FontSlot, type FontSlotMap } from '@/lib/fonts'
import { mediaUrl } from '@/lib/storage-url'

/**
 * The wire types MOVED to `@samfox1/site-bridge` (SITE_BRIDGE_PLAN.md phase 1) — the
 * payload is the contract a connected site imports rather than mirrors. Re-exported
 * here because this is where the app's importers have always found them. `SiteData`
 * below now DERIVES from the wire type (media paths swapped for resolved URLs), so the
 * two can never drift: the package is the single source.
 */
export type {
  SiteTrack,
  SiteTourDate,
  SiteMerch,
  SiteLink,
  SiteVideo,
  MediaPurpose,
  SiteContent,
  SiteStyles,
} from '@samfox1/site-bridge/payload'
// Imported AGAIN for local use: `export type ... from` re-exports without binding names
// in this module's scope, and the query builders below reference them directly.
import type {
  MediaPurpose,
  PublicSitePayload,
  SiteTrack,
  SiteTourDate,
  SiteMerch,
  SiteLink,
  SiteVideo,
  SiteContent,
  SiteStyles,
} from '@samfox1/site-bridge/payload'

export type SiteMedia = {
  purpose: MediaPurpose
  url: string
}

// The URL builders live in lib/storage-url (a leaf module) so light modules like
// site-editor/save can share them without pulling in this server-heavy builder;
// re-exported here because this is where consumers historically found them.
export { mediaUrl, mediaThumbUrl } from '@/lib/storage-url'

/**
 * The RENDER-side shape: the wire payload with media paths resolved to URLs (built with
 * lone-star's own NEXT_PUBLIC_SUPABASE_URL, for rendering a built-in template). Derived
 * from `PublicSitePayload` — the package owns the contract; this is the one divergence.
 */
export type SiteData = Omit<PublicSitePayload, 'media'> & {
  media: SiteMedia[]
}

/** The WIRE shape — what `get_public_site` returns and `init-data` carries. Owned by
 *  `@samfox1/site-bridge` now; re-exported from this module's historical home. */
export type { PublicSitePayload } from '@samfox1/site-bridge/payload'

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
  // Revisions published before 20260805160000 have no fonts key, and any published before
  // 20260805200000 has no font_slots key; a legacy payload must render, not crash the
  // whole site over a feature it predates.
  return { ...site, media: toSiteMedia(site.media), fonts: site.fonts ?? [], font_slots: site.font_slots ?? {} }
}

async function workingSection<T>(
  supabase: SupabaseClient,
  type: PublishableEntity,
  artistId: string,
  { onSiteOnly = false }: { onSiteOnly?: boolean } = {},
): Promise<T[]> {
  const rows = await listContent(supabase, type, artistId)
  // On-site-gated types (tour_date/merch/video) are hidden from the public door
  // when on_site=false; drop them here too so preview matches the live site.
  const kept = onSiteOnly ? rows.filter((r) => r.on_site !== false) : rows
  return kept.map((r) => publicSnapshot(type, r)) as T[]
}

/**
 * Working (unpublished) site for an artist in the WIRE shape (media as raw
 * `path`), assembled from live rows through the SAME public-safe projection as a
 * published snapshot, so preview matches the public site exactly. RLS scopes the
 * read, so a non-owner gets null.
 *
 * This is the single builder: `getWorkingSite` wraps it and resolves media URLs
 * for lone-star's own rendering; the editor posts this shape verbatim to a custom
 * site over `init-data`. One code path, so the two can't drift.
 */
export async function getWorkingSitePayload(
  supabase: SupabaseClient,
  artistId: string,
): Promise<PublicSitePayload | null> {
  // The artist row and every section are independent, so fetch them in ONE wave — the
  // artist row used to serially gate the other eight for no reason (a full round-trip
  // before any section query started). A missing artist just discards the rest below.
  const [{ data: artist }, tracks, tour_dates, merch, links, videos, mediaRows, contentRows, styleRows, fontRows] =
    await Promise.all([
      supabase
        .from('artists')
        // Derived from ARTIST_SNAPSHOT rather than listed by hand: the public door
        // serves exactly the snapshotted columns, so a hardcoded list here silently
        // drifts the moment a column joins the snapshot, and preview stops matching
        // live. (It did: press_pitch/press_quotes were published but missing from the
        // preview until the parity test caught it.) id + slug are identity, not
        // snapshot — get_public_site adds them back the same way.
        .select(['id', 'slug', ...ARTIST_SNAPSHOT].join(', '))
        .eq('id', artistId)
        .single(),
    // Tracks mirror get_public_site: expose has_audio (never the raw audio_path)
    // and show ON-SITE tracks only — gated by the per-track `on_site` flag, the
    // same rule the door now uses (Released is a library-only label — see
    // 20260710170000). So preview matches the live site.
    listContent(supabase, 'track', artistId).then((rows) =>
      rows
        .filter((r) => r.on_site !== false)
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
            // A song's OWN date (20260821, snapshotted from this release onward). Only
            // meaningful for a standalone — one on a record is dated by the record.
            release_date: (s.release_date as string | null) ?? null,
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
      .select('id, purpose, storage_path, sort_order, on_site, orientation, site_role, label')
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
    supabase
      .from('artist_fonts_with_slots') // the VIEW: the font plus the slots it fills
      .select('family, label, storage_path, format, slots')
      .eq('artist_id', artistId)
      .order('family') // matches get_public_site's fonts order
      .then(({ data }) => data ?? []),
  ])
  if (!artist) return null

  // Mirror get_public_site's media gate EXACTLY: the on-site flag applies to
  // gallery_image only — hero_video / profile_photo are not per-item curated and
  // must never be filtered, or a site loses its hero. Without this the preview
  // showed off-site gallery photos the live site hides (the parity test's fixture
  // used a profile_photo, which the gate ignores, so the drift went uncaught).
  const media = (
    mediaRows as {
      purpose: SiteMedia['purpose']
      storage_path: string
      on_site: boolean | null
      orientation?: 'horizontal' | 'vertical' | null
      site_role?: string | null
    }[]
  )
    .filter((m) => m.purpose !== 'gallery_image' || m.on_site !== false)
    .map((m) => ({
      id: (m as { id?: string }).id ?? null,
      purpose: m.purpose,
      path: m.storage_path,
      orientation: m.orientation ?? null,
      site_role: m.site_role ?? null,
      label: (m as { label?: string | null }).label ?? null,
    }))

  // Same key→value shape get_public_site's jsonb_object_agg produces, so preview
  // matches the public site. Null values (cleared overrides) are dropped.
  const site_content = Object.fromEntries(
    (contentRows as { key: string; value: string | null }[])
      .filter((r) => r.value != null)
      .map((r) => [r.key, r.value as string]),
  )

  // Invert the fonts' slot lists into the door's slot→family map. Built from the same
  // rows the `fonts` array comes from, so a slot can never name a font the preview does
  // not also carry — the same property the published side gets from riding the snapshot.
  const fontRowList = fontRows as {
    family: string
    label: string
    storage_path: string
    format: string
    slots: string[] | null
  }[]
  const font_slots: FontSlotMap = {}
  for (const slot of FONT_SLOTS) {
    const owner = fontRowList.find((f) => (f.slots ?? []).includes(slot))
    if (owner) font_slots[slot as FontSlot] = owner.family
  }

  // Same region_key→class_names shape get_public_site's jsonb_object_agg produces
  // (empty/cleared class strings are dropped), so preview matches the public site.
  const styles = Object.fromEntries(
    (styleRows as { region_key: string; class_names: string | null }[])
      .filter((r) => r.class_names != null && r.class_names !== '')
      .map((r) => [r.region_key, r.class_names as string]),
  )

  // The select list is built at runtime from ARTIST_SNAPSHOT, so supabase-js can't infer
  // the row type from a literal the way it does elsewhere. Same cast publishProfile uses
  // for the same reason; the shape is guaranteed by the select, not by the cast.
  return {
    artist: artist as unknown as PublicSitePayload['artist'],
    tracks,
    tour_dates,
    merch,
    links,
    videos,
    media,
    site_content,
    styles,
    // Same field names the door's fonts array carries (path, not storage_path), so
    // preview and the custom-site bridge see the published shape.
    fonts: fontRowList.map((f) => ({
      family: f.family,
      label: f.label,
      path: f.storage_path,
      format: f.format,
    })),
    // Mirrors the door's font_slots: slot → family, assigned slots only, built by
    // inverting each font's own slot list. Iterated in FONT_SLOTS order so the preview
    // payload is byte-stable, exactly like the door's ordered aggregate.
    font_slots: font_slots,
  }
}

/**
 * Working (unpublished) site for lone-star's OWN rendering (preview + the
 * built-in edit-frame): the wire payload with media paths resolved to public
 * URLs. A custom site must NOT use this — it needs the raw paths so it can
 * resolve them against its own Supabase URL (see `getWorkingSitePayload`).
 */
export async function getWorkingSite(
  supabase: SupabaseClient,
  artistId: string,
): Promise<SiteData | null> {
  const payload = await getWorkingSitePayload(supabase, artistId)
  return payload && { ...payload, media: toSiteMedia(payload.media) }
}
