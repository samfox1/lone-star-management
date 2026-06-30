import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { compactNumber } from '@/lib/format'
import { KLabel } from '@/components/ui/ui'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists, rosterAnalytics, type ArtistEvents } from '../roster-data'

export const metadata = { title: 'Analytics — Lone Star Management' }

const KPIS: { key: keyof ArtistEvents; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'plays', label: 'Plays' },
  { key: 'linkClicks', label: 'Link clicks' },
  { key: 'ticketClicks', label: 'Ticket clicks' },
  { key: 'buyClicks', label: 'Buy clicks' },
]

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const { totals, leaderboard } = await rosterAnalytics(supabase, artists)
  const maxViews = leaderboard[0]?.views ?? 0

  return (
    <RosterShell active="analytics" page="Analytics" email={user?.email ?? null}>
      <SectionToolbar title="Analytics" />
      {artists.length === 0 ? (
        <EmptyState
          icon="analytics"
          title="No analytics yet"
          sub="Request your first artist — once their site is live, roster-wide traction shows up here."
        />
      ) : (
        <div className="px-7 pb-12">
          <KLabel>Roster · last 30 days</KLabel>
          <div className="mt-3 flex flex-wrap gap-y-6 border-b border-hairline pb-7">
            {KPIS.map((k) => (
              <div
                key={k.key}
                className="min-w-[120px] flex-1 border-hairline pr-9 [&:not(:last-child)]:mr-9 [&:not(:last-child)]:border-r"
              >
                <div className="font-space text-[25px] font-bold tabular-nums tracking-[-0.02em]">
                  {compactNumber(totals[k.key])}
                </div>
                <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                  {k.label}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-10 md:grid-cols-[1.25fr_1fr]">
            <div>
              <KLabel>Top artists by views · 30 days</KLabel>
              <div className="mt-3">
                {maxViews === 0 ? (
                  <p className="rounded-xl border border-dashed border-hairline px-4 py-8 text-center font-space text-xs text-ink-muted">
                    No site views in the last 30 days yet.
                  </p>
                ) : (
                  leaderboard.map((a, i) => (
                    <Link
                      key={a.id}
                      href={`/artists/${a.id}`}
                      className="group block border-t border-hairline py-3 first:border-t-0"
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="w-5 font-space text-xs text-ink-faint">{i + 1}</span>
                        <span className="text-sm font-semibold group-hover:text-accent">{a.name}</span>
                        <span className="ml-auto font-space text-xs text-ink-muted">
                          {compactNumber(a.views)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-track">
                        <span
                          className="block h-full bg-ink"
                          style={{ width: `${Math.max(2, Math.round((a.views / maxViews) * 100))}%` }}
                        />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div>
              <KLabel>Daily trends</KLabel>
              <div className="mt-3 rounded-xl border border-dashed border-hairline p-5 font-space text-xs leading-relaxed text-ink-muted">
                Day-by-day and streaming trends appear here once each artist connects a streaming
                source and builds up history. For now we report exact last-30-day site events.
              </div>
            </div>
          </div>
        </div>
      )}
    </RosterShell>
  )
}
