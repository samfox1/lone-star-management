import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Avatar, buttonClass, initials } from '@/components/ui/ui'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists, rosterRows, todayIso } from '../roster-data'

export const metadata = { title: 'Tour — Lone Star Management' }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function calendarParts(d: string): { day: string; mon: string } {
  const [, m, day] = d.split('-')
  return { day: String(Number(day) || ''), mon: MONTHS[Number(m) - 1] ?? '' }
}

export default async function TourPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const today = todayIso()
  const rows = (await rosterRows(supabase, 'tour_date', artists))
    .filter(({ row }) => String(row.date ?? '') >= today)
    .sort((a, b) => String(a.row.date ?? '').localeCompare(String(b.row.date ?? '')))

  return (
    <RosterShell active="tour" page="Tour" email={user?.email ?? null}>
      <SectionToolbar title="Tour" />
      {rows.length === 0 ? (
        <EmptyState
          icon="tour"
          title="No upcoming dates"
          sub="Add tour dates inside an artist (Tour tab) — upcoming shows across your roster appear here."
        />
      ) : (
        <div className="px-7 pb-12">
          {rows.map(({ row, artist }) => {
            const { day, mon } = calendarParts(String(row.date ?? ''))
            const ticket = row.ticket_url as string | null
            const city = row.city as string | null
            const country = row.country as string | null
            return (
              <div
                key={row.id as string}
                className="flex items-center gap-4 border-t border-hairline py-4 first:border-t-0"
              >
                <div className="w-12 flex-none text-center">
                  <div className="font-space text-[21px] font-bold leading-none">{day}</div>
                  <div className="mt-1 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                    {mon}
                  </div>
                </div>
                <Avatar initials={initials(artist.name)} size={32} />
                <Link href={`/artists/${artist.id}/tour`} className="group min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold group-hover:text-accent">
                    {row.venue as string}
                  </div>
                  <div className="font-space text-xs text-ink-muted">
                    {artist.name}
                    {city ? ` · ${city}` : ''}
                    {country ? `, ${country}` : ''}
                  </div>
                </Link>
                {ticket && (
                  <a
                    href={ticket}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClass('ghost', 'ml-auto flex-none')}
                  >
                    Tickets
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </RosterShell>
  )
}
