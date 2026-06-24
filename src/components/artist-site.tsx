/**
 * The artist's public website template. Rendered against PUBLISHED data at
 * /[slug] and against WORKING rows at the manager preview — same component, so
 * preview is a true visual preview (PLAN decision #7).
 */
import type { SiteData } from '@/lib/site'

export function ArtistSite({ data }: { data: SiteData }) {
  const { artist, tracks } = data

  return (
    <div className="min-h-full bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <section className="relative">
        {artist.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.hero_image_url}
            alt={artist.name}
            className="h-64 w-full object-cover sm:h-80"
          />
        ) : (
          <div className="h-48 w-full bg-gradient-to-b from-zinc-200 to-white dark:from-zinc-900 dark:to-black sm:h-56" />
        )}
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="-mt-10 text-4xl font-bold tracking-tight sm:text-5xl">
            {artist.name}
          </h1>
          {artist.bio && (
            <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-300">
              {artist.bio}
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Tracks
        </h2>
        {tracks.length > 0 ? (
          <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
            {tracks.map((track) => (
              <li key={track.id} className="flex items-center gap-4 py-3">
                {track.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={track.cover_url}
                    alt=""
                    className="h-12 w-12 rounded object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 rounded bg-zinc-100 dark:bg-zinc-900" />
                )}
                <span className="flex-1 font-medium">{track.title}</span>
                {track.stream_url && (
                  <a
                    href={track.stream_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Listen →
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-zinc-400">No tracks yet.</p>
        )}
      </section>
    </div>
  )
}
