/**
 * The artist's public website template. Rendered against PUBLISHED data at
 * /[slug] and against WORKING rows at the manager preview — same component, so
 * preview is a true visual preview (PLAN decision #7).
 *
 * Every URL here is untrusted (manager-entered, or from external syncs), so
 * hrefs and image srcs go through safeHref. A rejected URL degrades to
 * non-clickable text / a placeholder — the content still shows, it just isn't a
 * link. This is the must-have guard against javascript:/data: stored XSS.
 */
import type { SiteData } from '@/lib/site'
import { safeHref } from '@/lib/url'
import { fieldValue } from '@/lib/site-content-schema'

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
  const heroSrc = safeHref(artist.hero_image_url)
  const text = (key: string) => fieldValue(data.site_content, artist.template, key)

  return (
    <div className="min-h-full bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <section className="relative">
        {heroSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroSrc} alt={artist.name} className="h-64 w-full object-cover sm:h-80" />
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

      <Section title={text('tracks_heading')} show={tracks.length > 0}>
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
          {tracks.map((track) => {
            const cover = safeHref(track.cover_url)
            // Hosted stream, else a link-out (Deezer etc.).
            const stream = safeHref(track.stream_url) ?? safeHref(track.provider_url)
            return (
              <li key={track.id} className="flex items-center gap-4 py-3">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="h-12 w-12 rounded object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded bg-zinc-100 dark:bg-zinc-900" />
                )}
                <span className="flex-1 font-medium">{track.title}</span>
                {stream && (
                  <a
                    href={stream}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Listen →
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title={text('tour_dates_heading')} show={tour_dates.length > 0}>
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
          {tour_dates.map((show) => {
            const tickets = safeHref(show.ticket_url)
            return (
              <li key={show.id} className="flex items-center gap-4 py-3">
                <span className="w-28 shrink-0 text-sm tabular-nums text-zinc-500">{show.date}</span>
                <span className="flex-1 font-medium">
                  {show.venue}
                  {show.city ? `, ${show.city}` : ''}
                </span>
                {tickets && (
                  <a
                    href={tickets}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Tickets →
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title={text('merch_heading')} show={merch.length > 0}>
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {merch.map((item) => {
            const buy = safeHref(item.url)
            const img = safeHref(item.image_url)
            const card = (
              <>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={item.title} className="aspect-square w-full rounded-lg object-cover" />
                ) : (
                  <div className="aspect-square w-full rounded-lg bg-zinc-100 dark:bg-zinc-900" />
                )}
                <p className="mt-2 text-sm font-medium">{item.title}</p>
                {item.price != null && (
                  <p className="text-sm text-zinc-500">${Number(item.price).toFixed(2)}</p>
                )}
              </>
            )
            return (
              <li key={item.id}>
                {buy ? (
                  <a href={buy} target="_blank" rel="noopener noreferrer" className="block">
                    {card}
                  </a>
                ) : (
                  <div className="block">{card}</div>
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title={text('links_heading')} show={links.length > 0}>
        <ul className="mt-4 flex flex-wrap gap-2">
          {links.map((link) => {
            const href = safeHref(link.url)
            return (
              <li key={link.id}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {link.label}
                  </a>
                ) : (
                  <span className="inline-block rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    {link.label}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </Section>
    </div>
  )
}
