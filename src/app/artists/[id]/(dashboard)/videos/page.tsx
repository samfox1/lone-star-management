import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SectionShell } from '../section-shell'
import { SectionMeta, ConnectLink } from '../section-meta'
import { CardGrid } from '../card-grid'
import { requireArtist } from '../_data'
import { addVideoAction } from '../actions'
import { VideoCard } from './video-card'

/** YouTube poster from a normalized embed URL; null for other providers. */
function youtubePoster(url: string, provider: string): string | null {
  if (provider !== 'youtube') return null
  const m = url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/**
 * Videos: paste a YouTube/SoundCloud URL (validated through embedInfo) — shown as
 * a 16:9 thumbnail grid. YouTube channel import lives in the Integrations hub.
 */
export default async function VideosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  const rows = await listContent(supabase, 'video', id)

  return (
    <SectionShell title="Videos" publishType="video" artistId={id}>
      <SectionMeta count={rows.length} singular="video" plural="videos">
        <ConnectLink href={`/artists/${id}/tools/integrations`}>Import from YouTube →</ConnectLink>
      </SectionMeta>

      <div>
        <p className="font-space text-xs text-ink-faint">Paste a YouTube or SoundCloud URL.</p>
        <form action={addVideoAction.bind(null, id)} className="mt-2 flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Title" required className={`${inputClass} w-40`} />
          <input
            name="embed_url"
            type="url"
            placeholder="https://youtube.com/watch?v=… or soundcloud.com/…"
            required
            className={`${inputClass} flex-1`}
          />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </form>
      </div>

      <CardGrid size="lg" count={rows.length} empty="None yet.">
        {rows.map((row) => {
          const provider = String(row.provider ?? '')
          return (
            <VideoCard
              key={row.id as string}
              artistId={id}
              video={{
                id: row.id as string,
                title: row.title as string,
                provider: provider || null,
                poster: youtubePoster(String(row.embed_url ?? ''), provider),
                embed_url: (row.embed_url as string | null) ?? null,
                source: (row.source as string | null) ?? null,
              }}
            />
          )
        })}
      </CardGrid>
    </SectionShell>
  )
}
