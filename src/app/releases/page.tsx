import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists, rosterRows } from '../roster-data'

export const metadata = { title: 'Releases — Lone Star Management' }

export default async function ReleasesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const rows = await rosterRows(supabase, 'release', artists)
  rows.sort((a, b) =>
    String(b.row.release_date ?? '').localeCompare(String(a.row.release_date ?? '')),
  )

  return (
    <RosterShell active="releases" page="Releases" email={user?.email ?? null}>
      <SectionToolbar title="Releases" />
      {rows.length === 0 ? (
        <EmptyState
          icon="releases"
          title="No releases yet"
          sub="Add releases inside an artist (Releases tab) and they roll up across your roster here."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-8 px-7 pb-14">
          {rows.map(({ row, artist }) => {
            const cover = row.cover_url as string | null
            const year = (row.release_date as string | null)?.slice(0, 4)
            return (
              <Link key={row.id as string} href={`/artists/${artist.id}/releases`} className="group">
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="h-9 w-9 rounded-full bg-ink" />
                  )}
                </div>
                <div className="mt-3 truncate text-[15px] font-bold tracking-[-0.01em] group-hover:text-accent">
                  {row.title as string}
                </div>
                <div className="mt-0.5 font-space text-[13px] text-ink-muted">
                  {artist.name}
                  {year ? ` · ${year}` : ''}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </RosterShell>
  )
}
