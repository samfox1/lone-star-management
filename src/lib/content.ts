/**
 * Generic content layer for every per-artist content type (tracks, tour dates,
 * merch, links). One config registry drives CRUD + publish so each type isn't a
 * copy-paste of the last. Pure functions over a Supabase client, so RLS scopes
 * every operation to the caller's tenant.
 *
 * Publishing snapshots the public-safe fields of each working row into
 * `revisions`; the public read path (get_public_site) serves the latest per
 * entity. entity_type is the SINGULAR form the schema CHECK constraint expects.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { frontSortOrder, slotByDate } from './insert-position'
import { isContactLink, looksLikeEmail, safeHref } from '@/lib/url'
import { BRAND_MEDIA_SLICE, SITE_MEDIA_SLICE } from '@/lib/brand-media'

/** Types a manager edits through the generic dashboard CRUD forms. */
export type CrudEntity = 'track' | 'tour_date' | 'merch' | 'link' | 'video' | 'release'

/** CRUD types that use the GENERIC dashboard form. Video + release are CrudEntities
 *  (create/update/delete + a field allowlist) but have BESPOKE editors (their own
 *  pages — video runs through embedInfo, release manages a links jsonb) — so they
 *  are excluded from the generic form. */
export type GenericEntity = Exclude<CrudEntity, 'video' | 'release'>

/* ── The two ON-SITE write paths (ADR 0009, amended by ADR 0010) ──────────────────
 *
 * A row is on the public site when it is PUBLISHED and its presence flag says so. Two
 * registries write that flag, and a type belongs to EXACTLY ONE:
 *
 *   LIVE_TOGGLE     the working row's `on_site` IS the site. The door joins the live
 *                   row, so the flip takes effect with no publish. photo, link, video.
 *   DRAFT_PRESENCE  `on_site` rides the SNAPSHOT. The tick is a draft; Publish is what
 *                   fans see. track, release, tour_date, merch.
 *
 * A type on BOTH is the failure mode, and it is not hypothetical: the third path that
 * used to exist reconciled `on_site` from a password-gated selection at publish, setting
 * it false for everything absent from that selection — which silently reverted the live
 * toggle at the next publish. `video` and `merch` sat in the live map with no caller for
 * weeks, unnoticed because the two registries are keyed in DIFFERENT vocabularies
 * (editor kind vs entity), so an overlap does not read as a duplicate by eye. That path
 * is gone; nothing reconciles from a selection any more. The two below are declared
 * adjacently for that reason, and `tests/integration/site/on-site-paths.test.ts` asserts
 * they stay disjoint and together cover every gated type.
 */

/** Editor kinds whose `on_site` is written LIVE, mapped to the entity each one writes.
 *  The editor's vocabulary differs from the entities' on purpose (`photo` is a `media`
 *  row, `tour` a `tour_date`), so this map is the translation — and the reason the two
 *  paths can't be compared by eye. Tables come from PUBLISHABLE, never hand-copied. */
export type LiveToggleKind = 'photo' | 'link' | 'video'
export const LIVE_TOGGLE: Record<LiveToggleKind, TableEntity> = {
  photo: 'media',
  link: 'link',
  video: 'video',
}

/** Every editor/page kind whose on_site a toggle writes, live OR draft — the table the
 *  toggle action needs. LIVE_TOGGLE and DRAFT_PRESENCE partition its entities. */
export type ToggleKind = LiveToggleKind | 'tour' | 'merch' | 'track'
export const TOGGLE_KIND: Record<ToggleKind, TableEntity> = {
  ...LIVE_TOGGLE,
  tour: 'tour_date',
  merch: 'merch',
  track: 'track',
}

/**
 * DRAFT-PRESENCE types (PRESENCE_PLAN.md S1, ADR 0010): a tick or toggle writes the
 * working row's `on_site` like a live toggle does — but the public doors read `on_site`
 * FROM THE SNAPSHOT, so nothing reaches fans until Publish. The editor preview renders
 * working rows, so the manager sees where the song lands before anyone else does.
 *
 * Sam, 2026-09-10: "blindly adding songs to the site seems problematic." And the next
 * day, for tour dates and merch: "The user toggles, hits publish, and it updates on the
 * live site" — the same draft-then-Publish model. Videos, photos and links keep ADR
 * 0009's live toggle.
 *
 * `on_site` therefore rides these types' SNAPSHOT (see PUBLISHABLE), and the
 * "selection reconciled at publish" machinery that used to serve releases and merch is
 * gone: nothing reconciles from a selection any more. A type is in exactly one of
 * DRAFT_PRESENCE / LIVE_TOGGLE (tests/on-site-paths.test.ts).
 */
export type DraftPresenceEntity = 'track' | 'release' | 'tour_date' | 'merch'
/** A RECORD, like LIVE_TOGGLE above, not an array: the array is what every consumer
 *  reads, and widening the union while leaving a stale array compiles perfectly — the
 *  new type then keeps its `on_site` on the wire and the door starts gating on a key the
 *  preview also sends. A missing key here is a compile error. */
export const DRAFT_PRESENCE: Record<DraftPresenceEntity, true> = {
  track: true,
  release: true,
  tour_date: true,
  merch: true,
}

/** The types a DASHBOARD PAGE publishes on its own, from its own password-gated bar:
 *  Videos, Tour, Merch and Connections each publish just their own entity. It is what
 *  `publishEntityAction` accepts, so a type with no page of its own — media, track,
 *  release, site_content, site_styles, artist_font, brand_color, theme_color — is a
 *  compile error there and cannot be published by a route that has no bar to publish it
 *  from. Those go out with the Site publish, or with releases, or from the editor's publish
 *  window, or (brand media, fonts, colours, the browser bar) from the Brand bar.
 *
 *  It is NOT a subset of LIVE_TOGGLE and never was, whatever the old name said: tour_date
 *  and merch are DRAFT_PRESENCE types. Presence and publishing are different questions —
 *  this answers "which page owns the Publish button", not "when does a tick go live". */
export type PagePublishable = 'video' | 'tour_date' | 'merch' | 'link'
/** @deprecated The old name for PagePublishable, kept so actions.ts keeps compiling
 *  while it is renamed there. Delete once nothing imports it. */
export type LiveTogglePublishable = PagePublishable

/** Every entity that is snapshotted into `revisions` and reconciled on publish.
 *  Media + site_content are published here but have no generic CRUD form (each
 *  has its own bespoke editor). The artist PROFILE is published separately as a
 *  singleton (publishProfile). */
export type PublishableEntity =
  | CrudEntity
  | 'media'
  | 'site_content'
  | 'site_styles'
  | 'artist_font'
  | 'brand_color'
  | 'theme_color'

/** Fan-visible artist-profile columns that publish together as one snapshot.
 *  Deliberately excludes config/secret columns (shopify_domain, bandsintown_name)
 *  so they can never reach the public read path. */
export const ARTIST_SNAPSHOT = [
  'name',
  'bio',
  'hero_image_url',
  'template',
  'spotify_artist_id',
  // Press-kit fields (lib/epk.ts). Fan-visible in the sense that matters here: they are
  // published, not secret. They ride the profile so the PDF and /[slug]/epk always agree.
  // Revisions published before 20260804120000 simply lack them — read with parsePressQuotes
  // / `?? null`, never assume presence.
  'press_pitch',
  'press_quotes',
  // Press-kit documents (20260804140000). Paths into the PRIVATE `documents` bucket, so
  // publishing one exposes a path, never the file. They ride the snapshot so a generated
  // EPK is entirely published content rather than published copy plus a draft rider.
  'tech_rider_path',
  'stage_plot_path',
  // SEO/GEO facts (20260826160000): genre, location, and the JSON-LD root type. Absent on
  // older revisions — read with `?? null` / default 'MusicGroup'.
  'genre',
  'location',
  'schema_type',
] as const

/**
 * Columns that joined a snapshot ALREADY DEFAULTED — the column arrived with a non-null
 * default and a backfill, and it joined the snapshot in the same change. Every revision
 * published before that carries NO SUCH KEY, while every live row carries the default,
 * so a key-by-key comparison read "missing vs 'photo'" as an edit and marked every
 * artist's media dirty the day `kind` shipped (M5/M6, REVIEW_2026-09-03: 77 of 91 media
 * revisions on the live project are in that shape). Absent here means "the default",
 * which is what the row actually held when the snapshot was taken.
 *
 * Keyed like PUBLISHABLE, plus 'artist' for the profile singleton (ARTIST_SNAPSHOT), so
 * the next defaulted column is one line rather than another silent flood of dirty badges.
 * Only ever the column's OWN default: this is a statement about history, not a place to
 * paper over a value the diff should be reporting.
 *
 * A key that is PRESENT and null is left alone — null is a value a manager can still be
 * responsible for, and the two migrations below defaulted-and-backfilled in the same
 * change, so no revision carries the key as null (verified against the live log).
 */
