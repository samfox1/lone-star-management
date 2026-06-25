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
import type { DeezerTrackInput } from '@/lib/deezer'
import type { AppleTrackInput } from '@/lib/apple'
import type { BandsintownTourDate } from '@/lib/bandsintown'
import type { TicketmasterTourDate } from '@/lib/ticketmaster'
import type { ShopifyMerch } from '@/lib/shopify'

export type SyncError = { externalId: string; op: 'insert' | 'update'; message: string }

export type SyncResult = {
  added: number
  updated: number
  skipped: number
  /** Rows that errored at write time. 0 on a fully clean sync. */
  failed: number
  /** Per-item failures, in encounter order. Empty on a fully clean sync. */
  errors: SyncError[]
}

/** Postgres RLS / authorization denial — a hard contract breach, never partial. */
const RLS_DENIED = '42501'

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

  // Upstream can repeat an externalId; collapse to one item, last-wins, so we
  // never insert the same row twice or fight ourselves on updates.
  const deduped = Array.from(new Map(items.map((i) => [i.externalId, i])).values())

  let added = 0
  let updated = 0
  let skipped = 0
  const errors: SyncError[] = []

  for (const item of deduped) {
    const match = byExternalId.get(item.externalId)

    // New row: insert one at a time so a single bad row (e.g. a value that
    // overflows the column) fails only itself, not the whole batch. A
    // permission denial is fatal (a security breach, not a flaky upstream row).
    if (!match) {
      const { error } = await supabase.from(table).insert({
        artist_id: artistId,
        ...item.values,
        [externalIdCol]: item.externalId,
        source,
      })
      if (error) {
        if (error.code === RLS_DENIED) throw new Error(error.message)
        errors.push({ externalId: item.externalId, op: 'insert', message: error.message })
      } else added++
      continue
    }

    // Only refresh rows this provider owns; never clobber a manual edit (or a
    // row owned by a different provider).
    if (match.source !== source) {
      skipped++
      continue
    }

    const { error } = await supabase.from(table).update(item.values).eq('id', match.id)
    if (error) {
      if (error.code === RLS_DENIED) throw new Error(error.message)
      errors.push({ externalId: item.externalId, op: 'update', message: error.message })
    } else updated++
  }

  return { added, updated, skipped, failed: errors.length, errors }
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

/** Apple Music is a metadata + link-out catalog source (no hosted audio). */
export function syncAppleTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: AppleTrackInput[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'tracks',
    externalIdCol: 'apple_id',
    source: 'apple',
    artistId,
    items: tracks.map((t) => ({
      externalId: t.apple_id,
      values: { title: t.title, cover_url: t.cover_url, provider_url: t.provider_url },
    })),
  })
}

/** Deezer is a metadata + link-out source: no stream_url, a provider_url link. */
export function syncDeezerTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: DeezerTrackInput[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'tracks',
    externalIdCol: 'deezer_id',
    source: 'deezer',
    artistId,
    items: tracks.map((t) => ({
      externalId: t.deezer_id,
      values: { title: t.title, cover_url: t.cover_url, provider_url: t.provider_url },
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

export function syncTicketmasterTourDates(
  supabase: SupabaseClient,
  artistId: string,
  events: TicketmasterTourDate[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'tour_dates',
    externalIdCol: 'ticketmaster_id',
    source: 'ticketmaster',
    artistId,
    items: events.map((e) => ({
      externalId: e.ticketmaster_id,
      values: { date: e.date, venue: e.venue, city: e.city, country: e.country, ticket_url: e.ticket_url },
    })),
  })
}

/**
 * Shopify sends price as a raw string ('25.00'); merch.price is numeric(10,2).
 * Coerce like the manual path (Number + isFinite); drop a non-numeric price to
 * null rather than letting it abort the row. A numerically valid but too-large
 * value still errors at the DB and is reported in SyncResult.errors.
 */
function coercePrice(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function syncShopifyMerch(
  supabase: SupabaseClient,
  artistId: string,
  products: ShopifyMerch[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'merch',
    externalIdCol: 'shopify_product_id',
    source: 'shopify',
    artistId,
    items: products.map((p) => ({
      externalId: p.shopify_product_id,
      values: { title: p.title, image_url: p.image_url, price: coercePrice(p.price), url: p.url },
    })),
  })
}
