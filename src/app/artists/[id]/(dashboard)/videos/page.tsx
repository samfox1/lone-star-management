import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SyncPanel } from '../sync-panel'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import {
  addVideoAction,
  deleteContentAction,
  saveYoutubeChannelAction,
  syncYouTubeAction,
} from '../actions'

/**
 * Videos: YouTube import + paste a YouTube/SoundCloud URL. A bespoke editor (not
 * the generic CRUD) because adds must run through embedInfo to validate the URL
 * and derive the provider. Per-section publish like any content.
 */
export default async function VideosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'video', id)

  return (
    <SectionShell title="Videos" publishType="video" artistId={id}>
      <SyncPanel
        title="YouTube"
        idName="youtube_channel_id"
        idValue={artist.youtube_channel_id ?? ''}
        placeholder="YouTube channel ID"
        hasId={!!artist.youtube_channel_id}
        pullLabel="Import uploads"
        saveAction={saveYoutubeChannelAction.bind(null, id)}
        pullAction={syncYouTubeAction.bind(null, id)}
      />

      <div>
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">Add a video</h2>
        <p className="mt-1 font-space text-xs text-ink-faint">Paste a YouTube or SoundCloud URL.</p>
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

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold tracking-[-0.01em]">Videos</h2>
          <span className="font-space text-xs text-ink-faint">{rows.length} total</span>
        </div>
        {rows.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {rows.map((row) => (
              <li
                key={row.id as string}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-paper px-3 py-2"
              >
                <span className="rounded bg-surface px-1.5 py-0.5 font-space text-[10px] uppercase tracking-[0.04em] text-ink-faint">
                  {row.provider as string}
                </span>
                <span className="flex-1 truncate text-sm font-medium">{row.title as string}</span>
                {row.source !== undefined && row.source !== 'manual' && (
                  <span className="font-space text-[11px] text-ink-faint">{row.source as string}</span>
                )}
                <form action={deleteContentAction.bind(null, 'video', row.id as string, id)}>
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-hairline px-4 py-6 text-center font-space text-sm text-ink-muted">
            None yet.
          </p>
        )}
      </section>
    </SectionShell>
  )
}
