/**
 * Tracks data layer — a thin, typed facade over the generic content layer
 * (src/lib/content.ts). Kept as its own module because tracks were the first
 * content type proven end to end; the generic layer now powers all types.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type ContentRow,
  createContent,
  deleteContent,
  listContent,
  publishContent,
  updateContent,
} from '@/lib/content'

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

export function listTracks(supabase: SupabaseClient, artistId: string): Promise<Track[]> {
  return listContent(supabase, 'track', artistId) as Promise<Track[]>
}

export function createTrack(
  supabase: SupabaseClient,
  artistId: string,
  input: TrackInput,
): Promise<Track> {
  return createContent(supabase, 'track', artistId, input) as Promise<Track>
}

export function updateTrack(
  supabase: SupabaseClient,
  trackId: string,
  input: Partial<TrackInput>,
): Promise<Track> {
  return updateContent(supabase, 'track', trackId, input as Record<string, unknown>) as Promise<Track>
}

export function deleteTrack(supabase: SupabaseClient, trackId: string): Promise<void> {
  return deleteContent(supabase, 'track', trackId)
}

export function publishTracks(
  supabase: SupabaseClient,
  artistId: string,
  publishedBy?: string,
): Promise<number> {
  return publishContent(supabase, 'track', artistId, publishedBy)
}

export type { ContentRow }