export const SNAPSHOT_DEFAULTS: Partial<Record<PublishableEntity | 'artist', Record<string, unknown>>> = {
  media: { kind: 'photo' }, // 20260826130000
  artist: { schema_type: 'MusicGroup' }, // 20260826160000
  // 20260925120000: every font before Google Fonts is an upload. The migration backfilled
  // the LATEST revision of each font; this covers the older ones a restore-to-a-moment reads.
  artist_font: { source: 'upload' },
}

export type ContentRow = Record<string, unknown> & {
  id: string
  artist_id: string
}

/** Form config for the manager-editable types (which columns, which are NOT NULL). */
type CrudConfig = {
  /** Columns a manager may set on create/update (everything else is ignored). */
  fields: string[]
  /** NOT NULL columns — never cleared to null on edit. */
  required: string[]
}

export const CRUD: Record<CrudEntity, CrudConfig> = {
  // soundcloud_url + apple_url are manually editable too (union model), so a manager can
  // attach a SoundCloud/Apple link to a song the sync didn't carry one for.
  track: {
    fields: ['title', 'cover_url', 'stream_url', 'soundcloud_url', 'apple_url', 'deezer_url', 'release_date', 'sort_order'],
    required: ['title'],
  },
  // `support` (the other acts on the bill) is an ARRAY field: it posts one FormData
  // entry per tag, so the actions read it with getAll (see ARRAY_FIELDS).
  // Nothing is required — a date can be added before its date is known (a TBA row);
  // `date` became nullable in 20260716120000. `required` here only governs which
  // columns are never cleared to null on edit, so an empty list lets date be cleared.
  tour_date: { fields: ['date', 'venue', 'city', 'state', 'country', 'ticket_url', 'support', 'is_past'], required: [] },
  merch: { fields: ['title', 'image_url', 'price', 'url', 'in_stock'], required: ['title'] },
  link: { fields: ['label', 'url', 'sort_order'], required: ['label', 'url'] },
  // Manual video adds set provider + a normalized embed_url (validated by the
  // add action via embedInfo); the generic update touches title/sort_order.
  // embed_url is NOT required: an uploaded video has a storage_path instead. The
  // embed-or-storage invariant is enforced by the DB CHECK + embedOrStorageValid.
  video: { fields: ['title', 'provider', 'embed_url', 'storage_path', 'is_short', 'sort_order'], required: ['title', 'provider'] },
  // Releases manage a DSP-links jsonb via their own page (links validated there).
  release: {
    fields: ['title', 'slug', 'cover_url', 'release_date', 'release_type', 'links', 'sort_order'],
    required: ['title', 'slug'],
  },
}

/** One ordering key: a bare column name (ASCENDING), or a column with an explicit
 *  direction. The object form exists because `created_at` runs BACKWARDS for merch and
 *  a bare string cannot say so — which is how the drift below went unnoticed. */
type OrderKey = string | { col: string; asc: boolean }

/** Table (or its own read) + public-safe snapshot + ordering for every versioned/published
 *  entity. A type has a `table` OR a `read`, never both (the union below): every generic
 *  write goes to `PUBLISHABLE[type].table`, and a table named only to satisfy the type
 *  (theme_color's was `artists`) is one `absent: 'delete'` away from deleting artist rows. */
type PublishConfig = {
  /** Public-safe columns copied into a published revision. */
  snapshot: string[]
  /**
   * Ordering for the WORKING list — `listContent`, and therefore the dashboard lists,
   * the snapshot's row order, and the preview (`getWorkingSitePayload`).
   *
   * It is NOT automatically "the published order". The public door
   * (`get_public_site`) writes its own `order by` per section in SQL, and this line
   * used to claim the two were "kept in sync" when they were not:
   *
   *   merch      PINNED to the door as of 2026-09-18, and a test now holds them
   *              together. `20260910160000_merch_newest_first.sql` made the door
   *              `sort_order nulls last, created_at DESC` (newest on top) and nothing
   *              changed the TS, so preview listed merch oldest-first for eight days.
   *              The parity test in tests/integration/publish/preview-parity.test.ts
   *              compares ID ORDER, not just fields, so the next such change fails here.
   *
   *   tour_date  NOT pinned, and deliberately not touched. Its order is decided in
   *              THREE places that do not agree, and no two of them are wrong on their
   *              own:
   *                1. here — `date, sort_order, created_at`
   *                2. `get_public_site`'s tour_dates branch — `date, published_at`.
   *                   `sort_order` is not in it at all.
   *                3. `orderShows` in @samfox1/site-bridge (src/shows.ts, 0.39.0) —
   *                   re-sorts the payload at the site. MANUAL MODE (Sam, 2026-08-17):
   *                   once a DATED row carries a `sort_order` the editor's drag order
   *                   wins outright for that bucket and date only breaks ties. It lived
   *                   in skeen's `lib/mapSite.ts` alone until 2026-09-18.
   *              (2) never had to sort it because (3) does, and (3) is the rule Sam
   *              actually asked for. Picking one of the three changes what a live site
   *              renders, so it is Sam's call, not a cleanup. Left as-is on purpose.
   *
   * Every other section's door order matches its entry below; none has a second sort
   * downstream.
   */
  orderBy: readonly OrderKey[]
  /**
   * A type whose rows are not "the rows of `table` for this artist_id" supplies its own
   * read — `listContent` calls this instead of the generic select. Only `theme_color` does:
   * a singleton that lives on the `artists` row itself (it has no `artist_id` column to
   * filter on). The read must return EVERY row of the type for the artist, as listContent
   * promises, and throw on a failed read rather than return fewer. Such a type has NO
   * `table`: see TableEntity.
   */
} & (
  | { table: string; read?: never }
  | { read: (supabase: SupabaseClient, artistId: string) => Promise<ContentRow[]>; table?: never }
)

/**
 * The types whose rows ARE rows of a table — every one but a type with its own `read`
 * (theme_color, a singleton on `artists`). Anything that writes through
 * `PUBLISHABLE[type].table` (EDITOR_RESTORE, the toggles) is typed by this, so naming
 * `theme_color` there is a compile error rather than a write to `artists`.
 */
export type TableEntity = {
  [K in PublishableEntity]: (typeof PUBLISHABLE)[K] extends { table: string } ? K : never
}[PublishableEntity]

/**
 * The browser-bar colour as publishable rows: ONE row per artist while `theme_color` is
 * set, NONE while it is not (20260925120000). So an unset colour is nothing to publish (no
 * Publish bar for a colour nobody chose), and clearing a published one reads as the row
 * being deleted — Publish writes a tombstone and the door reports null again. The row's id
 * is the artist's (the entity_id of the singleton, as for the `artist` profile).
 */
async function themeColorRows(supabase: SupabaseClient, artistId: string): Promise<ContentRow[]> {
  const { data, error } = await supabase.from('artists').select('id, theme_color').eq('id', artistId).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as { id: string; theme_color: string | null } | null
  return row?.theme_color ? [{ id: row.id, artist_id: row.id, theme_color: row.theme_color }] : []
}

