/**
 * The artist's public website template. Rendered against PUBLISHED data at
 * /[slug] and against WORKING rows at the manager preview — same component, so
 * preview is a true visual preview (PLAN decision #7).
 */
import type { SiteData } from '@/lib/site'

function Section({
  title,
  show,
  children,
}: {
  title: string
  show: boolean
  children: React.ReactNode
}) {
  if (!show) return null
  return (
    <section className="mx-auto max-w-3xl px-6 py-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function ArtistSite({ data }: { data: SiteData }) {
  const { artist, tracks, tour_dates, merch, links } = data

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

      <Section title="Tracks" show={tracks.length > 0}>
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
          {tracks.map((track) => (
            <li key={track.id} className="flex items-center gap-4 py-3">
              {track.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={track.cover_url} alt="" className="h-12 w-12 rounded object-cover" />
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
      </Section>

      <Section title="Tour dates" show={tour_dates.length > 0}>
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
          {tour_dates.map((show) => (
            <li key={show.id} className="flex items-center gap-4 py-3">
              <span className="w-28 shrink-0 text-sm tabular-nums text-zinc-500">
                {show.date}
              </span>
              <span className="flex-1 font-medium">
                {show.venue}
                {show.city ? `, ${show.city}` : ''}
              </span>
              {show.ticket_url && (
                <a
                  href={show.ticket_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  Tickets →
                </a>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Merch" show={merch.length > 0}>
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {merch.map((item) => (
            <li key={item.id}>
              <a
                href={item.url ?? '#'}
                target={item.url ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="block"
              >
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt={item.title} className="aspect-square w-full rounded-lg object-cover" />
                ) : (
                  <div className="aspect-square w-full rounded-lg bg-zinc-100 dark:bg-zinc-900" />
                )}
                <p className="mt-2 text-sm font-medium">{item.title}</p>
                {item.price != null && (
                  <p className="text-sm text-zinc-500">${Number(item.price).toFixed(2)}</p>
                )}
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Links" show={links.length > 0}>
        <ul className="mt-4 flex flex-wrap gap-2">
          {links.map((link) => (
            <li key={link.id}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
