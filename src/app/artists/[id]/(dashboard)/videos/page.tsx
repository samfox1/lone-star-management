import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { SyncPanel } from '../sync-panel'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import {
  addVideoAction,
  deleteContentAction,
  saveYoutubeChannelAction,
  syncYouTubeAction,
} from '../actions'

const inputClass =
  'min-w-0 rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100'

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
        <h2 className="text-sm font-medium text-zinc-500">Add a video</h2>
        <p className="mt-1 text-xs text-zinc-400">Paste a YouTube or SoundCloud URL.</p>
        <form action={addVideoAction.bind(null, id)} className="mt-2 flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Title" required className={`${inputClass} w-40`} />
          <input
            name="embed_url"
            type="url"
            placeholder="https://youtube.com/watch?v=… or soundcloud.com/…"
            required
            className={`${inputClass} flex-1`}
          />
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Add
          </button>
        </form>
      </div>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-zinc-500">Videos</h2>
          <span className="text-sm text-zinc-400">{rows.length} total</span>
        </div>
        {rows.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {rows.map((row) => (
              <li
                key={row.id as string}
                className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                  {row.provider as string}
                </span>
                <span className="flex-1 truncate text-sm font-medium">{row.title as string}</span>
                {row.source !== undefined && row.source !== 'manual' && (
                  <span className="text-xs text-zinc-400">{row.source as string}</span>
                )}
                <form action={deleteContentAction.bind(null, 'video', row.id as string, id)}>
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            None yet.
          </p>
        )}
      </section>
    </SectionShell>
  )
}