export const PUBLISHABLE = {
  track: {
    table: 'tracks',
    // source + platform ids are provenance for the doors' Released/Unreleased
    // classification (lib/music.ts mirrored in SQL). They ride the public payload;
    // all are public-safe (the ids are just platform-URL components).
    //
    // `album_name` is LEGACY, DISPLAY-ONLY. It once decided release membership by
    // string-matching a release title; `release_id` has been authoritative since
    // 20260706170000, and 20260709120000 removed the last string-match fallback
    // from get_release. It is kept ONLY because skeen-website still reads it as a
    // subtitle/title fallback (lib/mapSite.ts). Never key logic off it.
    // `release_date` is a song's OWN date. It was an editable field that was never
    // snapshotted, so a standalone single's date reached the site as null — no NEW badge
    // could light for one, and the date sort put every dated SoundCloud song in the
    // undated tail (2026-08-21).
    // `on_site` rides the snapshot (20260910130000): the public doors read presence from
    // the published copy, so a tick on the Music page is a draft until Publish. Backfilled
    // into every latest revision by that migration, so nothing reads as dirty on arrival.
    // `release_type` is the song's OWN type tag (20260726120000). The site shelves a
    // standalone song by it (Live set / Single), and it was never snapshotted, so a
    // retagged SoundCloud recording stayed under Singles however often it was published
    // (2026-09-11). Absent on older revisions — readers use `?? 'single'`.
    snapshot: ['id', 'title', 'cover_url', 'stream_url', 'provider_url', 'apple_url', 'soundcloud_url', 'audio_path', 'sort_order', 'release_date', 'featured_artists', 'album_name', 'release_id', 'source', 'spotify_id', 'apple_id', 'deezer_id', 'released', 'on_site', 'release_type'],
    orderBy: ['sort_order', 'created_at'],
  },
  tour_date: {
    table: 'tour_dates',
    // latitude/longitude are deliberately NOT here — coords are dashboard-only and
    // never reach the public read path (20260707140000).
    // `support` is the act NAMES (edited on the tour page); `support_urls` is the
    // per-act name→url map (edited in the editor's Links panel, 20260717140000). Both
    // ride the snapshot so skeen can zip them into linked support acts.
    // `sort_order` is the tie-break for UNDATED shows only (20260723120000) — dated
    // shows still sort by date on the site. Nulls sort last on `date`, so the undated
    // group lands at the end and sort_order sequences it.
    snapshot: [
      'id',
      'date',
      'venue',
      'city',
      'state',
      'country',
      'ticket_url',
      'support',
      'support_urls',
      'is_past',
      'sort_order',
      'on_site', // presence from the snapshot (20260911120000)
    ],
    // created_at is the final tiebreak, matching every other entity: a dated row keeps
    // the sort_order it was backfilled with, so clearing its date could tie it against
    // an undated row and leave the pair ordered arbitrarily.
    orderBy: ['date', 'sort_order', 'created_at'],
  },
  merch: {
    table: 'merch',
    // in_stock (20260818130000): content-level stock state — a sold-out item stays on
    // the site, rendered sold out. Rides the snapshot wholesale, no SQL change (the
    // `role` precedent on links).
    // sort_order (20260818150000): the merch grid drags like every other list now.
    // handle/description/images/variants (20260902120000): the product page at
    // /merch/[handle]. These ride the snapshot as the FALLBACK for first paint and for
    // crawlers — the site resolves price and availability live off Shopify at render
    // (MERCH_PLAN, "two lanes"), because a price frozen until someone republishes is a
    // wrong price shown to a buyer. Nothing here is a markup sink: `description` is
    // Shopify's plain-text field, never descriptionHtml.
    // shopify_product_id is the LIVE LANE's join key (MERCH_PLAN step 2): the site
    // overlays current price/availability from /api/merch/[slug] onto these rows by it.
    // Public-safe — a product gid appears in every Storefront response and is not a
    // credential. Chosen over `handle`, which changes when an artist renames a product
    // and would silently break the join until the next publish.
    snapshot: ['id', 'title', 'image_url', 'price', 'url', 'in_stock', 'sort_order', 'created_at', 'handle', 'description', 'images', 'variants', 'shopify_product_id', 'shipping_estimate', 'preorder_note', 'record_label', 'shipping_days', 'on_site'], // on_site: presence from the snapshot (20260911120000)
    // NEWEST FIRST on created_at — the one descending key in this table, pinned to the
    // door's merch branch (`sort_order nulls last, created_at desc`, 20260910160000).
    // A dragged order still wins; created_at only sequences the rows no drag numbered,
    // and those go on top, because "merch should just get added to the front of the
    // list" (Sam, PRESENCE_PLAN S2). preview-parity.test.ts compares the ID ORDER.
    orderBy: ['sort_order', { col: 'created_at', asc: false }],
  },
  link: {
    table: 'links',
    // `role` binds a link to a manifest link-region (USB / Merch button) by KEY so skeen
    // maps it authoritatively instead of by label. It rides the snapshot (the links
    // branch of get_public_site serves `data` wholesale, so no SQL change is needed) and
    // is null for ordinary social links.
    snapshot: ['id', 'label', 'url', 'sort_order', 'role'],
    orderBy: ['sort_order', 'created_at'],
  },
  video: {
    table: 'videos',
    // Allowlist: youtube_id/source stay server-side, never reach the public site.
    // is_short IS public so the site can split normal videos from Shorts; storage_path
    // IS public so the site can play an uploaded (self-hosted) video. site_role places
    // a video in a named background slot (hero landscape/portrait) — see 20260716200000.
    // `created_at` (20260826170000): VideoObject.uploadDate in the JSON-LD fact sheet —
    // when the manager added it, the one date we actually know.
    // `published_at` (20260826180000): the platform's own publish date, for uploadDate.
    snapshot: ['id', 'title', 'provider', 'embed_url', 'storage_path', 'is_short', 'sort_order', 'site_role', 'created_at', 'published_at'],
    orderBy: ['sort_order', 'created_at'],
  },
  release: {
    table: 'releases',
    // source + spotify_id: provenance for the doors' Released/Unreleased check.
    snapshot: ['id', 'title', 'slug', 'cover_url', 'release_date', 'release_type', 'links', 'sort_order', 'source', 'spotify_id', 'released', 'on_site'], // on_site: see track
    orderBy: ['sort_order', 'created_at'],
  },
  media: {
    table: 'media',
    // `on_site` rides the snapshot so the public door (get_public_site) gates gallery
    // photos on their PUBLISHED on-site selection, and toggling presence is a diffable,
    // publishable change like any other edit. Media is the ONLY type that carries the
    // flag inside the revision — every other type's door joins the live row instead.
    // (Revisions written before 20260714150000 hold the old `visible` key; the door
    // coalesces both. Snapshots are immutable, so history is never rewritten.)
    // `orientation` (horizontal/vertical, gallery photos only) rides so the site can lay
    // each photo out by shape — get_public_site cherry-picks it into the media payload.
    // `site_role` binds a photo to a component slot (`polaroid_3_photo`); null means an
    // ordinary gallery photo. get_public_site cherry-picks it into the media payload.
    // `label` (20260820120000): the works-pool name shown under a desktop icon
    // (ftbk). Null everywhere else; the door cherry-picks it (20260820130000).
    // `collection` (20260821120000): which declared image pool the photo fills, for a
    // site that renders more than one (ftbk: works vs the Photos app). Null = the
    // first declared collection; the door cherry-picks it (20260821130000).
    // `alt` + `kind` (20260826120000): the manager's alt text and the image's JSON-LD
    // kind. The door cherry-picks both (same migration).
    snapshot: ['id', 'purpose', 'storage_path', 'sort_order', 'created_at', 'on_site', 'orientation', 'site_role', 'label', 'collection', 'alt', 'kind'],
    orderBy: ['sort_order', 'created_at'],
  },
  // Editable site text (key/value). entity_id = row id; the snapshot carries the
  // key→value pair. get_public_site folds these into a {key: value} object.
  site_content: {
    table: 'site_content',
    snapshot: ['id', 'key', 'value'],
    orderBy: ['key'],
  },
  // Per-region editable class names (SITE_STYLING_PLAN.md). Same key/value model as
  // site_content: entity_id = row id, snapshot carries {region_key, class_names};
  // get_public_site folds these into a {region_key: class_names} object.
  site_styles: {
    table: 'site_styles',
    snapshot: ['id', 'region_key', 'class_names'],
    orderBy: ['region_key'],
  },
  // Fonts publish like styles do: uploading a font and assigning it to a slot is DRAFT
  // work, and the fan-facing stylesheet changes only at publish. The revisions
  // entity_type CHECK already admits 'artist_font' (20260805140000).
  //
  // Reads the VIEW, not the table: `slots` (the site-wide slots this font fills) rides
  // the FONT's snapshot rather than publishing as its own entity type. Publishing is
  // per-type and sequential, so a separate `artist_font_slot` type would leave a window
  // where a live slot names a font that is not published yet — a site pointing at a
  // family with no @font-face. Inside the font's own row that state cannot be expressed.
  // Writes still go to `artist_fonts` / `artist_font_slots` directly (lib/fonts.ts);
  // artist_font is not a CrudEntity, so nothing writes through this table name.
  //
  // `source` + `google_family` (20260925120000): a Google font has no file — the site loads it
  // from fonts.googleapis.com by `google_family`, so `storage_path`/`format` are null on it.
  artist_font: {
    table: 'artist_fonts_with_slots',
    snapshot: ['id', 'label', 'family', 'storage_path', 'format', 'slots', 'source', 'google_family'],
    orderBy: ['created_at'],
  },
  // The Brand page's palette (BRAND_SYNC_PLAN.md, 20260925120000): one revision per colour.
  // `key` is the stable CSS name (`--brand-<key>`); `slot` and `sort_order` order the door's
  // list (Primary, Secondary, then the added ones); `created_at` breaks a tie. The NOTE is
  // dashboard-only and never rides.
  brand_color: {
    table: 'brand_colors',
    snapshot: ['id', 'key', 'name', 'hex', 'slot', 'sort_order', 'created_at'],
    orderBy: ['sort_order', 'created_at'],
  },
  // The browser-bar colour, a SINGLETON published by the Brand page (20260925120000). It
  // lives on `artists`, but not in ARTIST_SNAPSHOT: the profile publishes with the whole
  // site, so riding it would drag a half-written bio out with a Brand publish. Read by
  // `themeColorRows` — one row while a colour is set, none otherwise — so an unset colour is
  // nothing to publish and clearing a published one publishes a tombstone. entity_id is the
  // artist's id. Written through `artists.theme_color` (lib/brand.ts setThemeColor), never here.
  theme_color: {
    snapshot: ['id', 'theme_color'],
    orderBy: ['id'],
    read: themeColorRows,
  },
} satisfies Record<PublishableEntity, PublishConfig>

