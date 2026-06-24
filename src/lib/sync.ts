/**
 * Sync external catalog data into a tenant's working rows, honoring the conflict
 * policy (PLAN #6): insert items we haven't seen, refresh rows we own
 * (source = this provider), and NEVER overwrite a manager's hand edit (source
 * flips to 'manual' the moment a human touches a row — and a row owned by a
 * different provider is left alone too). All writes go through the caller's
 * RLS-scoped client, so a sync can only ever write into its own artist.
 *
 * The network clients (spotify/bandsintown) are kept separate: routes fetch the
 * items and hand them here, so this pure DB step is testable against a real
 * database without touching any external API.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SpotifyTrackInput } from '@/lib/spotify'
import type { BandsintownTourDate } from '@/lib/bandsintown'

export type SyncResult = { added: number; updated: number; skipped: number }

/** One incoming external item: its stable id + the columns to write. */
type ExternalItem = { externalId: string; values: Record<string, unknown> }

type SyncSpec = {
  table: string
  /** Column holding the provider's stable id (e.g. spotify_id). Trusted constant. */
  externalIdCol: string
  /** The `source` value this provider owns (e.g. 'spotify'). */
  source: string
  artistId: string
  items: ExternalItem[]
}

async function syncExternal(supabase: SupabaseClient, spec: SyncSpec): Promise<SyncResult> {
  const { table, externalIdCol, source, artistId, items } = spec

  const { data: existing, error: listErr } = await supabase
    .from(table)
    .select(`id, source, ${externalIdCol}`)
    .eq('artist_id', artistId)
  if (listErr) throw new Error(listErr.message)

  // The dynamic select string defeats supabase-js's row-type inference, so read
  // the rows as plain records.
  const rows = (existing ?? []) as unknown as Record<string, unknown>[]
  const byExternalId = new Map<string, { id: string; source: string }>()
  for (const row of rows) {
    const ext = row[externalIdCol] as string | null
    if (ext) byExternalId.set(ext, { id: row.id as string, source: row.source as string })
  }

  const toInsert: Record<string, unknown>[] = []
  let updated = 0
  let skipped = 0

  for (const item of items) {
    const match = byExternalId.get(item.externalId)

    if (!match) {
      toInsert.push({
        artist_id: artistId,
        ...item.values,
        [externalIdCol]: item.externalId,
        source,
      })
      continue
    }

    // Only refresh rows this provider owns; never clobber a manual edit (or a
    // row owned by a different provider).
    if (match.source !== source) {
      skipped++
      continue
    }

    const { error } = await supabase.from(table).update(item.values).eq('id', match.id)
    if (error) throw new Error(error.message)
    updated++
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from(table).insert(toInsert)
    if (error) throw new Error(error.message)
  }

  return { added: toInsert.length, updated, skipped }
}

export function syncSpotifyTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: SpotifyTrackInput[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'tracks',
    externalIdCol: 'spotify_id',
    source: 'spotify',
    artistId,
    items: tracks.map((t) => ({
      externalId: t.spotify_id,
      values: { title: t.title, cover_url: t.cover_url, stream_url: t.stream_url },
    })),
  })
}

export function syncBandsintownTourDates(
  supabase: SupabaseClient,
  artistId: string,
  events: BandsintownTourDate[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'tour_dates',
    externalIdCol: 'bandsintown_id',
    source: 'bandsintown',
    artistId,
    items: events.map((e) => ({
      externalId: e.bandsintown_id,
      values: { date: e.date, venue: e.venue, city: e.city, country: e.country, ticket_url: e.ticket_url },
    })),
  })
}
