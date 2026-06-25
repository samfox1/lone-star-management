import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { safeHref } from '@/lib/url'

type Release = {
  title: string
  cover_url: string | null
  release_date: string | null
  links: { label: string; url: string }[]
}

async function loadRelease(slug: string, release: string): Promise<Release | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_release', { p_artist_slug: slug, p_release_slug: release })
  return (data as Release | null) ?? null
}

/**
 * Public smart-link landing page for one release: cover + "listen everywhere"
 * DSP buttons. Reads the PUBLISHED release via the get_release door (anon).
 * Every link goes through safeHref (untrusted, fan-facing).
 */
export default async function ReleasePage({
  params,
}: {
  params: Promise<{ slug: string; release: string }>
}) {
  const { slug, release } = await params
  const r = await loadRelease(slug, release)
  if (!r) notFound()

  const cover = safeHref(r.cover_url)
  const links = (r.links ?? []).map((l) => ({ label: l.label, href: safeHref(l.url) })).filter((l) => l.href)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center px-6 py-16 text-center">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt={r.title} className="h-64 w-64 rounded-xl object-cover shadow-lg" />
      ) : (
        <div className="h-64 w-64 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      )}
      <h1 className="mt-6 text-2xl font-bold tracking-tight">{r.title}</h1>
      {r.release_date && <p className="mt-1 text-sm text-zinc-500">{r.release_date}</p>}

      <div className="mt-8 w-full space-y-3">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-zinc-300 px-4 py-3 text-sm font-semibold transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {l.label}
          </a>
        ))}
      </div>
    </main>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; release: string }>
}) {
  const { slug, release } = await params
  const r = await loadRelease(slug, release)
  if (!r) return { title: 'Not found' }
  const ogImage = safeHref(r.cover_url)
  return {
    title: r.title,
    openGraph: { title: r.title, type: 'music.album', images: ogImage ? [ogImage] : [] },
    twitter: { card: ogImage ? 'summary_large_image' : 'summary', title: r.title },
  }
}
