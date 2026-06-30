import { createClient } from '@/lib/supabase/server'
import { RosterShell } from '../roster-chrome'
import { ownedArtists, rosterAnalytics } from '../roster-data'
import { RosterView, type ArtistStat } from '../roster-view'
import type { RosterTotals } from '../stats-panel'

export const metadata = { title: 'Your artists — Lone Star Management' }

export default async function RosterPage() {
  const supabase = await createClient()

  // The proxy guarantees a session here, but read the user for the header.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // RLS scopes this to only the artists this manager manages (admins see all).
  const artists = await ownedArtists(supabase)

  // Pending build requests show as "Site in progress" cards. Tolerate only the
  // "table not migrated yet" case (42P01) by degrading to none; a real DB/RLS
  // failure must surface, not silently render as "no pending".
  const { data: requests, error: requestsError } = await supabase
    .from('artist_requests')
    .select('id, name, handle')
    .in('status', ['requested', 'in_build'])
    .order('created_at', { ascending: false })
  if (requestsError && requestsError.code !== '42P01') throw requestsError
  const pending = requests ?? []

  // Real last-30-day traction per artist (rolled up from the same RPC the artist
  // Overview uses) — drives the cards, popover, and stats panel.
  const { byArtist, totals: t, leaderboard } = await rosterAnalytics(supabase, artists)
  const stats: Record<string, ArtistStat> = {}
  for (const a of artists) {
    const e = byArtist[a.id]
    stats[a.id] = { views: e?.views ?? 0, plays: e?.plays ?? 0, linkClicks: e?.linkClicks ?? 0 }
  }

  const totals: RosterTotals = {
    artists: artists.length,
    pending: pending.length,
    views: t.views,
    plays: t.plays,
    linkClicks: t.linkClicks,
  }
  const top = leaderboard[0] ? { name: leaderboard[0].name, views: leaderboard[0].views } : null

  return (
    <RosterShell active="roster" page="Roster" email={user?.email ?? null}>
      <RosterView artists={artists} pending={pending} stats={stats} totals={totals} top={top} />
    </RosterShell>
  )
}
