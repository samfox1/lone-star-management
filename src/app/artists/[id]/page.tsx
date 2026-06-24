import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { type EntityType, listContent } from '@/lib/content'
import { ContentSection } from './content-sections'
import { publishAction, saveSpotifyIdAction, syncSpotifyAction } from './actions'

const SECTIONS: EntityType[] = ['track', 'tour_date', 'merch', 'link']

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
    .select('id, name, slug, spotify_artist_id')
    .eq('id', id)
    .single()
  if (error || !artist) notFound()

  // Load every content type's working rows in parallel.
  const rowsByType = Object.fromEntries(
    await Promise.all(
      SECTIONS.map(async (type) => [type, await listContent(supabase, type, id)] as const),
    ),
  )

  const linkClass =
    'rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'

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
        <div className="flex items-center gap-2">
          <Link href={`/artists/${artist.id}/preview`} className={linkClass}>
            Preview
          </Link>
          <Link href={`/${artist.slug}`} className={linkClass}>
            View site
          </Link>
          <form action={publishAction.bind(null, artist.id)}>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Publish
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* Spotify sync */}
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Spotify
            </h2>
            <form action={syncSpotifyAction.bind(null, artist.id)}>
              <button
                type="submit"
                disabled={!artist.spotify_artist_id}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Pull from Spotify
              </button>
            </form>
          </div>
          <form
            action={saveSpotifyIdAction.bind(null, artist.id)}
            className="mt-3 flex items-center gap-2"
          >
            <input
              name="spotify_artist_id"
              defaultValue={artist.spotify_artist_id ?? ''}
              placeholder="Spotify artist ID"
              className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
            />
            <button
              type="submit"
              className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Save ID
            </button>
          </form>
          <p className="mt-2 text-xs text-zinc-400">
            Pulls the discography as draft tracks. Your manual edits are never
            overwritten. Pulling requires Spotify API credentials configured.
          </p>
        </section>

        {SECTIONS.map((type) => (
          <ContentSection
            key={type}
            type={type}
            artistId={artist.id}
            rows={rowsByType[type]}
          />
        ))}
      </main>
    </div>
  )
}
