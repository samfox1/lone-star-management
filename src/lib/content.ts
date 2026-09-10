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
import { releaseBucket, type ReleaseProvenance } from '@/lib/music'
import { safeHref } from '@/lib/url'

/** The columns reconcileOnSite reads (superset: provenance only for releases). */
type OnSiteRow = {
  id: string
  on_site: boolean | null
  source?: string | null
  spotify_id?: string | null
  links?: unknown
  released?: boolean | null
}

/** Types a manager edits through the generic dashboard CRUD forms. */
export type CrudEntity = 'track' | 'tour_date' | 'merch' | 'link' | 'video' | 'release'

/** CRUD types that use the GENERIC dashboard form. Video + release are CrudEntities
 *  (create/update/delete + a field allowlist) but have BESPOKE editors (their own
 *  pages — video runs through embedInfo, release manages a links jsonb) — so they
 *  are excluded from the generic form. */
export type GenericEntity = Exclude<CrudEntity, 'video' | 'release'>

/* ── The two ON-SITE write paths (ADR 0009) ───────────────────────────────────────
 *
 * A row is on the public site when it is PUBLISHED and its working row has
 * `on_site = true` — every door gates on the working row, so the flag takes effect
 * without a publish. Two paths write that flag, and a type belongs to EXACTLY ONE:
 *
 *   LIVE_TOGGLE       flipped directly (the editor, and the library pages) → instant
 *   ON_SITE_ENTITIES  reconciled from a password-gated selection at publish
 *
 * A type on both paths is the failure mode: `reconcileOnSite` sets `on_site = false`
 * for everything absent from the selection, so it silently reverts the live toggle at
 * the next publish. That is not a hypothetical — `video` and `merch` sat in the live map
 * with no caller for weeks, unnoticed because the two are keyed in DIFFERENT
 * vocabularies (editor kind vs entity), so an overlap doesn't read as a duplicate. They
 * are declared adjacently here for that reason, and `tests/on-site-paths.test.ts`
 * asserts they stay disjoint.
 */

/** Editor kinds whose `on_site` is written LIVE, mapped to the entity each one writes.
 *  The editor's vocabulary differs from the entities' on purpose (`photo` is a `media`
 *  row, `tour` a `tour_date`), so this map is the translation — and the reason the two
 *  paths can't be compared by eye. Tables come from PUBLISHABLE, never hand-copied. */
export type LiveToggleKind = 'photo' | 'link' | 'video' | 'tour' | 'merch'
export const LIVE_TOGGLE: Record<LiveToggleKind, PublishableEntity> = {
  photo: 'media',
  link: 'link',
  video: 'video',
  tour: 'tour_date',
  // Merch joined 2026-09-10 (PRESENCE_PLAN S2): "tour dates and merch can just go right
  // to the site" — a product is always a list entry, so its check IS the site change.
  merch: 'merch',
}

/**
 * DRAFT-PRESENCE types (PRESENCE_PLAN.md S1, ADR 0010): a tick or toggle writes the
 * working row's `on_site` like a live toggle does — but the public doors read `on_site`
 * FROM THE SNAPSHOT, so nothing reaches fans until Publish. The editor preview renders
 * working rows, so the manager sees where the song lands before anyone else does.
 *
 * Sam, 2026-09-10: "blindly adding songs to the site seems problematic." An asset can be
 * used many ways on a site; tour dates and merch are always a list, so those stay live.
 *
 * `on_site` therefore rides these types' SNAPSHOT (see PUBLISHABLE), and the
 * "selection reconciled at publish" machinery that used to serve releases and merch is
 * gone: nothing reconciles from a selection any more. A type is in exactly one of
 * DRAFT_PRESENCE / LIVE_TOGGLE (tests/on-site-paths.test.ts).
 */
export type DraftPresenceEntity = 'track' | 'release'
export const DRAFT_PRESENCE: readonly DraftPresenceEntity[] = ['track', 'release']

/** LIVE-TOGGLE types that publish their OWN content from their own page — snapshot
 *  only, NEVER reconciled (presence is already live). `publishEntityAction` takes this,
 *  so a reconcile type (release / merch) is a COMPILE error there and can't silently
 *  skip `reconcileOnSite` (ADR 0009). The other live-toggle types publish elsewhere:
 *  photo(media) via the Site publish, track with releases, link via a section publish. */
export type LiveTogglePublishable = 'video' | 'tour_date' | 'merch'

/** Every entity that is snapshotted into `revisions` and reconciled on publish.
 *  Media + site_content are published here but have no generic CRUD form (each
 *  has its own bespoke editor). The artist PROFILE is published separately as a
 *  singleton (publishProfile). */
export type PublishableEntity = CrudEntity | 'media' | 'site_content' | 'site_styles' | 'artist_font'

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

