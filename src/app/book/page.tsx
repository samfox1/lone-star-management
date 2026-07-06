import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { compactNumber } from '@/lib/format'
import { Avatar, KLabel, initials } from '@/components/ui/ui'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists } from '../roster-data'

export const metadata = { title: 'Book — Lone Star Management' }

/** "Jul 6, 2026" from a timestamptz string, out of render. */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The Book — a manager's whole roster of subscribers in one place. `artist_id`
 * already keys each signup to an artist and RLS scopes every read to the current
 * manager's artists, so this is a pure rollup: no per-row manager stamping. The
 * per-artist counts come from the RLS-scoped `subscriber_counts_by_artist` view
 * (with a graceful fallback if that migration hasn't been pushed yet).
 */
export default async function BookPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const byId = new Map(artists.map((a) => [a.id, a]))

  // Per-artist counts from the RLS-scoped view; tolerate the not-yet-migrated
  // case by aggregating the rows directly instead. A missing relation surfaces as
  // Postgres 42P01 or — through PostgREST's schema cache, which is how a `.from()`
  // on an absent view actually fails — as PGRST205; tolerate both. Any other error
  // is real (RLS, network) and must surface, not silently degrade.
  const counts = new Map<string, { count: number; latest: string | null }>()
  const { data: countRows, error: countErr } = await supabase
    .from('subscriber_counts_by_artist')
    .select('artist_id, subscriber_count, latest_at')
  const viewMissing = countErr?.code === '42P01' || countErr?.code === 'PGRST205'
  if (countErr && !viewMissing) throw countErr
  if (countRows) {
    for (const r of countRows) {
      counts.set(r.artist_id as string, {
        count: Number(r.subscriber_count),
        latest: (r.latest_at as string | null) ?? null,
      })
    }
  } else {
    const { data: rows } = await supabase.from('subscribers').select('artist_id, created_at')
    for (const r of rows ?? []) {
      const id = r.artist_id as string
      const e = counts.get(id) ?? { count: 0, latest: null }
      e.count += 1
      const at = r.created_at as string
      if (!e.latest || at > e.latest) e.latest = at
      counts.set(id, e)
    }
  }

  // Recent signups across the roster (RLS-scoped to this manager's artists).
  const { data: recent } = await supabase
    .from('subscribers')
    .select('email, created_at, artist_id')
    .order('created_at', { ascending: false })
    .limit(25)

  const perArtist = artists
    .map((a) => ({ ...a, count: counts.get(a.id)?.count ?? 0, latest: counts.get(a.id)?.latest ?? null }))
    .sort((x, y) => y.count - x.count)
  const total = perArtist.reduce((s, a) => s + a.count, 0)
  const withSubs = perArtist.filter((a) => a.count > 0).length
  const max = perArtist[0]?.count ?? 0

  return (
    <RosterShell active="book" page="Book" email={user?.email ?? null}>
      <SectionToolbar title="Book" />
      {artists.length === 0 ? (
        <EmptyState
          icon="list"
          title="No subscribers yet"
          sub="Request your first artist — email signups from their site's community popup collect here, across your whole roster."
        />
      ) : (
        <div className="px-7 pb-12">
          <div className="border-b border-hairline pb-7">
            <KLabel>Total subscribers · your roster</KLabel>
            <div className="mt-2 font-space text-[34px] font-bold tabular-nums tracking-[-0.02em]">
              {compactNumber(total)}
            </div>
            <p className="mt-1 font-space text-xs text-ink-faint">
              across {withSubs} of {artists.length} {artists.length === 1 ? 'artist' : 'artists'}
            </p>
          </div>

          <div className="mt-10 grid gap-11 md:grid-cols-[1.25fr_1fr]">
            {/* Subscribers by artist */}
            <div>
              <KLabel>Subscribers by artist</KLabel>
              <div className="mt-3">
                {perArtist.map((a) => (
                  <Link
                    key={a.id}
                    href={`/artists/${a.id}/subscribers`}
                    className="group block border-t border-hairline py-3 first:border-t-0"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="text-sm font-semibold group-hover:text-accent">{a.name}</span>
                      {a.latest && (
                        <span className="font-space text-[11px] text-ink-faint">last {fmtDate(a.latest)}</span>
                      )}
                      <span className="ml-auto font-space text-xs tabular-nums">{compactNumber(a.count)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-track">
                      <span
                        className="block h-full bg-ink"
                        style={{ width: `${max > 0 ? Math.max(2, Math.round((a.count / max) * 100)) : 2}%` }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Recent signups */}
            <div>
              <KLabel>Recent signups</KLabel>
              <div className="mt-3">
                {(recent ?? []).length === 0 ? (
                  <p className="font-space text-xs text-ink-faint">No signups yet.</p>
                ) : (
                  (recent ?? []).map((r, i) => {
                    const a = byId.get(r.artist_id as string)
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-3 border-t border-hairline py-2.5 first:border-t-0"
                      >
                        <Avatar initials={initials(a?.name ?? '?')} size={26} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{r.email as string}</div>
                          <div className="font-space text-[11px] text-ink-muted">{a?.name ?? 'Unknown'}</div>
                        </div>
                        <span className="font-space text-[11px] text-ink-faint">
                          {fmtDate(r.created_at as string)}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </RosterShell>
  )
}
