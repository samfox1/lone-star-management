import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listTracks } from '@/lib/tracks'
import {
  addTrackAction,
  deleteTrackAction,
  publishAction,
  updateTrackAction,
} from './actions'

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // RLS returns no row for a tenant the caller can't access, so .single() errors
  // → 404. A manager guessing another artist's id gets not-found, never a leak.
  const { data: artist, error } = await supabase
    .from('artists')
    .select('id, name, slug')
    .eq('id', id)
    .single()
  if (error || !artist) notFound()

  const tracks = await listTracks(supabase, id)

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            ← Your artists
          </Link>
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {artist.name}
          </span>
        </div>
        <form action={publishAction.bind(null, artist.id)}>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Publish
          </button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Tracks
          </h1>
          <span className="text-sm text-zinc-400">{tracks.length} total</span>
        </div>

        {/* Add a track */}
        <form
          action={addTrackAction.bind(null, artist.id)}
          className="mt-4 flex gap-2"
        >
          <input
            name="title"
            placeholder="New track title"
            required
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
          />
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Add
          </button>
        </form>

        {/* Track list */}
        {tracks.length > 0 ? (
          <ul className="mt-6 space-y-2">
            {tracks.map((track) => (
              <li
                key={track.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <form
                  action={updateTrackAction.bind(null, track.id, artist.id)}
                  className="flex flex-1 items-center gap-2"
                >
                  <input
                    name="title"
                    defaultValue={track.title}
                    required
                    className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-300 dark:text-zinc-50 dark:focus:border-zinc-700"
                  />
                  {track.source !== 'manual' && (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                      {track.source}
                    </span>
                  )}
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Save
                  </button>
                </form>
                <form action={deleteTrackAction.bind(null, track.id, artist.id)}>
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
          <p className="mt-6 rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No tracks yet. Add one above.
          </p>
        )}
      </main>
    </div>
  )
}