/** Table + public-safe snapshot + ordering for every versioned/published entity. */
type PublishConfig = {
  table: string
  /** Public-safe columns copied into a published revision. */
  snapshot: string[]
  /** Ordering for list/snapshot (also the published order, kept in sync). */
  orderBy: string[]
}

export const PUBLISHABLE: Record<PublishableEntity, PublishConfig> = {
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
    snapshot: ['id', 'title', 'cover_url', 'stream_url', 'provider_url', 'apple_url', 'soundcloud_url', 'audio_path', 'sort_order', 'release_date', 'featured_artists', 'album_name', 'release_id', 'source', 'spotify_id', 'apple_id', 'deezer_id', 'released', 'on_site'],
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
    snapshot: ['id', 'title', 'image_url', 'price', 'url', 'in_stock', 'sort_order', 'created_at', 'handle', 'description', 'images', 'variants', 'shopify_product_id', 'shipping_estimate', 'preorder_note', 'record_label', 'shipping_days'],
    orderBy: ['sort_order', 'created_at'],
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
  artist_font: {
    table: 'artist_fonts_with_slots',
    snapshot: ['id', 'label', 'family', 'storage_path', 'format', 'slots'],
    orderBy: ['created_at'],
  },
}

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

export async function listContent(
  supabase: SupabaseClient,
  type: PublishableEntity,
  artistId: string,
): Promise<ContentRow[]> {
  let query = supabase.from(PUBLISHABLE[type].table).select('*').eq('artist_id', artistId)
  for (const col of PUBLISHABLE[type].orderBy) query = query.order(col)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ContentRow[]
}


/** New video/merch/tour_date rows land OFF-site (`on_site=false`): the library is
 *  where content ARRIVES, never where it goes live. A synced Bandsintown date or one of
 *  83 YouTube imports appearing on the site unasked is the thing this prevents. The
 *  manager then chooses it — in the editor for video/tour_date (ADR 0009), behind the
 *  publish gate for merch.
 *  (Releases keep their own path: manual adds stay live, Spotify imports set false in
 *  the sync — so `release` is intentionally not here.) */
const INSERT_OFF_SITE: readonly CrudEntity[] = ['video', 'merch', 'tour_date']

