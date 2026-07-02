'use client'

import { useState } from 'react'
import Link from 'next/link'
import { buttonClass, inputClass } from '@/components/ui/ui'
import {
  addReleaseLinkAction,
  deleteContentAction,
  removeReleaseLinkAction,
} from '../actions'

type ReleaseLink = { label: string; url: string }
export type Release = {
  id: string
  title: string
  slug: string
  cover_url: string | null
  release_date: string | null
  links: ReleaseLink[]
}

/**
 * A release as a clean cover-grid card; clicking it opens a modal to manage its
 * public smart-link (/[slug]/r/[release]) DSP buttons + delete. Keeps the grid
 * uncluttered while preserving the full editor.
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
  const [open, setOpen] = useState(false)
  const year = release.release_date?.slice(0, 4)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group block w-full text-left">
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
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="max-h-[88vh] w-[460px] max-w-full overflow-auto rounded-2xl bg-paper p-6 shadow-2xl">
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
                <Link
                  href={`/${artistSlug}/r/${release.slug}`}
                  className="font-space text-xs text-ink-muted hover:underline"
                >
                  /{artistSlug}/r/{release.slug}
                </Link>
              </div>
            </div>

            <div className="mt-5 font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
              Streaming links
            </div>
            <ul className="mt-2 space-y-1">
              {release.links.length === 0 && (
                <li className="font-space text-xs text-ink-faint">None yet.</li>
              )}
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
            <form
              action={addReleaseLinkAction.bind(null, release.id, artistId)}
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              <input name="label" placeholder="Platform (e.g. Spotify)" required className={`${inputClass} w-36`} />
              <input name="url" type="url" placeholder="https://…" required className={`${inputClass} flex-1`} />
              <button type="submit" className={buttonClass('ghost')}>
                Add link
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between">
              <form action={deleteContentAction.bind(null, 'release', release.id, artistId)}>
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
                >
                  Delete release
                </button>
              </form>
              <button type="button" onClick={() => setOpen(false)} className={buttonClass('ghost')}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
