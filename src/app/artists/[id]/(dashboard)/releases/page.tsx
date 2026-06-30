import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import {
  addReleaseAction,
  addReleaseLinkAction,
  deleteContentAction,
  removeReleaseLinkAction,
} from '../actions'

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
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">Add a release</h2>
        <form action={addReleaseAction.bind(null, id)} className="mt-2 flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Title" required className={`${inputClass} w-44`} />
          <input name="release_date" type="date" className={`${inputClass} w-40`} />
          <input name="cover_url" type="url" placeholder="Cover image URL" className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </form>
      </div>

      {rows.length > 0 ? (
        <ul className="space-y-4">
          {rows.map((row) => {
            const links = (row.links as ReleaseLink[]) ?? []
            const cover = row.cover_url as string | null
            return (
              <li
                key={row.id as string}
                className="rounded-xl border border-hairline bg-paper p-4"
              >
                <div className="flex items-start gap-4">
                  <div className="h-16 w-16 flex-none overflow-hidden rounded-lg border border-hairline bg-surface">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-ink-faint">
                        <Icon name="releases" size={24} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold">{row.title as string}</span>
                    <Link
                      href={`/${artist.slug}/r/${row.slug as string}`}
                      className="ml-3 font-space text-xs text-ink-muted hover:underline"
                    >
                      /{artist.slug}/r/{row.slug as string}
                    </Link>
                  </div>
                  <form action={deleteContentAction.bind(null, 'release', row.id as string, id)}>
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
                    >
                      Delete
                    </button>
                  </form>
                </div>

                <ul className="mt-3 space-y-1">
                  {links.map((l, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{l.label}</span>
                      <span className="flex-1 truncate font-space text-xs text-ink-faint">{l.url}</span>
                      <form action={removeReleaseLinkAction.bind(null, row.id as string, i, id)}>
                        <button type="submit" className="font-space text-xs text-accent-red hover:underline">
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
                    className="rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                  >
                    Add link
                  </button>
                </form>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center font-space text-sm text-ink-muted">
          No releases yet.
        </p>
      )}
    </SectionShell>
  )
}
