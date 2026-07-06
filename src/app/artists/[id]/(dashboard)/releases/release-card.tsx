'use client'

import Link from 'next/link'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { GridCard } from '../grid-card'
import {
  addReleaseLinkAction,
  deleteContentAction,
  removeReleaseLinkAction,
} from '../actions'

export type ReleaseLink = { label: string; url: string }
export type Release = {
  id: string
  title: string
  slug: string
  cover_url: string | null
  release_date: string | null
  links: ReleaseLink[]
}

/**
 * A release as a cover-grid tile; opens a modal to manage its public smart-link
 * (/[slug]/r/[release]) DSP buttons + delete.
 */
export function ReleaseCard({
  release,
  artistId,
  artistSlug,
}: {
  release: Release
  artistId: string
  artistSlug: string
}) {
  const year = release.release_date?.slice(0, 4)

  return (
    <GridCard
      deleteAction={deleteContentAction.bind(null, 'release', release.id, artistId)}
      deleteLabel="Delete release"
      tile={
        <>
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
            {release.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="h-9 w-9 rounded-full bg-ink" />
            )}
          </div>
          <div className="mt-3 truncate text-[15px] font-bold tracking-[-0.01em] group-hover:text-accent">
            {release.title}
          </div>
          {year && <div className="mt-0.5 font-space text-[13px] text-ink-muted">{year}</div>}
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface">
          {release.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="h-7 w-7 rounded-full bg-ink" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold tracking-[-0.01em]">{release.title}</h3>
          <Link href={`/${artistSlug}/r/${release.slug}`} className="font-space text-xs text-ink-muted hover:underline">
            /{artistSlug}/r/{release.slug}
          </Link>
        </div>
      </div>

      <div className="mt-5 font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
        Streaming links
      </div>
      <ul className="mt-2 space-y-1">
        {release.links.length === 0 && <li className="font-space text-xs text-ink-faint">None yet.</li>}
        {release.links.map((l, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{l.label}</span>
            <span className="flex-1 truncate font-space text-xs text-ink-faint">{l.url}</span>
            <form action={removeReleaseLinkAction.bind(null, release.id, i, artistId)}>
              <button type="submit" className="font-space text-xs text-accent-red hover:underline">
                remove
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form action={addReleaseLinkAction.bind(null, release.id, artistId)} className="mt-3 flex flex-wrap items-center gap-2">
        <input name="label" placeholder="Platform (e.g. Spotify)" required className={`${inputClass} w-36`} />
        <input name="url" type="url" placeholder="https://…" required className={`${inputClass} flex-1`} />
        <button type="submit" className={buttonClass('ghost')}>
          Add link
        </button>
      </form>
    </GridCard>
  )
}
