import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import {
  addReleaseAction,
  addReleaseLinkAction,
  deleteContentAction,
  removeReleaseLinkAction,
} from '../actions'

const inputClass =
  'min-w-0 rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100'
type ReleaseLink = { label: string; url: string }

/**
 * Releases: each release gets a public smart-link page (/[slug]/r/[release])
 * with its DSP buttons. Bespoke editor (the links are a jsonb managed via
 * dedicated actions). Per-section publish like content.
 */
export default async function ReleasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'release', id)

  return (
    <SectionShell title="Releases" publishType="release" artistId={id}>
      <div>
        <h2 className="text-sm font-medium text-zinc-500">Add a release</h2>
        <form action={addReleaseAction.bind(null, id)} className="mt-2 flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Title" required className={`${inputClass} w-44`} />
          <input name="release_date" type="date" className={`${inputClass} w-40`} />
          <input name="cover_url" type="url" placeholder="Cover image URL" className={`${inputClass} flex-1`} />
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Add
          </button>
        </form>
      </div>

      {rows.length > 0 ? (
        <ul className="space-y-4">
          {rows.map((row) => {
            const links = (row.links as ReleaseLink[]) ?? []
            return (
              <li
                key={row.id as string}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{row.title as string}</span>
                    <Link
                      href={`/${artist.slug}/r/${row.slug as string}`}
                      className="ml-3 text-xs text-zinc-500 hover:underline"
                    >
                      /{artist.slug}/r/{row.slug as string}
                    </Link>
                  </div>
                  <form action={deleteContentAction.bind(null, 'release', row.id as string, id)}>
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      Delete
                    </button>
                  </form>
                </div>

                <ul className="mt-3 space-y-1">
                  {links.map((l, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{l.label}</span>
                      <span className="flex-1 truncate text-xs text-zinc-400">{l.url}</span>
                      <form action={removeReleaseLinkAction.bind(null, row.id as string, i, id)}>
                        <button type="submit" className="text-xs text-red-600 hover:underline">
                          remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>

                <form
                  action={addReleaseLinkAction.bind(null, row.id as string, id)}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input name="label" placeholder="Platform (e.g. Spotify)" required className={`${inputClass} w-44`} />
                  <input name="url" type="url" placeholder="https://…" required className={`${inputClass} flex-1`} />
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Add link
                  </button>
                </form>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No releases yet.
        </p>
      )}
    </SectionShell>
  )
}
