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

export type EntityType = 'track' | 'tour_date' | 'merch' | 'link' | 'media'

/** Content types edited via the generic dashboard CRUD (media has its own
 *  uploader but is still versioned through the publish layer). */
export type CrudEntity = Exclude<EntityType, 'media'>

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

type EntityConfig = {
  table: string
  /** Columns a manager may set on create/update (everything else is ignored). */
  fields: string[]
  /** NOT NULL columns — never cleared to null on edit. */
  required: string[]
  /** Public-safe columns copied into a published revision. */
  snapshot: string[]
  /** Ordering for list/snapshot. */
  orderBy: string[]
}

export const ENTITIES: Record<EntityType, EntityConfig> = {
  track: {
    table: 'tracks',
    fields: ['title', 'cover_url', 'stream_url', 'sort_order'],
    required: ['title'],
    snapshot: ['id', 'title', 'cover_url', 'stream_url', 'sort_order'],
    orderBy: ['sort_order', 'created_at'],
  },
  tour_date: {
    table: 'tour_dates',
    fields: ['date', 'venue', 'city', 'country', 'ticket_url'],
    required: ['date'],
    snapshot: ['id', 'date', 'venue', 'city', 'country', 'ticket_url'],
    orderBy: ['date'],
  },
  merch: {
    table: 'merch',
    fields: ['title', 'image_url', 'price', 'url'],
    required: ['title'],
    // created_at is snapshotted so the public site can order merch the same way
    // the dashboard/preview does (by creation order).
    snapshot: ['id', 'title', 'image_url', 'price', 'url', 'created_at'],
    orderBy: ['created_at'],
  },
  link: {
    table: 'links',
    fields: ['label', 'url', 'sort_order'],
    required: ['label', 'url'],
    snapshot: ['id', 'label', 'url', 'sort_order'],
    orderBy: ['sort_order', 'created_at'],
  },
  // Media is not edited via the generic content CRUD (it has its own uploader),
  // but it IS versioned/published through the same reconcile loop.
  media: {
    table: 'media',
    fields: [],
    required: [],
    // created_at is snapshotted so the public site orders media exactly like the
    // dashboard/preview (stable secondary key after sort_order).
    snapshot: ['purpose', 'storage_path', 'sort_order', 'created_at'],
    orderBy: ['sort_order', 'created_at'],
  },
}

/** Keep only the editable columns for a type, dropping anything else. */
function pickFields(type: EntityType, input: Record<string, unknown>) {
  const allowed = ENTITIES[type].fields
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in input) out[key] = input[key]
  }
  return out
}

/** The public-safe projection of a row — the shape published and previewed. */
export function publicSnapshot(type: EntityType, row: ContentRow) {
  const out: Record<string, unknown> = {}
  for (const key of ENTITIES[type].snapshot) out[key] = row[key]
  return out
}

export async function listContent(
  supabase: SupabaseClient,
  type: EntityType,
  artistId: string,
): Promise<ContentRow[]> {
  let query = supabase.from(ENTITIES[type].table).select('*').eq('artist_id', artistId)
  for (const col of ENTITIES[type].orderBy) query = query.order(col)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ContentRow[]
}

export async function createContent(
  supabase: SupabaseClient,
  type: EntityType,
  artistId: string,
  input: Record<string, unknown>,
): Promise<ContentRow> {
  const { data, error } = await supabase
    .from(ENTITIES[type].table)
    .insert({ ...pickFields(type, input), artist_id: artistId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as ContentRow
}

export async function updateContent(
  supabase: SupabaseClient,
  type: EntityType,
  id: string,
  input: Record<string, unknown>,
): Promise<ContentRow> {
  const { data, error } = await supabase
    .from(ENTITIES[type].table)
    .update(pickFields(type, input))
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as ContentRow
}

export async function deleteContent(
  supabase: SupabaseClient,
  type: EntityType,
  id: string,
): Promise<void> {
  const { error } = await supabase.from(ENTITIES[type].table).delete().eq('id', id)
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
  type: EntityType,
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
  const types = Object.keys(ENTITIES) as EntityType[]
  let total = 0
  for (const type of types) {
    total += await publishContent(supabase, type, artistId, publishedBy)
  }
  await publishProfile(supabase, artistId, publishedBy)
  return total
}