export async function createContent(
  supabase: SupabaseClient,
  type: CrudEntity,
  artistId: string,
  input: Record<string, unknown>,
): Promise<ContentRow> {
  const offSite = INSERT_OFF_SITE.includes(type) ? { on_site: false } : {}
  const { data, error } = await supabase
    .from(PUBLISHABLE[type].table)
    .insert({ ...pickFields(type, input), ...offSite, artist_id: artistId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as ContentRow
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

/**
 * Reconcile the published state of one content type to match the working rows.
 *
 * Publish is the gate: the live site becomes exactly what the working table
 * looks like NOW. So we (1) snapshot every current working row, and
 * (2) tombstone every entity_id previously published for this type that no
 * longer has a working row — otherwise a deleted row's last snapshot would stay
 * "latest" and remain live forever. get_public_site drops entities whose latest
 * revision is a tombstone. Returns the number of revision rows written.
 */
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

/**
 * What the site editor's "Undo changes" puts back, per entity type (Sam, 2026-08-14:
 * "if they want to clear their changes, it resets to the last published version").
 *
 * `columns` are the ones the EDITOR owns, and only those. Restoring a whole row would
 * let an undo in the styling panel also rename a video someone retitled on the Videos
 * page — an edit the editor never made and its undo has no business reversing.
 *
 * `absent` is what to do with a DRAFT row the last publish knows nothing about:
 *   • 'delete' — the editor creates these whole (a style override, a text row, a link),
 *     so a row added since the publish is exactly the change being undone.
 *   • 'unplace' — the row exists independently of the editor (a photo, a video: a real
 *     uploaded file). Undo takes it out of its slot; it must never delete the file.
 */
export const EDITOR_RESTORE: {
  type: PublishableEntity
  columns: string[]
  absent: 'delete' | 'unplace'
}[] = [
  { type: 'site_styles', columns: ['region_key', 'class_names'], absent: 'delete' },
  { type: 'site_content', columns: ['key', 'value'], absent: 'delete' },
  { type: 'link', columns: ['label', 'url', 'sort_order', 'role'], absent: 'delete' },
  // Placement only. `site_role` is which slot a photo/video sits in — the one thing the
  // editor assigns; the file, its title and its storage path are not the editor's.
  { type: 'media', columns: ['site_role'], absent: 'unplace' },
  { type: 'video', columns: ['site_role'], absent: 'unplace' },
]

/**
 * Put the DRAFT back to the last published version, for everything the site editor owns.
 *
 * The inverse of publishContent, and it reads the same log: `latest_revisions` is the
 * newest snapshot per entity, so "what the site looked like at the last publish" is
 * already recorded and needs no extra bookkeeping. Three cases per row, and all three
 * matter — a restore that only handled the first would leave the draft looking published
 * while still carrying additions and missing deletions:
 *
 *   • published AND still in the draft → put the owned columns back to the snapshot.
 *   • in the draft, NOT published (added since, or its latest revision is a tombstone)
 *     → delete it, or unplace it (see EDITOR_RESTORE.absent).
 *   • published but GONE from the draft (deleted since) → re-insert it, id and all, so
 *     the row the manager deleted comes back rather than silently staying gone.
 *
 * RLS scopes every statement to the caller's own artist; the RPC is SECURITY INVOKER for
 * the same reason. Returns per-type counts, which the caller reports and the tests assert.
 */
export async function restoreToPublished(
  supabase: SupabaseClient,
  artistId: string,
  /** Go back to the version published at this moment. Omitted = the latest publish,
   *  which is what the editor's Undo button asks for. */
  at?: string,
): Promise<{ restored: number; removed: number; readded: number; hasPublished: boolean }> {
  // `revisions_at` is `latest_revisions` with a ceiling on published_at — the newest
  // snapshot per entity AT OR BEFORE the chosen moment. Both live in SQL because
  // reducing "latest per entity" in JS means selecting the whole log, which PostgREST
  // silently caps at 1000 rows.
  const { data: latest, error: revErr } = at
    ? await supabase.rpc('revisions_at', { p_artist_id: artistId, p_at: at })
    : await supabase.rpc('latest_revisions', { p_artist_id: artistId })
  if (revErr) throw new Error(revErr.message)

  // The published state, by type → id → snapshot. Tombstones are DROPPED here, which is
  // what makes a deleted-then-published row count as "not published" below.
  const published = new Map<string, Map<string, Record<string, unknown>>>()
  for (const r of (latest ?? []) as { entity_type: string; entity_id: string | null; data: Record<string, unknown> }[]) {
    if (r.entity_id === null || r.data?._deleted === true) continue
    const forType = published.get(r.entity_type) ?? new Map<string, Record<string, unknown>>()
    forType.set(r.entity_id, r.data)
    published.set(r.entity_type, forType)
  }

  // NOTHING PUBLISHED → CHANGE NOTHING. Without this the function read "no published
  // rows" as "every draft row was added since the publish" and deleted the lot — on a
  // site that has never published, that is the manager's entire body of work, with no
  // snapshot anywhere to restore it from. It destroyed Juniper's styling on 2026-08-14,
  // in the first minute this shipped. The caller falls back to undoing the session.
  //
  // The same guard PER TYPE, below, for the narrower version of the same trap: an artist
  // who published before a type existed (site_styles arrived long after the log did) has
  // no revisions for it, and deleting every row of it would be the same wipe one table
  // down. Leaving a row that was added since a publish is a visible, one-click mistake;
  // deleting a table's worth of work is not.
  const hasPublished = (latest ?? []).length > 0
  if (!hasPublished) return { restored: 0, removed: 0, readded: 0, hasPublished: false }

  let restored = 0
  let removed = 0
  let readded = 0

  for (const { type, columns, absent } of EDITOR_RESTORE) {
    const wanted = published.get(type)
    // No published rows of this type: see the note above — skip it rather than read the
    // absence as "delete everything".
    if (!wanted) continue
    const table = PUBLISHABLE[type].table
    const live = await listContent(supabase, type, artistId)
    const liveIds = new Set(live.map((row) => String(row.id)))

    for (const row of live) {
      const id = String(row.id)
      const snapshot = wanted.get(id)
      if (snapshot) {
        // Only the columns that actually differ: a no-op UPDATE would still bump
        // updated_at on every row of every publish-clean site.
        const patch: Record<string, unknown> = {}
        for (const col of columns) {
          const next = snapshot[col] ?? null
          if ((row as Record<string, unknown>)[col] !== next) patch[col] = next
        }
        if (Object.keys(patch).length === 0) continue
        const { error } = await supabase.from(table).update(patch).eq('id', id).eq('artist_id', artistId)
        if (error) throw new Error(error.message)
        restored++
        continue
      }
      if (absent === 'delete') {
        const { error } = await supabase.from(table).delete().eq('id', id).eq('artist_id', artistId)
        if (error) throw new Error(error.message)
        removed++
      } else if ((row as Record<string, unknown>).site_role != null) {
        const { error } = await supabase.from(table).update({ site_role: null }).eq('id', id).eq('artist_id', artistId)
        if (error) throw new Error(error.message)
        removed++
      }
    }

    // Rows deleted since the publish. Only for types the editor creates whole — a photo
    // whose FILE is gone cannot be brought back by re-inserting its row.
    if (absent !== 'delete') continue
    for (const [id, snapshot] of wanted) {
      if (liveIds.has(id)) continue
      const insert: Record<string, unknown> = { id, artist_id: artistId }
      for (const col of columns) insert[col] = snapshot[col] ?? null
      const { error } = await supabase.from(table).insert(insert)
      if (error) throw new Error(error.message)
      readded++
    }
  }

  // `hasPublished` lets the caller tell "the draft already matches the published site"
  // (nothing to do) from "there is no published site to go back to" (fall back to undoing
  // the session) — both of which otherwise look identical: zero changes.
  return { restored, removed, readded, hasPublished }
}

export async function publishContent(
  supabase: SupabaseClient,
  type: PublishableEntity,
  artistId: string,
  publishedBy?: string,
): Promise<number> {
  const rows = await listContent(supabase, type, artistId)
  const liveIds = new Set(rows.map((row) => row.id))

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
  const { data: latest, error: pubErr } = await supabase.rpc('latest_revisions', { p_artist_id: artistId })
  if (pubErr) throw new Error(pubErr.message)

  const tombstoneIds = ((latest ?? []) as { entity_type: string; entity_id: string | null; data: Record<string, unknown> }[])
    .filter(
      (r) =>
        r.entity_type === type &&
        r.entity_id !== null &&
        r.data._deleted !== true && // already tombstoned — writing another is the growth spiral
        !liveIds.has(r.entity_id),
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
  for (const r of (latest ?? []) as { entity_type: string; entity_id: string | null; data: Record<string, unknown> }[]) {
    if (r.entity_type === type && r.entity_id) currentSnapshot.set(r.entity_id, stableJson(r.data))
  }

  const revisions = [
    ...rows
      .map((row) => ({ row, data: publicSnapshot(type, row) }))
      // Compared through stableJson because the stored copy comes back from JSONB with
      // its keys in Postgres's order, not the order publicSnapshot wrote them.
      .filter(({ row, data }) => currentSnapshot.get(String(row.id)) !== stableJson(data))
      .map(({ row, data }) => ({
        artist_id: artistId,
        entity_type: type,
        entity_id: row.id,
        data,
        published_by: publishedBy ?? null,
      })),
    ...tombstoneIds.map((id) => ({
      artist_id: artistId,
      entity_type: type,
      entity_id: id,
      data: { _deleted: true } as Record<string, unknown>,
      published_by: publishedBy ?? null,
    })),
  ]

  if (revisions.length === 0) return 0
  const { error } = await supabase.from('revisions').insert(revisions)
  if (error) throw new Error(error.message)
  return revisions.length
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

  const { error: insErr } = await supabase.from('revisions').insert({
    artist_id: artistId,
    entity_type: 'artist',
    entity_id: artistId,
    data,
    published_by: publishedBy ?? null,
  })
  if (insErr) throw new Error(insErr.message)
}

/** Publish everything for an artist: every content type + media, THEN the
 *  profile. The profile is published LAST because a site is "live" exactly when
 *  its profile snapshot exists — so a partial failure mid-publish never flips a
 *  never-published site live with empty content. */
export async function publishAll(
  supabase: SupabaseClient,
  artistId: string,
  publishedBy?: string,
): Promise<number> {
  const types = Object.keys(PUBLISHABLE) as PublishableEntity[]
  let total = 0
  for (const type of types) {
    total += await publishContent(supabase, type, artistId, publishedBy)
  }
  await publishProfile(supabase, artistId, publishedBy)
  return total
}

/** Pending changes for one section: counts + a convenience `dirty` flag. */
export type SectionDiff = { added: number; edited: number; deleted: number; dirty: boolean }
/** Per-section pending changes for an artist (profile + every publishable type). */
export type UnpublishedDiff = { profile: SectionDiff } & Record<PublishableEntity, SectionDiff>

const emptyDiff = (): SectionDiff => ({ added: 0, edited: 0, deleted: 0, dirty: false })

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
  types.forEach((type, i) => {
    const d = (result[type] = emptyDiff())
    const working = new Map(rowsByType[i].map((r) => [r.id, publicSnapshot(type, r)]))

    for (const [id, snap] of working) {
      const pub = latest.get(`${type}:${id}`)
      if (!pub || pub._deleted === true) d.added++
      else if (!sameSnapshot(PUBLISHABLE[type].snapshot, snap, pub, SNAPSHOT_DEFAULTS[type] ?? {})) d.edited++
    }
    for (const [key, data] of latest) {
      if (!key.startsWith(`${type}:`) || data._deleted === true) continue
      const id = key.slice(type.length + 1)
      if (!working.has(id)) d.deleted++
    }
    d.dirty = d.added + d.edited + d.deleted > 0
  })

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
