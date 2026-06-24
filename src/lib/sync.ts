/**
 * Sync external catalog data into a tenant's working rows, honoring the conflict
 * policy (PLAN #6): insert tracks we haven't seen, refresh rows we own
 * (source='spotify'), and NEVER overwrite a manager's hand edit (source flips to
 * 'manual' the moment a human touches a row). All writes go through the caller's
 * RLS-scoped client, so a sync can only ever write into its own artist.
 *
 * The network client (spotifyClient) is kept separate: routes fetch the tracks
 * and hand them here, so this pure DB step is testable against a real database
 * without touching Spotify.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SpotifyTrackInput } from '@/lib/spotify'
import { listContent } from '@/lib/content'

export type SyncResult = { added: number; updated: number; skipped: number }

export async function syncSpotifyTracks(
  supabase: SupabaseClient,
  artistId: string,
  incoming: SpotifyTrackInput[],
): Promise<SyncResult> {
  const existing = await listContent(supabase, 'track', artistId)
  const bySpotifyId = new Map<string, { id: string; source: string }>()
  for (const row of existing) {
    const sid = row.spotify_id as string | null
    if (sid) bySpotifyId.set(sid, { id: row.id, source: row.source as string })
  }

  const toInsert: Record<string, unknown>[] = []
  let updated = 0
  let skipped = 0

  for (const track of incoming) {
    const match = bySpotifyId.get(track.spotify_id)

    if (!match) {
      toInsert.push({
        artist_id: artistId,
        title: track.title,
        cover_url: track.cover_url,
        stream_url: track.stream_url,
        spotify_id: track.spotify_id,
        source: 'spotify',
      })
      continue
    }

    // A human-edited row (source !== 'spotify') is never overwritten by a sync.
    if (match.source !== 'spotify') {
      skipped++
      continue
    }

    const { error } = await supabase
      .from('tracks')
      .update({
        title: track.title,
        cover_url: track.cover_url,
        stream_url: track.stream_url,
      })
      .eq('id', match.id)
    if (error) throw new Error(error.message)
    updated++
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('tracks').insert(toInsert)
    if (error) throw new Error(error.message)
  }

  return { added: toInsert.length, updated, skipped }
}
