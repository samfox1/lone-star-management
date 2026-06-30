import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { compactNumber } from '@/lib/format'
import { Avatar, KLabel, initials } from '@/components/ui/ui'
import { AreaChart, Sparkline } from '@/components/ui/charts'
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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
/** Last six month abbreviations, kept out of render so it isn't an impure call. */
function lastSixMonths(): string[] {
  const m = new Date(Date.now()).getMonth()
  return Array.from({ length: 6 }, (_, i) => MONTHS[(m - 5 + i + 12) % 12])
}

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const { totals, leaderboard } = await rosterAnalytics(supabase, artists)
  const maxViews = leaderboard[0]?.views ?? 0
  const months = lastSixMonths()

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
          {/* KPI divider row */}
          <div className="flex flex-wrap gap-y-6 border-b border-hairline pb-7">
            {KPIS.map((k) => (
              <div
                key={k.key}
                className="min-w-[120px] flex-1 border-hairline pr-9 [&:not(:last-child)]:mr-9 [&:not(:last-child)]:border-r"
              >
                <div className="flex items-baseline gap-2 font-space text-[25px] font-bold tabular-nums tracking-[-0.02em]">
                  {compactNumber(totals[k.key])}
                  <span className="text-xs font-bold text-ink-faint">0.0%</span>
                </div>
                <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                  {k.label}
                </div>
              </div>
            ))}
          </div>

          {/* trend band */}
          <div className="mt-8">
            <KLabel>Total site views · last 30 days</KLabel>
            <div className="mt-2 flex items-baseline gap-3 font-space text-[30px] font-bold tracking-[-0.02em]">
              {compactNumber(totals.views)}
              <span className="text-sm font-bold text-ink-faint">0.0%</span>
            </div>
            <AreaChart className="mt-3 text-ink" height={180} />
            <div className="flex justify-between font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {months.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>

          {/* leaderboard + movers */}
          <div className="mt-10 grid gap-11 md:grid-cols-[1.25fr_1fr]">
            <div>
              <KLabel>Top artists by views · 30 days</KLabel>
              <div className="mt-3">
                {leaderboard.map((a, i) => (
                  <Link
                    key={a.id}
                    href={`/artists/${a.id}`}
                    className="group block border-t border-hairline py-3 first:border-t-0"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="w-5 font-space text-xs text-ink-faint">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-sm font-semibold group-hover:text-accent">{a.name}</span>
                      <span className="ml-auto font-space text-xs">{compactNumber(a.views)}</span>
                      <span className="w-12 text-right font-space text-xs text-ink-faint">0.0%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-track">
                      <span
                        className="block h-full bg-ink"
                        style={{
                          width: `${maxViews > 0 ? Math.max(2, Math.round((a.views / maxViews) * 100)) : 2}%`,
                        }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <KLabel>Movers · 30 days</KLabel>
              <div className="mt-3">
                {leaderboard.map((a) => (
                  <Link
                    key={a.id}
                    href={`/artists/${a.id}`}
                    className="group flex items-center gap-3 border-t border-hairline py-2.5 first:border-t-0"
                  >
                    <Avatar initials={initials(a.name)} size={28} />
                    <span className="flex-1 truncate text-sm font-semibold group-hover:text-accent">
                      {a.name}
                    </span>
                    <Sparkline className="h-6 w-[72px] flex-none text-ink" />
                    <span className="w-12 text-right font-space text-xs text-ink-faint">0.0%</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </RosterShell>
  )
}
