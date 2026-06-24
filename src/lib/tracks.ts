/**
 * Tracks data layer. Pure functions over a Supabase client so they can be unit-
 * tested as a real manager (RLS enforces tenant scoping — these never bypass it).
 * Server actions are thin wrappers that build the request-bound client and call
 * these.
 *
 * The publish model (PLAN.md): content tables hold working/draft rows; publishing
 * snapshots them into `revisions`, which the public read path serves.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type Track = {
  id: string
  artist_id: string
  title: string
  cover_url: string | null
  stream_url: string | null
  spotify_id: string | null
  sort_order: number
  source: 'manual' | 'spotify' | 'bandsintown' | 'shopify'
  created_at: string
  updated_at: string
}

export type TrackInput = {
  title: string
  cover_url?: string | null
  stream_url?: string | null
  sort_order?: number
}

/** Public-safe fields only — this is what gets snapshotted into a revision. */
function publicSnapshot(t: Track) {
  return {
    id: t.id,
    title: t.title,
    cover_url: t.cover_url,
    stream_url: t.stream_url,
    sort_order: t.sort_order,
  }
}

export async function listTracks(
  supabase: SupabaseClient,
  artistId: string,
): Promise<Track[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .eq('artist_id', artistId)
    .order('sort_order')
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as Track[]
}

export async function createTrack(
  supabase: SupabaseClient,
  artistId: string,
  input: TrackInput,
): Promise<Track> {
  const { data, error } = await supabase
    .from('tracks')
    .insert({ ...input, artist_id: artistId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Track
}

export async function updateTrack(
  supabase: SupabaseClient,
  trackId: string,
  input: Partial<TrackInput>,
): Promise<Track> {
  const { data, error } = await supabase
    .from('tracks')
    .update(input)
    .eq('id', trackId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Track
}

export async function deleteTrack(
  supabase: SupabaseClient,
  trackId: string,
): Promise<void> {
  const { error } = await supabase.from('tracks').delete().eq('id', trackId)
  if (error) throw new Error(error.message)
}

/**
 * Publish every working track for the artist: insert a public-safe snapshot of
 * each into `revisions`. The public read path serves the latest revision per
 * entity, so this is what makes edits go live. Returns the number snapshotted.
 *
 * RLS scopes both the read and the insert to the caller's tenant, so a manager
 * can only ever publish their own artist.
 */
export async function publishTracks(
  supabase: SupabaseClient,
  artistId: string,
  publishedBy?: string,
): Promise<number> {
  const tracks = await listTracks(supabase, artistId)
  if (tracks.length === 0) return 0

  const rows = tracks.map((t) => ({
    artist_id: artistId,
    entity_type: 'track' as const,
    entity_id: t.id,
    data: publicSnapshot(t),
    published_by: publishedBy ?? null,
  }))

  const { error } = await supabase.from('revisions').insert(rows)
  if (error) throw new Error(error.message)
  return rows.length
}