/** Keep only the editable columns for a CRUD type, dropping anything else. */
function pickFields(type: CrudEntity, input: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const key of CRUD[type].fields) {
    if (key in input) out[key] = input[key]
  }
  return out
}

/** The public-safe projection of a row — the shape published and previewed. */
export function publicSnapshot(type: PublishableEntity, row: ContentRow) {
  const out: Record<string, unknown> = {}
  for (const key of PUBLISHABLE[type].snapshot) out[key] = row[key]
  return out
}

/**
 * EVERY working row of one type for one artist, in the configured order.
 *
 * `count: 'exact'` is not for the caller — nobody reads the count. It is the only way to
 * know this read was COMPLETE. PostgREST caps an unranged select at `db-max-rows` (1,000
 * on Supabase) and serves the truncated page with a 200: no error, no flag, just fewer
 * rows. `publishContent` documents that cap and works around it on the OTHER side of its
 * comparison (the `latest_revisions` RPC, 2026-08-11) while reading the draft side
 * through here — and it tombstones every published entity whose id is NOT in this list.
 * So a truncated read does not render a short list; it publishes a tombstone for every
 * real row past the cap, and content the manager never touched leaves the live site.
 * `restoreToPublished` deletes by the same reasoning.
 *
 * Throwing is the point. The alternative is paging until the rows run out, which would
 * hide the fact that a single artist's catalogue has outgrown the assumption every
 * caller here makes — that one read is the whole set — and would interleave pages with
 * concurrent writes. The largest set on the project today is ~83 rows, so this is a
 * tripwire, not a limit anyone is near: it fires once, loudly, with room to fix it
 * properly rather than discovering it as missing merch on a live site.
 */
export async function listContent(
  supabase: SupabaseClient,
  type: PublishableEntity,
  artistId: string,
): Promise<ContentRow[]> {
  const cfg: PublishConfig = PUBLISHABLE[type]
  if (cfg.read) return cfg.read(supabase, artistId)
  const table = cfg.table
  let query = supabase.from(table).select('*', { count: 'exact' }).eq('artist_id', artistId)
  for (const key of cfg.orderBy) {
    const { col, asc } = typeof key === 'string' ? { col: key, asc: true } : key
    query = query.order(col, { ascending: asc })
  }
  const { data, count, error } = await query
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ContentRow[]
  if (count != null && rows.length < count) {
    throw new Error(
      `listContent(${type}): the server returned ${rows.length} of ${count} ${table} rows for artist ` +
        `${artistId} — PostgREST truncated the read. Publishing from a truncated list would ` +
        `tombstone every row past it, so this read is refused. Page the query before continuing.`,
    )
  }
  return rows
}


/** New video/merch/tour_date rows land OFF-site (`on_site=false`): the library is
 *  where content ARRIVES, never where it goes live. A synced Bandsintown date or one of
 *  83 YouTube imports appearing on the site unasked is the thing this prevents. The
 *  manager then chooses it — in the editor for video/tour_date (ADR 0009), behind the
 *  publish gate for merch.
 *  (Releases keep their own path: manual adds stay live, Spotify imports set false in
 *  the sync — so `release` is intentionally not here.) */
/** Only videos still land off-site on a manual add (83 YouTube imports must never
 *  auto-appear, and the same door serves hand-added ones). A hand-added tour date or
 *  product is ON the site IN THE DRAFT — Publish is what shows it (S2/S3, revised
 *  2026-09-11). Syncs keep inserting off-site through their own `insertDefaults`; the
 *  library is where things arrive, the toggle is where they are chosen. */
const INSERT_OFF_SITE: readonly CrudEntity[] = ['video']

/** Where a NEW row lands (lib/insert-position): merch on top, a tour date by its date. */
const INSERT_POSITION: Partial<Record<CrudEntity, 'front' | 'by-date'>> = { merch: 'front', tour_date: 'by-date' }

/** `offSite`: land this one row off the site whatever its type's default — a connection's
 *  profile link, which becomes a site button only when the editor picks it (Sam,
 *  2026-09-28). Every other caller keeps the type's default. */
export type CreateOptions = { offSite?: boolean }

