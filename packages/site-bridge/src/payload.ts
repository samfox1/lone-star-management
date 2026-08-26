/**
 * The WIRE PAYLOAD — exactly what `get_public_site` returns and what the bridge's
 * `init-data` message carries. This is the contract a CUSTOM site speaks: it receives
 * the draft over the bridge and maps the payload itself (skeen's `mapSite`), resolving
 * media `path`s against ITS OWN Supabase URL.
 *
 * DERIVED FROM THE SNAPSHOT LISTS in lone-star's lib/content.ts (the RPC serves
 * `data` wholesale, so those lists ARE the wire), not from any consumer's view — the
 * 2026-08-07 review caught the first cut copying lone-star's internal type, which
 * omitted fields skeen reads (tour support acts, link roles, video site_role).
 * MOVED here from lone-star's `src/lib/site.ts` (SITE_BRIDGE_PLAN.md phase 1) so the
 * type has ONE home: lone-star derives its render-side `SiteData` FROM this type
 * (swapping wire media paths for resolved URLs), and a connected site imports it
 * instead of hand-mirroring it — skeen's `PublicSite` in `lib/backend.ts` was the
 * mirror this move retires.
 *
 * EVOLUTION RULE: additive only. Deployed sites pin old versions of this package
 * forever; a removed or narrowed field here silently blanks regions on every site that
 * still reads it. New fields arrive optional, with the "absent on revisions published
 * before <migration>" comment style the fields below already carry.
 */

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
  /** The song's OWN release date (`YYYY-MM-DD`), or null. Only meaningful for a
   *  STANDALONE song — one on a record is dated by the record, which rides
   *  `get_public_releases`. Added 2026-08-21 so a dated SoundCloud single can sort by
   *  date and wear the NEW badge; ABSENT on every revision published before that, so
   *  always read it with `?? null`. */
  release_date?: string | null
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
  /** Null for an UNDATED show (announced, date TBA) — the wire has carried null since
   *  dates became clearable; undated rows sort last, sequenced by sort_order. */
  date: string | null
  venue: string | null
  city: string | null
  /** Two-letter US state code. Absent on revisions published before the column. */
  state?: string | null
  country: string | null
  ticket_url: string | null
  /** The support acts' NAMES, in bill order (20260717140000). Absent on older
   *  revisions — read with `?? []`. */
  support?: string[] | null
  /** Per-act name → outbound URL (edited in the editor's Links panel). Rides beside
   *  `support` so a site can zip them into linked support acts. */
  support_urls?: Record<string, string> | null
  /** The manager's "already played" flag, distinct from date math. */
  is_past?: boolean | null
  /** Tie-break for UNDATED shows only (20260723120000) — dated shows sort by date. */
  sort_order?: number | null
}

export type SiteMerch = {
  id: string
  title: string
  image_url: string | null
  // Postgres `numeric` serializes as a string over JSON to preserve precision,
  // so price is a string at runtime (both published and working paths).
  price: number | string | null
  url: string | null
  /** Rides the snapshot as the sort key; sites rarely read it. */
  created_at?: string | null
  /** Stock state (20260818130000) — false renders as sold out; the item STAYS on the
   *  site. Absent on revisions published before the column — read with `!== false`. */
  in_stock?: boolean | null
}

export type SiteLink = {
  id: string
  label: string
  url: string
  sort_order: number
  /** Binds this link to a manifest link-region (USB / Merch button) by KEY, so a site
   *  maps it authoritatively instead of by label. Null for ordinary social links;
   *  absent on revisions published before bind-by-key. */
  role?: string | null
}

export type SiteVideo = {
  id: string
  title: string
  provider: 'youtube' | 'soundcloud' | 'uploaded'
  /** Set for embeds (youtube/soundcloud); null for an uploaded (self-hosted) video. */
  embed_url: string | null
  /** Set for uploaded videos (path in the public `videos` bucket); null for embeds. */
  storage_path: string | null
  is_short?: boolean | null
  sort_order: number
  /** Places this video in a named background slot (`hero_landscape` /
   *  `hero_portrait` / `bio_background`), or null for the band/library
   *  (20260716200000). How a site picks its hero clip. */
  site_role?: string | null
}

