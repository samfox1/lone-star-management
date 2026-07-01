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

const DAY_MS = 86_400_000

/** UTC-midnight ms of the first day in an N-day window ending today. */
function windowStartMs(days: number): number {
  const todayMidnight = Math.floor(Date.now() / DAY_MS) * DAY_MS
  return todayMidnight - (days - 1) * DAY_MS
}

type DailyRow = { artist_id: string; day: string; views: number }

/** Bucket daily-view rows into a fixed-length per-day array (0-filled). */
function fillInto(target: number[], rows: DailyRow[], startMs: number, days: number): void {
  for (const r of rows) {
    const idx = Math.round((Date.parse(r.day) - startMs) / DAY_MS)
    if (idx >= 0 && idx < days) target[idx] += Number(r.views)
  }
}

/** Per-artist daily VIEW series + the roster total series over the last `days`. */
export async function rosterDailyViews(
  supabase: SupabaseClient,
  artists: RosterArtist[],
  days = 30,
): Promise<{ byArtist: Record<string, number[]>; total: number[] }> {
  const startMs = windowStartMs(days)
  const { data } = await supabase.rpc('analytics_daily', {
    p_since: new Date(startMs).toISOString(),
  })
  const rows = (data ?? []) as DailyRow[]
  const byArtist: Record<string, number[]> = {}
  for (const a of artists) byArtist[a.id] = new Array(days).fill(0)
  const total = new Array(days).fill(0)
  for (const r of rows) {
    const idx = Math.round((Date.parse(r.day) - startMs) / DAY_MS)
    if (idx < 0 || idx >= days) continue
    const v = Number(r.views)
    if (byArtist[r.artist_id]) byArtist[r.artist_id][idx] += v
    total[idx] += v
  }
  return { byArtist, total }
}

/** One artist's daily VIEW series over the last `days`. */
export async function artistDailyViews(
  supabase: SupabaseClient,
  artistId: string,
  days = 30,
): Promise<number[]> {
  const startMs = windowStartMs(days)
  const { data } = await supabase.rpc('analytics_daily', {
    p_since: new Date(startMs).toISOString(),
    p_artist_id: artistId,
  })
  const series = new Array(days).fill(0)
  fillInto(series, (data ?? []) as DailyRow[], startMs, days)
  return series
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
