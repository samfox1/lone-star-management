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
export type LiveToggleKind = 'photo' | 'track' | 'link' | 'video' | 'tour'
export const LIVE_TOGGLE: Record<LiveToggleKind, PublishableEntity> = {
  photo: 'media',
  track: 'track',
  link: 'link',
  video: 'video',
  tour: 'tour_date',
}

/**
 * PUBLISH-RECONCILED types: their on-site set is chosen behind the password gate as a
 * SELECTION, and `reconcileOnSite` makes the live set exactly that selection at publish
 * — anything absent is taken off the site.
 *
 * Only release and merch: the editor cannot pick either yet, so nothing competes with
 * the reconcile. Giving one an editor picker means MOVING it to LIVE_TOGGLE first.
 */
export type OnSiteEntity = 'release' | 'merch'
export const ON_SITE_ENTITIES: readonly OnSiteEntity[] = ['release', 'merch']

/** LIVE-TOGGLE types that publish their OWN content from their own page — snapshot
 *  only, NEVER reconciled (presence is already live). `publishEntityAction` takes this,
 *  so a reconcile type (release / merch) is a COMPILE error there and can't silently
 *  skip `reconcileOnSite` (ADR 0009). The other live-toggle types publish elsewhere:
 *  photo(media) via the Site publish, track with releases, link via a section publish. */
export type LiveTogglePublishable = 'video' | 'tour_date'

/** Every entity that is snapshotted into `revisions` and reconciled on publish.
 *  Media + site_content are published here but have no generic CRUD form (each
 *  has its own bespoke editor). The artist PROFILE is published separately as a
 *  singleton (publishProfile). */
export type PublishableEntity = CrudEntity | 'media' | 'site_content' | 'site_styles'

/** Fan-visible artist-profile columns that publish together as one snapshot.
 *  Deliberately excludes config/secret columns (shopify_domain, bandsintown_name)
 *  so they can never reach the public read path. */