export type MediaPurpose =
  | 'hero_video'
  | 'profile_photo'
  | 'gallery_image'
  | 'bio_video'
  // Brand (20260804160000). `favicon` is derived from `logo_primary`, not uploaded — see
  // lone-star's lib/brand.ts for why the framing has to be baked into the pixels.
  | 'logo_primary'
  | 'logo_secondary'
  | 'favicon'

/** Editable site text as key → override value (published or working). Absent
 *  keys fall back to the template default. */
export type SiteContent = Record<string, string>

/** Per-region class-name overrides as region_key → class string (published or
 *  working). Section regions use a plain key (e.g. 'hero_wordmark'); per-item
 *  regions use '<slot>:<itemId>'. Absent/empty keys fall back to the region's
 *  base classes (SITE_STYLING_PLAN.md). */
export type SiteStyles = Record<string, string>

/** One published custom font: the sanitized family token, the manager's label, the
 *  storage path in lone-star's public `fonts` bucket, and its format hint. */
export type SiteFont = {
  family: string
  label: string
  path: string
  format: string
}

/** The named font slots a site can bind (`--font-primary` etc.). The VALUE list is
 *  contract: a connected site reads `font_slots` keys against exactly these names. */
export const FONT_SLOTS = ['primary', 'secondary', 'custom_1', 'custom_2', 'custom_3'] as const
export type FontSlot = (typeof FONT_SLOTS)[number]
export type FontSlotMap = Partial<Record<FontSlot, string>>

/** One media row as it rides the wire: the raw storage `path` (never a resolved URL —
 *  the receiving site builds URLs against its own Supabase origin), plus orientation and
 *  component-slot role so gallery layouts and placed components render from the draft
 *  exactly as they will from the published site. */
/** What an image IS for the JSON-LD fact sheet (SEO_GEO_PLAN B4b, 20260826120000):
 *  `photo` → ImageObject, `artwork` → VisualArtwork, `none` → left out of the graph.
 *  The registry every select and fixture derives from — never hand-list these. */
export const MEDIA_KINDS = ['photo', 'artwork', 'none'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export type WireMedia = {
  /** The media row id (ftbk connection) — what an image ITEM marker carries
   *  (`image:<id>`) so clicks route to the editor's tile. Absent on older revisions. */
  id?: string | null
  purpose: MediaPurpose
  path: string
  orientation?: 'horizontal' | 'vertical' | null
  site_role?: string | null
  /** The works-pool display name (20260820120000) — what a desktop-style site shows
   *  under the piece's icon (ftbk). Absent on older revisions — read with `?? null`. */
  label?: string | null
  /** Which declared image COLLECTION this photo fills — the manifest slot key
   *  (20260821120000). A site that declares one image slot can ignore it; a site with
   *  two pools (ftbk: desktop works vs the Photos app) filters on it. Null/absent means
   *  the FIRST declared collection, so every pre-collection revision keeps rendering
   *  exactly where it did. */
  collection?: string | null
  /** The manager's alt text (20260826120000). Null/absent = the site derives one from
   *  what it knows (title, caption, artist name) — never invents. */
  alt?: string | null
  /** See MEDIA_KINDS. Null/absent = unset; the site picks its default by artist. */
  kind?: MediaKind | null
}

export type PublicSitePayload = {
  artist: {
    id: string
    slug: string
    name: string
    bio: string | null
    hero_image_url: string | null
    template: string
    spotify_artist_id: string | null
    /** Press-kit fields. Optional because every revision published before
     *  20260804120000 lacks them — run `press_quotes` through `parsePressQuotes`
     *  rather than casting it. */
    press_pitch?: string | null
    press_quotes?: unknown
    /** Paths into the PRIVATE `documents` bucket — not URLs, and not resolvable by a
     *  fan. Only the EPK PDF builder reads them, server-side. */
    tech_rider_path?: string | null
    stage_plot_path?: string | null
  }
  tracks: SiteTrack[]
  tour_dates: SiteTourDate[]
  merch: SiteMerch[]
  links: SiteLink[]
  videos: SiteVideo[]
  media: WireMedia[]
  site_content: SiteContent
  styles: SiteStyles
  /** Published custom fonts (family/label/path/format). Absent on any revision
   *  published before 20260805160000, so always read with `?? []`. */
  fonts: SiteFont[]
  /** Which uploaded font fills each named slot. Absent before 20260805200000 —
   *  read with `?? {}`. */
  font_slots: FontSlotMap
}
