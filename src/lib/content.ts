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

export type EntityType = 'track' | 'tour_date' | 'merch' | 'link'

export type ContentRow = Record<string, unknown> & {
  id: string
  artist_id: string
}

type EntityConfig = {
  table: string
  /** Columns a manager may set on create/update (everything else is ignored). */
  fields: string[]
  /** Public-safe columns copied into a published revision. */
  snapshot: string[]
  /** Ordering for list/snapshot. */
  orderBy: string[]
}

export const ENTITIES: Record<EntityType, EntityConfig> = {
  track: {
    table: 'tracks',
    fields: ['title', 'cover_url', 'stream_url', 'sort_order'],
    snapshot: ['id', 'title', 'cover_url', 'stream_url', 'sort_order'],
    orderBy: ['sort_order', 'created_at'],
  },
  tour_date: {
    table: 'tour_dates',
    fields: ['date', 'venue', 'city', 'country', 'ticket_url'],
    snapshot: ['id', 'date', 'venue', 'city', 'country', 'ticket_url'],
    orderBy: ['date'],
  },
  merch: {
    table: 'merch',
    fields: ['title', 'image_url', 'price', 'url'],
    snapshot: ['id', 'title', 'image_url', 'price', 'url'],
    orderBy: ['created_at'],
  },
  link: {
    table: 'links',
    fields: ['label', 'url', 'sort_order'],
    snapshot: ['id', 'label', 'url', 'sort_order'],
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

/** Snapshot every working row of one type into `revisions`. Returns the count. */
export async function publishContent(
  supabase: SupabaseClient,
  type: EntityType,
  artistId: string,
  publishedBy?: string,
): Promise<number> {
  const rows = await listContent(supabase, type, artistId)
  if (rows.length === 0) return 0
  const revisions = rows.map((row) => ({
    artist_id: artistId,
    entity_type: type,
    entity_id: row.id,
    data: publicSnapshot(type, row),
    published_by: publishedBy ?? null,
  }))
  const { error } = await supabase.from('revisions').insert(revisions)
  if (error) throw new Error(error.message)
  return revisions.length
}

/** Publish every content type for an artist. Returns total rows snapshotted. */
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
  return total
}
