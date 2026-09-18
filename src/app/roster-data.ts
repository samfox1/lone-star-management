import type { SupabaseClient } from '@supabase/supabase-js'
import { listContent, type ContentRow, type CrudEntity } from '@/lib/content'
import { dayList, sumByDay } from '@/lib/analytics'

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

/**
 * Last-30-day event counts per owned artist + roster totals + a views leaderboard.
 *
 * ONE call: `analytics_summary(p_since, p_artist_id)` grew an optional `p_artist_id`
 * (20260918120000_analytics_summary_optional_artist.sql, CODE_AUDIT.md item J) so a
 * roster page can ask for every owned artist's summary at once instead of firing it once
 * per artist inside `artists.map(async …)` — RLS still scopes a null-artist call to the
 * artists the caller manages, same as `ownedArtists()` and `rosterDailyViews` below.
 */
export async function rosterAnalytics(
  supabase: SupabaseClient,
  artists: RosterArtist[],
): Promise<RosterAnalytics> {
  const since = thirtyDaysAgoIso()
  const { data } = await supabase.rpc('analytics_summary', { p_since: since })
  const counts = new Map<string, Record<string, number>>()
  for (const r of (data ?? []) as { artist_id: string; type: string; count: number }[]) {
    const c = counts.get(r.artist_id) ?? {}
    c[r.type] = Number(r.count)
    counts.set(r.artist_id, c)
  }
  const byArtist: Record<string, ArtistEvents> = {}
  for (const a of artists) {
    const c = counts.get(a.id) ?? {}
    byArtist[a.id] = {
      views: c.view ?? 0,
      plays: c.play ?? 0,
      linkClicks: c.link_click ?? 0,
      ticketClicks: c.ticket_click ?? 0,
      buyClicks: c.buy_click ?? 0,
    }
  }
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

type DailyRow = { artist_id: string; day: string; views: number }

/** Per-artist daily VIEW series + the roster total series over the last `days`.
 *
 * Zero-filled and bucketed by `sumByDay` (lib/analytics) against `dayList`'s day
 * strings — not the ms-epoch index math this used to do independently of
 * `artistDailyViews` below, which is exactly the kind of drift that misplaces a row
 * on a window's edge. See CODE_AUDIT.md item I. */
export async function rosterDailyViews(
  supabase: SupabaseClient,
  artists: RosterArtist[],
  days = 30,
): Promise<{ byArtist: Record<string, number[]>; total: number[] }> {
  const list = dayList(days)
  const { data } = await supabase.rpc('analytics_daily', { p_since: `${list[0]}T00:00:00Z` })
  const rows = (data ?? []) as DailyRow[]
  const byArtistRows = new Map<string, DailyRow[]>()
  for (const r of rows) {
    const arr = byArtistRows.get(r.artist_id) ?? []
    arr.push(r)
    byArtistRows.set(r.artist_id, arr)
  }
  const byArtist: Record<string, number[]> = {}
  for (const a of artists) {
    byArtist[a.id] = sumByDay(byArtistRows.get(a.id) ?? [], list, (r) => r.day, (r) => r.views)
  }
  const total = sumByDay(rows, list, (r) => r.day, (r) => r.views)
  return { byArtist, total }
}

/** One artist's daily VIEW series over the last `days`. */
export async function artistDailyViews(
  supabase: SupabaseClient,
  artistId: string,
  days = 30,
): Promise<number[]> {
  const list = dayList(days)
  const { data } = await supabase.rpc('analytics_daily', {
    p_since: `${list[0]}T00:00:00Z`,
    p_artist_id: artistId,
  })
  return sumByDay((data ?? []) as DailyRow[], list, (r) => r.day, (r) => r.views)
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
