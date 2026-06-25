import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished } from '@/lib/content'
import { Sidebar } from './sidebar'
import { dirtyBySeg } from './sections'
import { requireArtist } from './_data'
import { publishAction } from './actions'

/**
 * Dashboard shell for one artist: loads the artist once (the .single() guard is
 * the non-owner→404 gate for every sub-route, alongside the proxy's anon→login),
 * computes the unpublished diff for the sidebar badges, and renders the sidebar
 * + persistent action bar around each section page. Does NOT wrap /preview,
 * which lives outside this route group.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const diff = await diffUnpublished(supabase, id)
  const dirty = dirtyBySeg(diff)
  const anyDirty = Object.values(dirty).some(Boolean)

  const linkClass =
    'rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-black">
      <Sidebar artistId={id} artistName={artist.name} dirty={dirty} />

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-2 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          {anyDirty && (
            <span className="mr-auto flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unpublished changes
            </span>
          )}
          <Link href={`/artists/${id}/preview`} className={linkClass}>
            Preview
          </Link>
          <Link href={`/${artist.slug}`} className={linkClass}>
            View site
          </Link>
          <form action={publishAction.bind(null, id)}>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Publish all
            </button>
          </form>
        </header>

        <main className="mx-auto w-full max-w-3xl px-6 py-8">{children}</main>
      </div>
    </div>
  )
}
