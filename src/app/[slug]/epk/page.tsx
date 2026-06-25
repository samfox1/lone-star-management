import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPublishedSite } from '@/lib/site'
import { safeHref } from '@/lib/url'

type PublicRelease = { title: string; slug: string; cover_url: string | null; release_date: string | null }

/**
 * Public EPK (electronic press kit): a shareable press one-pager generated from
 * the artist's PUBLISHED content — bio, photo, discography (releases), and
 * contact/socials. Read-only; 404 until the profile is published. All URLs go
 * through safeHref.
 */
export default async function EpkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const site = await getPublishedSite(supabase, slug)
  if (!site) notFound()

  const { data } = await supabase.rpc('get_public_releases', { p_slug: slug })
  const releases = (data as PublicRelease[] | null) ?? []

  const photo = safeHref(site.media.find((m) => m.purpose === 'profile_photo')?.url ?? site.artist.hero_image_url)
  const mailto = site.links.find((l) => l.url.toLowerCase().startsWith('mailto:'))
  const socials = site.links.filter((l) => l !== mailto)

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={site.artist.name} className="h-32 w-32 rounded-full object-cover" />
        )}
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-400">Press kit</p>
          <h1 className="text-3xl font-bold tracking-tight">{site.artist.name}</h1>
        </div>
      </header>

      {site.artist.bio && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Bio</h2>
          <div className="mt-3 space-y-3 leading-relaxed text-zinc-700 dark:text-zinc-300">
            {site.artist.bio.split('\n').filter(Boolean).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      )}

      {releases.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Releases</h2>
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {releases.map((r) => {
              const cover = safeHref(r.cover_url)
              return (
                <li key={r.slug}>
                  <Link href={`/${slug}/r/${r.slug}`} className="block">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt={r.title} className="aspect-square w-full rounded-lg object-cover" />
                    ) : (
                      <div className="aspect-square w-full rounded-lg bg-zinc-100 dark:bg-zinc-900" />
                    )}
                    <p className="mt-2 text-sm font-medium">{r.title}</p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Contact</h2>
        {mailto && (
          <a href={safeHref(mailto.url)} className="mt-3 block font-medium hover:underline">
            {mailto.url.replace(/^mailto:/i, '')}
          </a>
        )}
        {socials.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {socials.map((s) => {
              const href = safeHref(s.url)
              return href ? (
                <a key={s.id} href={href} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:underline">
                  {s.label}
                </a>
              ) : null
            })}
          </div>
        )}
      </section>
    </main>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const site = await getPublishedSite(supabase, slug)
  return { title: site ? `${site.artist.name} — Press Kit` : 'Not found' }
}
