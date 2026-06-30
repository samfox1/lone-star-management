import { logout } from '@/app/auth-actions'
import { createClient } from '@/lib/supabase/server'
import { AppShell, Wordmark } from '@/components/ui/app-shell'
import { Avatar, Button, initials } from '@/components/ui/ui'
import { RosterView, type ArtistStat } from './roster-view'
import type { RosterTotals } from './stats-panel'

export const metadata = { title: 'Your artists — Lone Star Management' }

function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
}

export default async function Home() {
  const supabase = await createClient()

  // The proxy guarantees a session here, but read the user for the header.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // RLS scopes this to only the artists this manager manages (admins see all).
  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, name, slug')
    .order('name')

  // A failed read must never look like an empty result on the security gate.
  if (error) throw error

  // Pending build requests show as "Site in progress" cards. Tolerate only the
  // "table not migrated yet" case (42P01) by degrading to none; a real DB/RLS
  // failure must surface, not silently render as "no pending".
  const { data: requests, error: requestsError } = await supabase
    .from('artist_requests')
    .select('id, name, handle')
    .in('status', ['requested', 'in_build'])
    .order('created_at', { ascending: false })
  if (requestsError && requestsError.code !== '42P01') throw requestsError

  const list = artists ?? []
  const pending = requests ?? []

  // Real last-30-day traction per artist (the same exact group-by RPC the artist
  // Overview uses). One call per owned artist, in parallel — the roster is small.
  const since = thirtyDaysAgoIso()
  const stats: Record<string, ArtistStat> = {}
  await Promise.all(
    list.map(async (a) => {
      const { data } = await supabase.rpc('analytics_summary', { p_artist_id: a.id, p_since: since })
      const c: Record<string, number> = {}
      for (const r of (data ?? []) as { type: string; count: number }[]) c[r.type] = Number(r.count)
      stats[a.id] = { views: c.view ?? 0, plays: c.play ?? 0, linkClicks: c.link_click ?? 0 }
    }),
  )

  const totals: RosterTotals = {
    artists: list.length,
    pending: pending.length,
    views: list.reduce((n, a) => n + (stats[a.id]?.views ?? 0), 0),
    plays: list.reduce((n, a) => n + (stats[a.id]?.plays ?? 0), 0),
    linkClicks: list.reduce((n, a) => n + (stats[a.id]?.linkClicks ?? 0), 0),
  }
  const top = list
    .map((a) => ({ name: a.name, views: stats[a.id]?.views ?? 0 }))
    .sort((x, y) => y.views - x.views)[0] ?? null

  const isAdmin = user?.app_metadata?.role === 'admin'

  const tools = (
    <>
      <form action={logout}>
        <Button variant="ghost" type="submit">
          Sign out
        </Button>
      </form>
      <Avatar initials={initials(user?.email ?? '?')} size={30} title={user?.email ?? undefined} />
    </>
  )

  return (
    <AppShell brand={<Wordmark page="Roster" />} items={[]} tools={tools}>
      <RosterView
        artists={list}
        pending={pending}
        stats={stats}
        totals={totals}
        top={top}
        subtitle={isAdmin ? 'Admin — every artist on the platform.' : 'The artists you manage.'}
      />
    </AppShell>
  )
}
