import type { SupabaseClient } from '@supabase/supabase-js'
import { listContent, type ContentRow, type CrudEntity } from '@/lib/content'

/**
 * Server helpers for the roster-wide (all-artists) section pages and the roster
 * home. Everything is RLS-scoped to the artists the caller manages (admins see
 * all) — the same `analytics_summary` RPC and `listContent` reads the per-artist
 * dashboard uses, just rolled up. No fabricated data: callers render honest empty
 * states where a real signal doesn't exist.
 */
export type RosterArtist = { id: string; name: string; slug: string }

export type ArtistEvents = {
  views: number
  plays: number
  linkClicks: number
  ticketClicks: number
  buyClicks: number
}

export function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
}

/** Today as YYYY-MM-DD — kept out of render so it isn't an impure call. */
export function todayIso(): string {
  return new Date(Date.now()).toISOString().slice(0, 10)
}

export async function ownedArtists(supabase: SupabaseClient): Promise<RosterArtist[]> {
  const { data, error } = await supabase.from('artists').select('id, name, slug').order('name')
  if (error) throw error
  return (data ?? []) as RosterArtist[]
}

export type RosterAnalytics = {
  byArtist: Record<string, ArtistEvents>
  totals: ArtistEvents
  /** Artists sorted by 30-day views, descending. */
  leaderboard: (RosterArtist & { views: number })[]
}

/** Last-30-day event counts per owned artist + roster totals + a views leaderboard. */
export async function rosterAnalytics(
  supabase: SupabaseClient,
  artists: RosterArtist[],
): Promise<RosterAnalytics> {
  const since = thirtyDaysAgoIso()
  const byArtist: Record<string, ArtistEvents> = {}
  await Promise.all(
    artists.map(async (a) => {
      const { data } = await supabase.rpc('analytics_summary', { p_artist_id: a.id, p_since: since })
      const c: Record<string, number> = {}
      for (const r of (data ?? []) as { type: string; count: number }[]) c[r.type] = Number(r.count)
      byArtist[a.id] = {
        views: c.view ?? 0,
        plays: c.play ?? 0,
        linkClicks: c.link_click ?? 0,
        ticketClicks: c.ticket_click ?? 0,
        buyClicks: c.buy_click ?? 0,
      }
    }),
  )
  const sum = (k: keyof ArtistEvents) => artists.reduce((n, a) => n + (byArtist[a.id]?.[k] ?? 0), 0)
  return {
    byArtist,
    totals: {
      views: sum('views'),
      plays: sum('plays'),
      linkClicks: sum('linkClicks'),
      ticketClicks: sum('ticketClicks'),
      buyClicks: sum('buyClicks'),
    },
    leaderboard: artists
      .map((a) => ({ ...a, views: byArtist[a.id]?.views ?? 0 }))
      .sort((x, y) => y.views - x.views),
  }
}

export type RosterRow = { row: ContentRow; artist: RosterArtist }

/** Flatten one content type across every owned artist, each row tagged with its artist. */
export async function rosterRows(
  supabase: SupabaseClient,
  type: CrudEntity,
  artists: RosterArtist[],
): Promise<RosterRow[]> {
  const lists = await Promise.all(
    artists.map(async (a) => {
      const rows = await listContent(supabase, type, a.id)
      return rows.map((row) => ({ row, artist: a }))
    }),
  )
  return lists.flat()
}
