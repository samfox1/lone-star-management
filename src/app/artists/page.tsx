import Link from 'next/link'
import { buildRoster, type EnquiryCountRow } from '@/lib/enquiries'
import { createClient } from '@/lib/supabase/server'
import { KLabel } from '@/components/ui/ui'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists } from '../roster-data'

export const metadata = { title: 'Enquiries — Lone Star Management' }

/** "Aug 4, 2026" — the roster view needs the day, not the minute; the per-artist
 *  inbox shows the time. */
function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

/**
 * Enquiries across the whole roster — who needs answering.
 *
 * Deliberately TRIAGE, not a directory. `/roster` already lists every artist a manager
 * has and links to each one, so a second alphabetical index would earn nothing. This
 * sorts by attention: anyone with unread first, freshest at the top (see
 * `sortByAttention` for why recency beats pile size).
 *
 * Two RLS-scoped reads, no N+1 and no second permission model: `ownedArtists` for the
 * roster, and the `enquiry_counts_by_artist` view for the numbers. The view is
 * `security_invoker`, so `enquiries`' own policy scopes the counts — a manager cannot see
 * another tenant's VOLUME, which is a real leak even though no message text is involved.
 */
export default async function ArtistsEnquiriesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const artists = await ownedArtists(supabase)

  // Same degradation the Book uses: a missing view surfaces as 42P01, or as PGRST205
  // through PostgREST's schema cache. Anything else (RLS, network) is real and must
  // surface rather than quietly render as "no enquiries".
  const { data: countRows, error: countErr } = await supabase
    .from('enquiry_counts_by_artist')
    .select('artist_id, total, unread, latest_at')
  const viewMissing = countErr?.code === '42P01' || countErr?.code === 'PGRST205'
  if (countErr && !viewMissing) throw countErr

  const rows = buildRoster(artists, (countRows ?? []) as EnquiryCountRow[])
  const totalUnread = rows.reduce((s, r) => s + r.unread, 0)
  const total = rows.reduce((s, r) => s + r.total, 0)

  return (
    <RosterShell active="enquiries" page="Enquiries" email={user?.email ?? null}>
      <SectionToolbar title="Enquiries" />
      {artists.length === 0 ? (
        <EmptyState
          icon="text"
          title="No artists yet"
          sub="Request your first artist — booking and demo enquiries from their site collect here, across your whole roster."
        />
      ) : (
        <div className="px-7 pb-12">
          <div className="border-b border-hairline pb-7">
            <KLabel>Unread · your roster</KLabel>
            <div className="mt-2 font-space text-[34px] font-bold tabular-nums tracking-[-0.02em]">
              {totalUnread}
            </div>
            <p className="mt-1 font-space text-xs text-ink-faint">
              {total === 0
                ? 'No enquiries yet. They arrive from the contact form on each artist’s site.'
                : `${total} enquir${total === 1 ? 'y' : 'ies'} in total.`}
            </p>
          </div>

          <table className="mt-7 w-full text-left">
            <thead>
              <tr className="border-b border-hairline">
                <th className="pb-2 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                  Artist
                </th>
                <th className="pb-2 text-right font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                  Unread
                </th>
                <th className="pb-2 text-right font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                  Total
                </th>
                <th className="pb-2 text-right font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                  Latest
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hairline-soft last:border-0">
                  <td className="py-3">
                    <Link
                      href={`/artists/${r.id}/enquiries`}
                      className="font-medium transition-colors hover:text-accent"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-3 text-right font-space text-sm tabular-nums">
                    {r.unread > 0 ? (
                      <span className="font-bold text-accent">{r.unread}</span>
                    ) : (
                      <span className="text-ink-faint">0</span>
                    )}
                  </td>
                  <td className="py-3 text-right font-space text-sm tabular-nums text-ink-muted">{r.total}</td>
                  <td className="py-3 text-right font-space text-sm text-ink-muted">{fmtDate(r.latestAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RosterShell>
  )
}
