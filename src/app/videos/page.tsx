import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icons'
import { EmptyState, RosterShell, SectionToolbar } from '../roster-chrome'
import { ownedArtists, rosterRows } from '../roster-data'

export const metadata = { title: 'Videos — Lone Star Management' }

/** YouTube poster from a normalized embed URL; null for other providers. */
function youtubePoster(url: string, provider: string): string | null {
  if (provider !== 'youtube') return null
  const m = url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

export default async function VideosPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const artists = await ownedArtists(supabase)
  const rows = await rosterRows(supabase, 'video', artists)

  return (
    <RosterShell active="videos" page="Videos" email={user?.email ?? null}>
      <SectionToolbar title="Videos" />
      {rows.length === 0 ? (
        <EmptyState
          icon="videos"
          title="No videos yet"
          sub="Add or import videos inside an artist (Videos tab) — they roll up across your roster here."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5 px-7 pb-12">
          {rows.map(({ row, artist }) => {
            const provider = (row.provider as string | null) ?? ''
            const poster = youtubePoster(String(row.embed_url ?? ''), provider)
            return (
              <Link key={row.id as string} href={`/artists/${artist.id}/videos`} className="group">
                <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-ink">
                  {poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={poster} alt="" className="h-full w-full object-cover opacity-90" />
                  )}
                  <span className="absolute text-white/95">
                    <Icon name="videos" size={30} />
                  </span>
                </div>
                <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">
                  {row.title as string}
                </div>
                <div className="font-space text-[11px] text-ink-muted">
                  {artist.name}
                  {provider ? ` · ${provider}` : ''}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </RosterShell>
  )
}
