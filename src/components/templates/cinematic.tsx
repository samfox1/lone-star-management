/**
 * Cinematic public-site template — a dark, single-page artist site (ported from
 * the standalone Skeen site). Fed entirely from SiteData, so any artist can
 * select it. The dark theme is scoped to `.theme-cinematic` (see globals.css)
 * so it never leaks into the dashboard.
 */
import type { SiteData, SiteLink, SiteTourDate } from '@/lib/site'
import { safeHref } from '@/lib/url'
import { CinematicHero, type HeroClip } from './cinematic-hero'
import { CinematicWork, type WorkTab } from './cinematic-work'

// Hero video clips per slug. Videos aren't in the data model yet, so this
// bridges until media storage exists; files live in /public/videos/{slug}/.
const HERO_CLIPS: Record<string, string[]> = {
  skeen: ['video1', 'video2', 'video3'],
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function Nav({ name, sections }: { name: string; sections: { href: string; label: string }[] }) {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-border/60 bg-black/30 px-6 py-4 backdrop-blur">
      <a href="#home" className="font-display text-lg font-black uppercase tracking-tight">
        {name}
      </a>
      <ul className="flex gap-6 text-xs font-semibold uppercase tracking-widest">
        {sections.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="text-muted transition hover:text-foreground">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function ShowRow({ show, past }: { show: SiteTourDate; past?: boolean }) {
  const ticket = safeHref(show.ticket_url)
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5">
      <div className="flex items-baseline gap-6">
        <span className="font-display text-sm tabular-nums text-muted">{formatDate(show.date)}</span>
        <div>
          <p className="font-display text-lg font-bold uppercase">{show.venue ?? 'TBA'}</p>
          <p className="text-sm text-muted">
            {show.city}
            {show.country ? `, ${show.country}` : ''}
          </p>
        </div>
      </div>
      {past ? (
        <span className="text-xs uppercase tracking-widest text-muted">Past</span>
      ) : ticket ? (
        <a
          href={ticket}
          target="_blank"
          rel="noopener noreferrer"
          className="border border-white/30 px-5 py-2 text-xs font-semibold uppercase tracking-widest transition hover:border-flash-1 hover:text-flash-1"
        >
          Tickets
        </a>
      ) : (
        <span className="text-xs uppercase tracking-widest text-muted">Announced</span>
      )}
    </li>
  )
}

function Shows({ upcoming, past }: { upcoming: SiteTourDate[]; past: SiteTourDate[] }) {
  return (
    <section id="shows" className="mx-auto w-full max-w-4xl px-6 py-24">
      <h2 className="font-display text-4xl font-black uppercase tracking-tight md:text-5xl">Shows</h2>
      {upcoming.length > 0 ? (
        <ul className="mt-10">
          {upcoming.map((s) => (
            <ShowRow key={s.id} show={s} />
          ))}
        </ul>
      ) : (
        <div className="mt-10 border border-border p-8 text-center">
          <p className="text-muted">No upcoming dates right now.</p>
          <a
            href="#contact"
            className="mt-4 inline-block border border-white/30 px-6 py-3 text-xs font-semibold uppercase tracking-widest transition hover:border-flash-1 hover:text-flash-1"
          >
            Book a show
          </a>
        </div>
      )}
      {past.length > 0 && (
        <>
          <h3 className="mt-16 text-sm font-semibold uppercase tracking-[0.3em] text-muted">
            Past Highlights
          </h3>
          <ul className="mt-4 opacity-70">
            {past.map((s) => (
              <ShowRow key={s.id} show={s} past />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function About({ bio, photo, name }: { bio: string | null; photo: string | null; name: string }) {
  const img = safeHref(photo)
  if (!bio && !img) return null
  return (
    <section id="about" className="mx-auto w-full max-w-4xl px-6 py-24">
      <h2 className="font-display text-4xl font-black uppercase tracking-tight md:text-5xl">About</h2>
      <div className="mt-10 grid gap-10 md:grid-cols-2">
        {bio && (
          <div className="space-y-4 leading-relaxed text-muted">
            {bio.split('\n').filter(Boolean).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
        {img && (
          <div className="aspect-[3/4] w-full overflow-hidden border border-border bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt={name} className="h-full w-full object-cover" />
          </div>
        )}
      </div>
    </section>
  )
}

function Footer({ name, links }: { name: string; links: SiteLink[] }) {
  const mailto = links.find((l) => l.url.toLowerCase().startsWith('mailto:'))
  const socials = links.filter((l) => l !== mailto)
  return (
    <footer id="contact" className="mt-auto border-t border-border px-6 py-16 text-center">
      <h2 className="font-display text-3xl font-black uppercase tracking-tight">Bookings</h2>
      {mailto && (
        <>
          <p className="mt-4 text-muted">For show &amp; booking enquiries:</p>
          <a
            href={safeHref(mailto.url)}
            className="mt-6 inline-block font-display text-lg font-bold transition hover:text-flash-1"
          >
            {mailto.url.replace(/^mailto:/i, '')}
          </a>
        </>
      )}
      {socials.length > 0 && (
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm uppercase tracking-widest">
          {socials.map((s) => {
            const href = safeHref(s.url)
            return href ? (
              <a
                key={s.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted transition hover:text-flash-2"
              >
                {s.label}
              </a>
            ) : null
          })}
        </div>
      )}
      <p className="mt-12 text-xs uppercase tracking-widest text-muted">© {name}</p>
    </footer>
  )
}

export function CinematicTemplate({ data }: { data: SiteData }) {
  const { artist, tour_dates, links } = data

  const clips: HeroClip[] = (HERO_CLIPS[artist.slug] ?? []).map((file) => ({
    mp4: `/videos/${artist.slug}/${file}.mp4`,
    webm: `/videos/${artist.slug}/${file}.webm`,
  }))

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = tour_dates.filter((d) => d.date >= today)
  const past = tour_dates.filter((d) => d.date < today).reverse()

  // Work tabs from backend data: Spotify catalog + SoundCloud (if linked).
  const tabs: WorkTab[] = []
  if (artist.spotify_artist_id) {
    tabs.push({
      key: 'releases',
      label: 'Releases',
      platform: 'Spotify',
      embedUrl: `https://open.spotify.com/embed/artist/${encodeURIComponent(artist.spotify_artist_id)}?utm_source=generator&theme=0`,
      link: `https://open.spotify.com/artist/${encodeURIComponent(artist.spotify_artist_id)}`,
    })
  }
  const soundcloud = links.find((l) => l.url.toLowerCase().includes('soundcloud.com'))
  if (soundcloud) {
    tabs.push({
      key: 'sets',
      label: 'Sets',
      platform: 'SoundCloud',
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(soundcloud.url)}&color=%23ff2e63&auto_play=false&show_user=true`,
      link: soundcloud.url,
    })
  }

  const sections = [
    { href: '#shows', label: 'Shows' },
    { href: '#work', label: 'Work' },
    { href: '#about', label: 'About' },
    { href: '#contact', label: 'Contact' },
  ]

  return (
    <div className="theme-cinematic flex min-h-screen flex-col">
      <Nav name={artist.name} sections={sections} />
      <main className="flex flex-1 flex-col">
        <CinematicHero name={artist.name} clips={clips} poster={artist.hero_image_url} />
        <Shows upcoming={upcoming} past={past} />
        <CinematicWork tabs={tabs} />
        <About bio={artist.bio} photo={artist.hero_image_url} name={artist.name} />
      </main>
      <Footer name={artist.name} links={links} />
    </div>
  )
}