export async function createContent(
  supabase: SupabaseClient,
  type: CrudEntity,
  artistId: string,
  input: Record<string, unknown>,
  opts: CreateOptions = {},
): Promise<ContentRow> {
  const offSite = opts.offSite || INSERT_OFF_SITE.includes(type) ? { on_site: false } : {}
  const table = PUBLISHABLE[type].table
  const position = INSERT_POSITION[type]

  // Merch: on top. Only when the list has been dragged (some sort_order is set) — an
  // undragged list is newest-first at the door already, and numbering one row would flip
  // the whole list into manual mode.
  let front: { sort_order?: number } = {}
  if (position === 'front') {
    const { data: existing, error: e } = await supabase.from(table).select('sort_order').eq('artist_id', artistId)
    if (e) throw new Error(e.message)
    const n = frontSortOrder((existing ?? []).map((r) => (r.sort_order as number | null) ?? null))
    if (n !== null) front = { sort_order: n }
  }

  const { data, error } = await supabase
    .from(table)
    .insert({ ...pickFields(type, input), ...offSite, ...front, artist_id: artistId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const row = data as ContentRow

  // Tour: slotted by date among the dragged order, via the same atomic renumber the
  // editor's drag uses. Null from slotByDate means the list was never dragged and the
  // door orders by date on its own.
  if (position === 'by-date') {
    const { data: others, error: e } = await supabase.from(table).select('id, date, sort_order').eq('artist_id', artistId).neq('id', row.id)
    if (e) throw new Error(e.message)
    const order = slotByDate(
      (others ?? []).map((r) => ({ id: r.id as string, date: (r.date as string | null) ?? null, sort_order: (r.sort_order as number | null) ?? null })),
      row.id as string,
      (row.date as string | null) ?? null,
    )
    if (order) {
      const { error: re } = await supabase.rpc('reorder_rows', { p_table: table, p_artist: artistId, p_ids: order })
      if (re) throw new Error(re.message)
    }
  }
  return row
}

export async function updateContent(
  supabase: SupabaseClient,
  type: CrudEntity,
  id: string,
  input: Record<string, unknown>,
): Promise<ContentRow> {
  const { data, error } = await supabase
    .from(PUBLISHABLE[type].table)
    .update(pickFields(type, input))
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as ContentRow
}

export async function deleteContent(
  supabase: SupabaseClient,
  type: CrudEntity,
  id: string,
): Promise<void> {
  const { error } = await supabase.from(PUBLISHABLE[type].table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Set (or clear) the outbound URL for ONE support act on a tour date. The act's name
 * comes from `tour_dates.support` (edited on the tour page); this writes the parallel
 * `support_urls` name→url map (20260717140000), keyed by that name — so the Links panel
 * can link "+ Gudfella" without ever touching the name list.
 *
 * Read-modify-write of the whole jsonb map (a handful of acts per date; single manager),
 * scoped to (id, artist_id) so RLS + the artist filter keep it on the caller's own row.
 * A blank `url` DELETES the key (the act goes back to plain text). Returns the new map.
 */
export async function setSupportUrl(
  supabase: SupabaseClient,
  artistId: string,
  tourDateId: string,
  name: string,
  url: string,
): Promise<Record<string, string>> {
  const { data, error: readErr } = await supabase
    .from('tour_dates')
    .select('support_urls')
    .eq('id', tourDateId)
    .eq('artist_id', artistId)
    .single()
  if (readErr) throw new Error(readErr.message)

  // Validate here too, not only in the action wrapper, so the safe-URL guarantee travels
  // WITH the write (a future direct caller can't persist a javascript:/data: URL into
  // support_urls, which rides the snapshot to the public site). Mirrors saveEditorLink.
  const map = { ...((data?.support_urls as Record<string, string> | null) ?? {}) }
  const safe = url ? safeHref(url) : undefined
  if (safe) map[name] = safe
  else delete map[name]

  const { error } = await supabase
    .from('tour_dates')
    .update({ support_urls: map })
    .eq('id', tourDateId)
    .eq('artist_id', artistId)
  if (error) throw new Error(error.message)
  return map
}

/** One act on a tour date's bill: its name and, optionally, where it links out to. */
export type SupportAct = { name: string; url: string | null }

/** Zip a date's two support columns into the list the tour page edits. Older rows
 *  (before 20260717140000) can carry a null map; a name with no entry has no link. */
export function supportActsOf(row: { support?: string[] | null; support_urls?: Record<string, string> | null }): SupportAct[] {
  const urls = row.support_urls ?? {}
  return (row.support ?? []).map((name) => ({ name, url: urls[name] ?? null }))
}

/**
 * Write a song's collaborators — the names shown as "feat. …" on the site (Sam,
 * 2026-09-11: "where do we put collaborators?"). Trimmed, blanks dropped, duplicates
 * collapsed, capped at 20 like parseContributors. `.select().single()` makes a
 * row-filtered write bite under RLS. A Spotify pull seeds this list and then leaves it
 * alone (lib/sync `fillIfEmpty`), so what is written here stays.
 */
export async function setTrackFeatured(
  supabase: SupabaseClient,
  artistId: string,
  trackId: string,
  names: readonly string[],
): Promise<string[]> {
  const seen = new Set<string>()
  const clean: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    clean.push(name)
    if (clean.length === 20) break
  }
  const { error } = await supabase
    .from('tracks')
    .update({ featured_artists: clean })
    .eq('id', trackId)
    .eq('artist_id', artistId)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return clean
}

/**
 * Write a tour date's WHOLE lineup — names and links — in one update (Sam, 2026-09-11:
 * acts are added one at a time with their website, and edited or removed in place).
 * `support` (names, bill order) and `support_urls` (name→url) are two columns keyed by
 * the name, so they are only ever written TOGETHER here: a rename moves the link to the
 * new name, a removal takes its link with it, and neither can drift from the other.
 *
 * Names are trimmed, blanks dropped, duplicates collapsed (first one wins — it is the
 * React key on the tour page). Every URL goes through safeHref so a javascript:/data:
 * link can never ride the snapshot to the public site; one bad URL refuses the WHOLE
 * write (nothing is silently dropped). Returns the lineup as stored.
 */
export async function setSupportActs(
  supabase: SupabaseClient,
  artistId: string,
  tourDateId: string,
  acts: readonly SupportAct[],
): Promise<SupportAct[]> {
  const seen = new Set<string>()
  const clean: SupportAct[] = []
  for (const act of acts) {
    const name = act.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const raw = (act.url ?? '').trim()
    const url = raw ? safeHref(raw) : null
    if (raw && !url) throw new Error(`Enter a valid URL for ${name}.`)
    clean.push({ name, url: url ?? null })
  }
  const support_urls: Record<string, string> = {}
  for (const a of clean) if (a.url) support_urls[a.name] = a.url

  // `.select()` makes a row-filtered write bite: RLS turns a foreign row into zero rows
  // matched with no error, and `.single()` on nothing is the error a caller can trust.
  const { error } = await supabase
    .from('tour_dates')
    .update({ support: clean.map((a) => a.name), support_urls })
    .eq('id', tourDateId)
    .eq('artist_id', artistId)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return clean
}

/** One moment something was published, newest first, with how many entities changed in
 *  it. Since the 2026-08-15 dedupe every moment is a real change, so this list reads as
 *  the site's versions rather than as a log of no-op republishes. */
export type PublishMoment = { publishedAt: string; entities: number }

export async function listPublishMoments(
  supabase: SupabaseClient,
  artistId: string,
): Promise<PublishMoment[]> {
  const { data, error } = await supabase.rpc('publish_moments', { p_artist_id: artistId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as { published_at: string; entities: number }[]).map((r) => ({
    publishedAt: r.published_at,
    entities: Number(r.entities),
  }))
}

/** A key-order-independent string for a snapshot, so "did this change?" compares VALUES.
 *  JSONB does not preserve key order, so a plain JSON.stringify of the stored copy and of
 *  a freshly built snapshot differ constantly even when nothing about the row moved. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const o = value as Record<string, unknown>
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
}

/** One row as the restore sees it: a working row or a published snapshot. */
type RestoreRow = Record<string, unknown>

/**
 * A `links` row the EDITOR makes and edits whole: a role-bound button (USB / Merch /
 * booking — created, re-pointed and cleared only by the editor's Buttons panel) or a
 * contact row (mailto:, tel:, a bare email — edited only in the editor's Contact group).
 * Every other link is a CONNECTION's profile link (2026-09-13): its URL is edited in
 * Connections, and the editor only switches it on and off the site and orders it.
 * Same contact test as the Connections page's `isProfileLink` and the editor's grouping.
 */
export function isEditorOwnedLink(row: { role?: unknown; url?: unknown } | null | undefined): boolean {
  if (!row) return false
  if (row.role != null && row.role !== '') return true
  const url = typeof row.url === 'string' ? row.url : null
  return isContactLink(url) || looksLikeEmail(url)
}

/** A link is the editor's when EITHER side says so: the working row or its snapshot. Both
 *  halves of a restore ask the same pair, so a row is never counted by two rules. */
const editorLink = (row: RestoreRow | undefined, snap: RestoreRow | undefined) =>
  isEditorOwnedLink(row) || isEditorOwnedLink(snap)

/**
 * How the editor's Revert (and Restore version) treats one kind of row.
 *
 *   whole      the editor makes these rows itself (a style override, a text row, its own
 *              links), so the row IS the change: `columns` go back to the snapshot, a row
 *              added since is deleted, a row deleted since is re-inserted, id and all.
 *   placement  the row exists without the editor (a connection, a song, a show, a
 *              product, a photo, a video). Only WHERE and WHETHER it sits on the site
 *              comes back — `columns` is on_site / sort_order / site_role, never content.
 *              A row the version does not have is taken off the site (`offSite`), never
 *              deleted; a row deleted since is never re-inserted (a show's coordinates, a
 *              song's source, a photo's file are not in the log).
 *
 * `owns` narrows a rule to some rows of its type, judged on the working row and the
 * snapshot together (see `editorLink`).
 */
export type RestoreRule = {
  type: TableEntity
  mode: 'whole' | 'placement'
  columns: readonly string[]
  /** placement: the patch that takes a row the chosen version never had off the site. */
  offSite?: Readonly<RestoreRow>
  owns?: (row: RestoreRow | undefined, snap: RestoreRow | undefined) => boolean
}

/**
 * Everything the site editor's Revert puts back (Sam, 2026-08-14: "it resets to the last
 * published version"; widened 2026-09-28: it undoes what the editor's Publish would ship,
 * wherever it CAN). The Revert button counts exactly this (`revertableChanges`), so it
 * never offers an undo it then leaves in place.
 *
 * NOT in reach, on purpose — Revert leaves these and they do not count:
 *   • content of library rows (a song's title, a show's venue, a product's price, a
 *     photo's alt text) — the Music, Tour and Merch pages' own edits;
 *   • a connection's URL and label (Connections edits them), and a connection removed
 *     there (its page publishes that);
 *   • a published link's or video's on/off: a LIVE toggle (ADR 0009), never recorded in
 *     the log, so the live site already shows the current state;
 *   • library rows deleted since the publish (a show from the editor's trash — which is
 *     why the trash asks first);
 *   • Brand: fonts, colours, the browser bar, logos and icons (Sam: "No brand revert for
 *     now" — the Brand page has its own), and the rest of the profile (press kit, ids).
 */
export const EDITOR_RESTORE: readonly RestoreRule[] = [
  { type: 'site_styles', mode: 'whole', columns: ['region_key', 'class_names'] },
  { type: 'site_content', mode: 'whole', columns: ['key', 'value'] },
  // The editor's own links — unchanged from when every link restored whole.
  { type: 'link', mode: 'whole', columns: ['label', 'url', 'sort_order', 'role'], owns: editorLink },
  // A connection: its order comes back, and a button the version did not have goes off.
  {
    type: 'link',
    mode: 'placement',
    columns: ['sort_order'],
    offSite: { on_site: false },
    owns: (row, snap) => !editorLink(row, snap),
  },
  // Gallery photos only: logos and icons are Brand's, and a profile photo is replaced by
  // deleting its row, which placement cannot bring back.
  {
    type: 'media',
    mode: 'placement',
    columns: ['site_role', 'on_site', 'sort_order'],
    offSite: { site_role: null, on_site: false },
    owns: (row, snap) => (row ?? snap)?.purpose === 'gallery_image',
  },
  { type: 'video', mode: 'placement', columns: ['site_role', 'sort_order'], offSite: { site_role: null, on_site: false } },
  // Songs, releases, shows, products: presence rides their snapshot (ADR 0010), so the
  // published on/off is on record. Derived from the registry, so a new draft-presence
  // kind is in reach the day it joins it.
  ...(Object.keys(DRAFT_PRESENCE) as DraftPresenceEntity[]).map(
    (type): RestoreRule => ({ type, mode: 'placement', columns: ['on_site', 'sort_order'], offSite: { on_site: false } }),
  ),
]

/** The profile columns the editor edits (Text: name, bio; Images: the hero) and Revert
 *  puts back. The rest of ARTIST_SNAPSHOT belongs to other pages. */
export const EDITOR_PROFILE_COLUMNS = ['name', 'bio', 'hero_image_url'] as const

/** One write a restore will make. */
export type RestoreOp =
  | { kind: 'restore'; table: string; id: string; patch: RestoreRow }
  | { kind: 'off'; table: string; id: string; patch: RestoreRow }
  | { kind: 'delete'; table: string; id: string }
  | { kind: 'insert'; table: string; row: RestoreRow }
  | { kind: 'profile'; patch: RestoreRow }

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The writes that would put the DRAFT back to a published version — computed, not made.
 * `restoreToPublished` runs them; `revertableChanges` counts them, which is what keeps the
 * Revert button honest: it shows exactly when a click would change something.
 *
 * The inverse of publishContent, read from the same log: `latest_revisions` (or
 * `revisions_at`, for an older moment) is the newest snapshot per entity. Per row:
 *
 *   • published AND still in the draft → its `columns` back to the snapshot (only the
 *     ones that differ: a no-op UPDATE still bumps updated_at).
 *   • in the draft, NOT published (added since, or tombstoned) → deleted (whole) or taken
 *     off the site (placement).
 *   • published but GONE from the draft → re-inserted, id and all (whole only).
 *
 * A placement column the snapshot never carried (a revision older than the column) is
 * left alone rather than "restored" to null.
 */
export async function planRestore(
  supabase: SupabaseClient,
  artistId: string,
  /** The version published at this moment. Omitted = the latest publish (Revert). */
  at?: string,
): Promise<{ ops: RestoreOp[]; hasPublished: boolean }> {
  // Both RPCs live in SQL because reducing "latest per entity" in JS means selecting the
  // whole log, which PostgREST silently caps at 1000 rows.
  const { data: latest, error: revErr } = at
    ? await supabase.rpc('revisions_at', { p_artist_id: artistId, p_at: at })
    : await supabase.rpc('latest_revisions', { p_artist_id: artistId })
  if (revErr) throw new Error(revErr.message)

  // The published state, by type → id → snapshot. Tombstones are DROPPED here, which is
  // what makes a deleted-then-published row count as "not published" below.
  const published = new Map<string, Map<string, RestoreRow>>()
  for (const r of (latest ?? []) as { entity_type: string; entity_id: string | null; data: RestoreRow }[]) {
    if (r.entity_id === null || r.data?._deleted === true) continue
    const forType = published.get(r.entity_type) ?? new Map<string, RestoreRow>()
    forType.set(r.entity_id, r.data)
    published.set(r.entity_type, forType)
  }

  // NOTHING PUBLISHED → CHANGE NOTHING. Without this, "no published rows" read as "every
  // draft row was added since the publish" and the lot was deleted — on a site that has
  // never published, the manager's entire body of work, with no snapshot to restore it
  // from. It destroyed Juniper's styling on 2026-08-14, in the first minute this shipped.
  // The caller falls back to undoing the session.
  //
  // The same guard PER TYPE, below, for the narrower version of the same trap: an artist
  // who published before a type existed has no revisions for it, and deleting every row
  // of it would be the same wipe one table down. A placement rule is guarded on its OWN
  // rows too: a Brand publish records logos, and with no gallery photo on record "take
  // every photo added since off the site" would take the whole gallery off. Leaving a row
  // that was added since a publish is a visible, one-click mistake; wiping a table's
  // worth of work is not.
  const hasPublished = (latest ?? []).length > 0
  if (!hasPublished) return { ops: [], hasPublished: false }

  const types = [...new Set(EDITOR_RESTORE.map((r) => r.type))].filter((t) => published.has(t))
  const working = new Map(
    await Promise.all(types.map(async (t) => [t, await listContent(supabase, t, artistId)] as const)),
  )

  const ops: RestoreOp[] = []
  for (const rule of EDITOR_RESTORE) {
    const all = published.get(rule.type)
    const rows = working.get(rule.type)
    if (!all || !rows) continue
    const table = PUBLISHABLE[rule.type].table
    const owns = rule.owns ?? (() => true)
    const liveById = new Map(rows.map((row) => [String(row.id), row as RestoreRow]))
    const wanted = new Map([...all].filter(([id, snap]) => owns(liveById.get(id), snap)))
    if (rule.mode === 'placement' && wanted.size === 0) continue

    for (const [id, row] of liveById) {
      const snap = all.get(id)
      if (!owns(row, snap)) continue
      if (snap) {
        const patch: RestoreRow = {}
        for (const col of rule.columns) {
          if (rule.mode === 'placement' && !(col in snap)) continue
          if (!sameValue(row[col], snap[col])) patch[col] = snap[col] ?? null
        }
        if (Object.keys(patch).length) ops.push({ kind: 'restore', table, id, patch })
      } else if (rule.mode === 'whole') {
        ops.push({ kind: 'delete', table, id })
      } else {
        const patch: RestoreRow = {}
        for (const [col, v] of Object.entries(rule.offSite ?? {})) if (!sameValue(row[col], v)) patch[col] = v
        if (Object.keys(patch).length) ops.push({ kind: 'off', table, id, patch })
      }
    }

    // Deleted since the publish: back, for rows the editor makes whole. After the deletes
    // above, so a re-added row never collides with the one that replaced it on a unique
    // key (region_key, key, role).
    if (rule.mode !== 'whole') continue
    for (const [id, snap] of wanted) {
      if (liveById.has(id)) continue
      const row: RestoreRow = { id, artist_id: artistId }
      for (const col of rule.columns) row[col] = snap[col] ?? null
      ops.push({ kind: 'insert', table, row })
    }
  }

  // The profile singleton: the three columns the editor edits.
  const profile = published.get('artist')?.get(artistId)
  if (profile) {
    const { data, error } = await supabase
      .from('artists')
      .select(EDITOR_PROFILE_COLUMNS.join(', '))
      .eq('id', artistId)
      .single()
    if (error) throw new Error(error.message)
    const now = data as unknown as RestoreRow
    const patch: RestoreRow = {}
    for (const col of EDITOR_PROFILE_COLUMNS) {
      if (!(col in profile)) continue
      const next = profile[col] ?? null
      // The name is the artist's identity across the dashboard (and NOT NULL): never
      // blanked, the same rule as the editor's own save.
      if (col === 'name' && (typeof next !== 'string' || next.trim() === '')) continue
      if (!sameValue(now[col], next)) patch[col] = next
    }
    if (Object.keys(patch).length) ops.push({ kind: 'profile', patch })
  }

  return { ops, hasPublished }
}

/** How many writes Revert would make right now: what the editor's Revert button counts.
 *  Zero for a site that has never published (nothing to revert to). */
export async function revertableChanges(supabase: SupabaseClient, artistId: string): Promise<number> {
  return (await planRestore(supabase, artistId)).ops.length
}

/**
 * Put the DRAFT back to a published version, for everything in the editor's reach
 * (`EDITOR_RESTORE` + `EDITOR_PROFILE_COLUMNS`): runs `planRestore`'s writes in order.
 *
 * RLS scopes every statement to the caller's own artist; the RPCs are SECURITY INVOKER
 * for the same reason. Not atomic — each write is its own request — and running it again
 * finishes the job. Returns counts the caller reports and the tests assert: `restored`
 * (rows put back, the profile included), `removed` (deleted or taken off the site),
 * `readded` (re-inserted).
 */
export async function restoreToPublished(
  supabase: SupabaseClient,
  artistId: string,
  /** Go back to the version published at this moment. Omitted = the latest publish,
   *  which is what the editor's Revert asks for. */
  at?: string,
): Promise<{ restored: number; removed: number; readded: number; hasPublished: boolean }> {
  const { ops, hasPublished } = await planRestore(supabase, artistId, at)
  let restored = 0
  let removed = 0
  let readded = 0
  const fail = (e: { message: string } | null) => {
    if (e) throw new Error(e.message)
  }

  for (const op of ops) {
    if (op.kind === 'profile') {
      fail((await supabase.from('artists').update(op.patch).eq('id', artistId)).error)
      restored++
    } else if (op.kind === 'restore' || op.kind === 'off') {
      fail((await supabase.from(op.table).update(op.patch).eq('id', op.id).eq('artist_id', artistId)).error)
      if (op.kind === 'restore') restored++
      else removed++
    } else if (op.kind === 'delete') {
      fail((await supabase.from(op.table).delete().eq('id', op.id).eq('artist_id', artistId)).error)
      removed++
    } else {
      fail((await supabase.from(op.table).insert(op.row)).error)
      readded++
    }
  }

  // `hasPublished` lets the caller tell "the draft already matches the published site"
  // (nothing to do) from "there is no published site to go back to" (fall back to undoing
  // the session) — both of which otherwise look identical: zero changes.
  return { restored, removed, readded, hasPublished }
}

/** A SLICE of one type to publish, decided on the snapshot (see `revisionRows`). */
export type PublishSlice = { keep: (snapshot: Record<string, unknown>) => boolean }

/** One type in a publish: the whole type, or only the entities its `slice` accepts. */
export type PublishPart = PublishableEntity | { type: PublishableEntity; slice?: PublishSlice }

/** A `revisions` row as a publish writes it. No `published_at`: the column default, now(),
 *  is the TRANSACTION's time, which is what makes one insert one publish moment. */
type RevisionInsert = {
  artist_id: string
  entity_type: string
  entity_id: string | null
  data: Record<string, unknown>
  published_by: string | null
}

type LatestRow = { entity_type: string; entity_id: string | null; data: Record<string, unknown> }

/**
 * Reconcile the published state of one content type to match the working rows — the
 * revision rows that would do it, built and NOT written (`publishTogether` writes them,
 * with every other type's, in one insert).
 *
 * Publish is the gate: the live site becomes exactly what the working table
 * looks like NOW. So we (1) snapshot every current working row, and
 * (2) tombstone every entity_id previously published for this type that no
 * longer has a working row — otherwise a deleted row's last snapshot would stay
 * "latest" and remain live forever. get_public_site drops entities whose latest
 * revision is a tombstone.
 *
 * `slice`: publish only the entities this accepts — the Brand page publishes brand media
 * and must leave a gallery draft a draft. Judged on the snapshot, so a DELETED entity is
 * judged by its last published copy: a deleted logo is tombstoned, a deleted gallery photo
 * is not (tombstoning it would take it off the live site from a page that never showed it).
 * `liveIds` stays the WHOLE table either way, or every published row outside the slice
 * would look deleted. Omitted = the whole type.
 */
function revisionRows(
  type: PublishableEntity,
  artistId: string,
  rows: ContentRow[],
  latest: LatestRow[],
  publishedBy: string | null,
  slice?: PublishSlice,
): RevisionInsert[] {
  const liveIds = new Set(rows.map((row) => row.id))
  const keep = slice?.keep ?? (() => true)

  // What is CURRENTLY live in the log, via the same server-side latest-per-entity RPC
  // the diff reads (uncapped). The raw `select entity_id from revisions` this replaced
  // had two compounding faults (2026-08-11): every id ever published — tombstoned or
  // not — counted as needing a tombstone, so each publish RE-tombstoned every
  // historical row and the log grew by its own dead weight (the seed artist reached
  // 1,711 tour revisions); and PostgREST silently caps an unlimited select at 1,000
  // rows, so past that the sweep started MISSING ids — a deleted show could stay on
  // the live site because its tombstone was never written. Found because the publish
  // diff (which uses the uncapped RPC) kept reporting deletions the sweep could not
  // see.
  const tombstoneIds = latest
    .filter(
      (r) =>
        r.entity_type === type &&
        r.entity_id !== null &&
        r.data._deleted !== true && // already tombstoned — writing another is the growth spiral
        !liveIds.has(r.entity_id) &&
        keep(r.data),
    )
    .map((r) => r.entity_id as string)

  // What each entity's snapshot ALREADY says, so an unchanged row is not written again.
  // 89% of skeen's 3,829 revision rows were byte-identical re-writes of the row before
  // them (measured 2026-08-15): the log was growing with the number of PUBLISHES rather
  // than the number of CHANGES. Nothing about history is lost — the newest revision per
  // entity is still the published value, and "what was live at time T" is still the
  // newest revision at or before T. What changes is that a publish moment now means
  // "something actually changed", which is exactly what a version list should show.
  const currentSnapshot = new Map<string, string>()
  for (const r of latest) {
    if (r.entity_type === type && r.entity_id) currentSnapshot.set(r.entity_id, stableJson(r.data))
  }

  return [
    ...rows
      .map((row) => ({ row, data: publicSnapshot(type, row) }))
      .filter(({ data }) => keep(data))
      // Compared through stableJson because the stored copy comes back from JSONB with
      // its keys in Postgres's order, not the order publicSnapshot wrote them.
      .filter(({ row, data }) => currentSnapshot.get(String(row.id)) !== stableJson(data))
      .map(({ row, data }) => ({
        artist_id: artistId,
        entity_type: type,
        entity_id: row.id,
        data,
        published_by: publishedBy,
      })),
    ...tombstoneIds.map((id) => ({
      artist_id: artistId,
      entity_type: type,
      entity_id: id,
      data: { _deleted: true } as Record<string, unknown>,
      published_by: publishedBy,
    })),
  ]
}

/** The profile singleton's revision: the allowlisted fan-visible columns as they are now. */
async function profileRevision(supabase: SupabaseClient, artistId: string, publishedBy: string | null): Promise<RevisionInsert> {
  // Single source of truth: select exactly the snapshotted columns.
  const { data: artist, error } = await supabase
    .from('artists')
    .select(ARTIST_SNAPSHOT.join(', '))
    .eq('id', artistId)
    .single()
  if (error || !artist) throw new Error(error?.message ?? 'artist not found')

  const row = artist as unknown as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const k of ARTIST_SNAPSHOT) data[k] = row[k]
  return { artist_id: artistId, entity_type: 'artist', entity_id: artistId, data, published_by: publishedBy }
}

/**
 * Publish several types (and, with `profile`, the artist profile) as ONE publish moment:
 * every row is built first, then written in a SINGLE insert.
 *
 * Why one insert. `publish_moments` — the history's version list — groups the log by exact
 * `published_at`, whose default is now(): the transaction's time, shared by every row of one
 * statement and different for the next. Publishing kind by kind made one click several
 * versions (a Brand Publish was up to four), and a failure between two kinds shipped the
 * first without the second. One statement is all of it or none of it, under one timestamp.
 *
 * All reads happen first, in one wave (the log once, every type's working rows, the profile).
 * Returns the CONTENT rows written; the profile row, when asked for, is written but not
 * counted, as `publishAll` never counted it.
 */
export async function publishTogether(
  supabase: SupabaseClient,
  artistId: string,
  parts: readonly PublishPart[],
  publishedBy?: string,
  { profile = false }: { profile?: boolean } = {},
): Promise<number> {
  const specs = parts.map((p) => (typeof p === 'string' ? { type: p, slice: undefined } : p))
  const by = publishedBy ?? null
  const [latestRes, profileRow, ...rowsByPart] = await Promise.all([
    supabase.rpc('latest_revisions', { p_artist_id: artistId }),
    profile ? profileRevision(supabase, artistId, by) : null,
    ...specs.map((s) => listContent(supabase, s.type, artistId)),
  ])
  if (latestRes.error) throw new Error(latestRes.error.message)
  const latest = (latestRes.data ?? []) as LatestRow[]

  const content = specs.flatMap((s, i) => revisionRows(s.type, artistId, rowsByPart[i], latest, by, s.slice))
  const revisions = profileRow ? [...content, profileRow] : content
  if (revisions.length === 0) return 0
  const { error } = await supabase.from('revisions').insert(revisions)
  if (error) throw new Error(error.message)
  return content.length
}

/** Publish ONE type — or the slice of it `slice` accepts (see `revisionRows`). Returns the
 *  number of revision rows written. */
export function publishContent(
  supabase: SupabaseClient,
  type: PublishableEntity,
  artistId: string,
  publishedBy?: string,
  slice?: PublishSlice,
): Promise<number> {
  return publishTogether(supabase, artistId, [{ type, slice }], publishedBy)
}

/**
 * Publish the artist's profile: snapshot the allowlisted fan-visible columns into
 * a single `entity_type='artist'` revision (a singleton — no tombstone). The
 * public read path reads the latest such snapshot, so profile edits are draft
 * until this runs.
 */
export async function publishProfile(
  supabase: SupabaseClient,
  artistId: string,
  publishedBy?: string,
): Promise<void> {
  const { error } = await supabase.from('revisions').insert(await profileRevision(supabase, artistId, publishedBy ?? null))
  if (error) throw new Error(error.message)
}

/** Publish everything for an artist: every content type + media, AND the profile, in one
 *  write. A site is "live" exactly when its profile snapshot exists, so a publish that
 *  failed partway must not flip a never-published site live with empty content — it
 *  cannot now: a refused row fails the whole insert (`publishTogether`), profile included. */
export function publishAll(supabase: SupabaseClient, artistId: string, publishedBy?: string): Promise<number> {
  return publishTogether(supabase, artistId, Object.keys(PUBLISHABLE) as PublishableEntity[], publishedBy, { profile: true })
}

/** The Site section's Publish (and the SEO / GEO page's): photos, site text and the
 *  profile, as one moment. Every media row EXCEPT the Brand page's (`SITE_MEDIA_SLICE`,
 *  2026-09-28): logos and icons ship from the Brand bar, and this used to ship their drafts
 *  too — a deleted logo's tombstone included. */
export function publishSite(supabase: SupabaseClient, artistId: string, publishedBy?: string): Promise<number> {
  return publishTogether(supabase, artistId, [{ type: 'media', slice: SITE_MEDIA_SLICE }, 'site_content'], publishedBy, { profile: true })
}

/** The Music page's Publish: releases and songs, as one moment. */
export function publishMusic(supabase: SupabaseClient, artistId: string, publishedBy?: string): Promise<number> {
  return publishTogether(supabase, artistId, ['release', 'track'], publishedBy)
}

/** Pending changes for one section: counts + a convenience `dirty` flag. */
export type SectionDiff = { added: number; edited: number; deleted: number; dirty: boolean }
/** Media is split between TWO Publish buttons (2026-09-28), so its diff carries both
 *  halves beside the whole: `site` is what the Site / SEO Publish ships (SITE_MEDIA_SLICE),
 *  `brand` what the Brand bar ships. The whole is what publishAll ships. */
export type MediaDiff = SectionDiff & { site: SectionDiff; brand: SectionDiff }
/** Per-section pending changes for an artist (profile + every publishable type). */
export type UnpublishedDiff = { profile: SectionDiff } & Record<PublishableEntity, SectionDiff> & { media: MediaDiff }

const emptyDiff = (): SectionDiff => ({ added: 0, edited: 0, deleted: 0, dirty: false })

/** Count a list of changes into a SectionDiff. */
function tally(changes: readonly EntityChange[]): SectionDiff {
  const d = emptyDiff()
  for (const c of changes) d[c.change]++
  d.dirty = d.added + d.edited + d.deleted > 0
  return d
}

/** Is anything the Site / SEO Publish ships (`publishSite`) not on the site yet? The
 *  profile, the site text and the site's half of the media — never a Brand logo, which only
 *  the Brand bar publishes, so a bar lit by one would stay lit after its own Publish. */
export function siteUnpublished(diff: UnpublishedDiff): boolean {
  // `?.`: a diff cached before the halves existed (dashboardDiff is unstable_cache) has only
  // the whole — read that for a moment rather than throw on the page.
  return diff.profile.dirty || diff.site_content.dirty || (diff.media.site?.dirty ?? diff.media.dirty)
}

/** One key's value for comparison. A key the snapshot does not HAVE (an older revision,
 *  published before the column existed) reads as that column's default — see
 *  SNAPSHOT_DEFAULTS — because that is what the row held when the snapshot was taken.
 *  Absent with no registered default is null, as before, and a key that is present keeps
 *  its own value (including null). */
function snapshotValue(
  snap: Record<string, unknown> | undefined,
  key: string,
  defaults: Record<string, unknown>,
): unknown {
  if (snap && key in snap) return snap[key] ?? null
  return defaults[key] ?? null
}

/** Compare two snapshots key-by-key (jsonb key order isn't stable, so don't
 *  stringify whole objects). null and missing are equal, except where the column has a
 *  registered default (SNAPSHOT_DEFAULTS), which missing then means. */
function sameSnapshot(
  keys: readonly string[],
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
  defaults: Record<string, unknown> = {},
): boolean {
  for (const k of keys) {
    if (JSON.stringify(snapshotValue(a, k, defaults)) !== JSON.stringify(snapshotValue(b, k, defaults))) return false
  }
  return true
}

/** One entity that differs from its last published snapshot. `snapshot` is the side that
 *  exists — the working projection for added/edited, the published copy for deleted — so a
 *  caller can say WHAT changed (a purpose, a label) without a second read. */
export type EntityChange = {
  id: string
  change: 'added' | 'edited' | 'deleted'
  snapshot: Record<string, unknown>
}

/**
 * THE per-entity comparison behind `diffUnpublished`, exported so a page that owns a SLICE
 * of a type (the Brand page owns some media purposes, not the gallery) reports its own
 * dirty state from the same rule instead of a second diff that drifts from this one.
 *
 * `latest` is keyed `${type}:${entity_id}` (the `latest_revisions` RPC, one row per
 * entity). `keep`, when given, scopes BOTH sides by snapshot — a working row and a
 * published copy alike — so a deleted brand logo is still found by its published purpose.
 * Tombstones are "not published", exactly as before.
 */
export function diffEntities(
  type: PublishableEntity,
  rows: ContentRow[],
  latest: Map<string, Record<string, unknown>>,
  keep?: (snapshot: Record<string, unknown>) => boolean,
): EntityChange[] {
  const out: EntityChange[] = []
  const working = new Map(rows.map((r) => [String(r.id), publicSnapshot(type, r)]))

  for (const [id, snap] of working) {
    if (keep && !keep(snap)) continue
    const pub = latest.get(`${type}:${id}`)
    if (!pub || pub._deleted === true) out.push({ id, change: 'added', snapshot: snap })
    else if (!sameSnapshot(PUBLISHABLE[type].snapshot, snap, pub, SNAPSHOT_DEFAULTS[type] ?? {}))
      out.push({ id, change: 'edited', snapshot: snap })
  }
  for (const [key, data] of latest) {
    if (!key.startsWith(`${type}:`) || data._deleted === true) continue
    const id = key.slice(type.length + 1)
    if (working.has(id)) continue
    if (keep && !keep(data)) continue
    out.push({ id, change: 'deleted', snapshot: data })
  }
  return out
}

/**
 * What has changed since the last publish, per section. Compares each working
 * row's public snapshot against the latest published revision for that entity
 * (and the profile against its latest singleton snapshot), so the comparison is
 * apples-to-apples and a freshly published artist reports nothing (no false
 * positives). Powers the Overview summary and per-section dirty badges.
 */
export async function diffUnpublished(
  supabase: SupabaseClient,
  artistId: string,
): Promise<UnpublishedDiff> {
  const types = Object.keys(PUBLISHABLE) as PublishableEntity[]

  // One wave: latest revision PER ENTITY (server-side DISTINCT ON, so it isn't
  // capped by PostgREST's 1000-row limit the way pulling the whole revisions
  // table was), the profile row, and every section's working rows in parallel.
  const [revsRes, artistRes, ...rowsByType] = await Promise.all([
    supabase.rpc('latest_revisions', { p_artist_id: artistId }),
    supabase.from('artists').select(ARTIST_SNAPSHOT.join(', ')).eq('id', artistId).single(),
    ...types.map((type) => listContent(supabase, type, artistId)),
  ])
  if (revsRes.error) throw new Error(revsRes.error.message)

  const latest = new Map<string, Record<string, unknown>>()
  for (const r of (revsRes.data ?? []) as { entity_type: string; entity_id: string; data: Record<string, unknown> }[]) {
    latest.set(`${r.entity_type}:${r.entity_id}`, r.data)
  }

  const result = { profile: emptyDiff() } as UnpublishedDiff
  const whole = result as Record<PublishableEntity, SectionDiff>
  types.forEach((type, i) => {
    whole[type] = tally(diffEntities(type, rowsByType[i], latest))
  })
  // Each half judged by the slice its own Publish sends (the same `keep`), so what a bar
  // counts is exactly what its button ships.
  const mediaRows = rowsByType[types.indexOf('media')]
  result.media = {
    ...result.media,
    site: tally(diffEntities('media', mediaRows, latest, SITE_MEDIA_SLICE.keep)),
    brand: tally(diffEntities('media', mediaRows, latest, BRAND_MEDIA_SLICE.keep)),
  }

  // Profile singleton.
  const profilePub = latest.get(`artist:${artistId}`)
  const p = result.profile
  if (!profilePub) p.added = 1
  else if (
    !sameSnapshot(
      ARTIST_SNAPSHOT,
      artistRes.data as unknown as Record<string, unknown>,
      profilePub,
      SNAPSHOT_DEFAULTS.artist ?? {},
    )
  )
    p.edited = 1
  p.dirty = p.added + p.edited + p.deleted > 0

  return result
}