export const ARTIST_SNAPSHOT = [
  'name',
  'bio',
  'hero_image_url',
  'template',
  'spotify_artist_id',
] as const

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
  track: { fields: ['title', 'cover_url', 'stream_url', 'sort_order'], required: ['title'] },
  // `support` (the other acts on the bill) is an ARRAY field: it posts one FormData
  // entry per tag, so the actions read it with getAll (see ARRAY_FIELDS).
  // Nothing is required — a date can be added before its date is known (a TBA row);
  // `date` became nullable in 20260716120000. `required` here only governs which
  // columns are never cleared to null on edit, so an empty list lets date be cleared.
  tour_date: { fields: ['date', 'venue', 'city', 'state', 'country', 'ticket_url', 'support', 'is_past'], required: [] },
  merch: { fields: ['title', 'image_url', 'price', 'url'], required: ['title'] },
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
    snapshot: ['id', 'title', 'cover_url', 'stream_url', 'provider_url', 'apple_url', 'soundcloud_url', 'audio_path', 'sort_order', 'featured_artists', 'album_name', 'release_id', 'source', 'spotify_id', 'apple_id', 'deezer_id', 'released'],
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
    snapshot: ['id', 'title', 'image_url', 'price', 'url', 'created_at'],
    orderBy: ['created_at'],
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
    snapshot: ['id', 'title', 'provider', 'embed_url', 'storage_path', 'is_short', 'sort_order', 'site_role'],
    orderBy: ['sort_order', 'created_at'],
  },
  release: {
    table: 'releases',
    // source + spotify_id: provenance for the doors' Released/Unreleased check.
    snapshot: ['id', 'title', 'slug', 'cover_url', 'release_date', 'release_type', 'links', 'sort_order', 'source', 'spotify_id', 'released'],
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
    snapshot: ['purpose', 'storage_path', 'sort_order', 'created_at', 'on_site', 'orientation', 'site_role'],
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

/**
 * Reconcile which of an artist's items (of an on-site-gated type) are live on the
 * public site. `onSiteIds` is the desired on-site set: rows in it are shown
 * (`on_site=true`), all others are hidden. Only rows that actually change are
 * written. RLS scopes every write to the caller's tenant, so this can't touch
 * another artist's rows. Returns how many flipped each way. (The public-facing gate
 * is this `on_site` flag; see get_public_site / get_public_releases / get_release.)
 */
export async function reconcileOnSite(
  supabase: SupabaseClient,
  type: OnSiteEntity,
  artistId: string,
  onSiteIds: string[],
): Promise<{ shown: number; hidden: number }> {
  const table = PUBLISHABLE[type].table
  const wanted = new Set(onSiteIds)
  // Releases have a Released/Unreleased split; only Released ones are exposed by
  // the on-site UI, so scope reconcile to them. Otherwise an Unreleased release
  // (never in `onSiteIds`) gets written on_site=false on every publish — a
  // latent trap once it's later promoted to Released.
  const scopeToReleased = type === 'release'
  const cols = scopeToReleased ? 'id, on_site, source, spotify_id, links, released' : 'id, on_site'
  const { data, error } = await supabase.from(table).select(cols).eq('artist_id', artistId)
  if (error) throw new Error(error.message)
  // `cols` is a runtime string, so the typed builder can't infer the row shape.
  const rows = (data ?? []) as unknown as OnSiteRow[]

  const scoped = scopeToReleased
    ? rows.filter((r) => releaseBucket(r as unknown as ReleaseProvenance) === 'released')
    : rows

  const toShow = scoped.filter((r) => !r.on_site && wanted.has(r.id as string)).map((r) => r.id)
  const toHide = scoped.filter((r) => r.on_site && !wanted.has(r.id as string)).map((r) => r.id)

  if (toShow.length) {
    const { error: e } = await supabase
      .from(table)
      .update({ on_site: true })
      .in('id', toShow)
      .eq('artist_id', artistId)
    if (e) throw new Error(e.message)
  }
  if (toHide.length) {
    const { error: e } = await supabase
      .from(table)
      .update({ on_site: false })
      .in('id', toHide)
      .eq('artist_id', artistId)
    if (e) throw new Error(e.message)
  }
  return { shown: toShow.length, hidden: toHide.length }
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
export async function publishContent(
  supabase: SupabaseClient,
  type: PublishableEntity,
  artistId: string,
  publishedBy?: string,
): Promise<number> {
  const rows = await listContent(supabase, type, artistId)
  const liveIds = new Set(rows.map((row) => row.id))

  // entity_ids already published for this (artist, type). RLS scopes this read
  // to the caller's own artist (revisions_rw policy).
  const { data: published, error: pubErr } = await supabase
    .from('revisions')
    .select('entity_id')
    .eq('artist_id', artistId)
    .eq('entity_type', type)
    .not('entity_id', 'is', null)
  if (pubErr) throw new Error(pubErr.message)

  const publishedIds = new Set((published ?? []).map((r) => r.entity_id as string))
  const tombstoneIds = [...publishedIds].filter((id) => !liveIds.has(id))

  const revisions = [
    ...rows.map((row) => ({
      artist_id: artistId,
      entity_type: type,
      entity_id: row.id,
      data: publicSnapshot(type, row),
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

/** Compare two snapshots key-by-key (jsonb key order isn't stable, so don't
 *  stringify whole objects). null and missing are equal. */
function sameSnapshot(
  keys: readonly string[],
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  for (const k of keys) {
    if (JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null)) return false
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
      else if (!sameSnapshot(PUBLISHABLE[type].snapshot, snap, pub)) d.edited++
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
  else if (!sameSnapshot(ARTIST_SNAPSHOT, artistRes.data as unknown as Record<string, unknown>, profilePub)) p.edited = 1
  p.dirty = p.added + p.edited + p.deleted > 0

  return result
}
