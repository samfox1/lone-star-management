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

/** Types a manager edits through the generic dashboard CRUD forms. */
export type CrudEntity = 'track' | 'tour_date' | 'merch' | 'link' | 'video'

/** CRUD types that use the GENERIC dashboard form. Video is a CrudEntity (it has
 *  create/update/delete + a field allowlist) but a BESPOKE editor (the Videos
 *  page, so adds run through embedInfo) — so it's excluded from the generic form. */
export type GenericEntity = Exclude<CrudEntity, 'video'>

/** Every entity that is snapshotted into `revisions` and reconciled on publish.
 *  Media + site_content are published here but have no generic CRUD form (each
 *  has its own bespoke editor). The artist PROFILE is published separately as a
 *  singleton (publishProfile). */
export type PublishableEntity = CrudEntity | 'media' | 'site_content'

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
  tour_date: { fields: ['date', 'venue', 'city', 'country', 'ticket_url'], required: ['date'] },
  merch: { fields: ['title', 'image_url', 'price', 'url'], required: ['title'] },
  link: { fields: ['label', 'url', 'sort_order'], required: ['label', 'url'] },
  // Manual video adds set provider + a normalized embed_url (validated by the
  // add action via embedInfo); the generic update touches title/sort_order.
  video: { fields: ['title', 'provider', 'embed_url', 'sort_order'], required: ['title', 'provider', 'embed_url'] },
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
    snapshot: ['id', 'title', 'cover_url', 'stream_url', 'provider_url', 'audio_path', 'sort_order'],
    orderBy: ['sort_order', 'created_at'],
  },
  tour_date: {
    table: 'tour_dates',
    snapshot: ['id', 'date', 'venue', 'city', 'country', 'ticket_url'],
    orderBy: ['date'],
  },
  merch: {
    table: 'merch',
    snapshot: ['id', 'title', 'image_url', 'price', 'url', 'created_at'],
    orderBy: ['created_at'],
  },
  link: {
    table: 'links',
    snapshot: ['id', 'label', 'url', 'sort_order'],
    orderBy: ['sort_order', 'created_at'],
  },
  video: {
    table: 'videos',
    // Allowlist: youtube_id/source stay server-side, never reach the public site.
    snapshot: ['id', 'title', 'provider', 'embed_url', 'sort_order'],
    orderBy: ['sort_order', 'created_at'],
  },
  media: {
    table: 'media',
    snapshot: ['purpose', 'storage_path', 'sort_order', 'created_at'],
    orderBy: ['sort_order', 'created_at'],
  },
  // Editable site text (key/value). entity_id = row id; the snapshot carries the
  // key→value pair. get_public_site folds these into a {key: value} object.
  site_content: {
    table: 'site_content',
    snapshot: ['id', 'key', 'value'],
    orderBy: ['key'],
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

export async function createContent(
  supabase: SupabaseClient,
  type: CrudEntity,
  artistId: string,
  input: Record<string, unknown>,
): Promise<ContentRow> {
  const { data, error } = await supabase
    .from(PUBLISHABLE[type].table)
    .insert({ ...pickFields(type, input), artist_id: artistId })
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
