'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import type { SectionDiff, UnpublishedDiff } from '@/lib/content'
import { useLockBodyScroll } from '../use-lock-body-scroll'
import { getUnpublishedDiffAction, publishAllGatedAction } from '../actions'

/**
 * The visual editor's PUBLISH control (SITE_EDITOR_PLAN.md phase 4). Opens a
 * review-and-approve window: a summary of everything changed since the last publish
 * (per section, from `getUnpublishedDiffAction`), then a password confirm that
 * publishes it all (`publishAllGatedAction`). Selective per-change toggles are a
 * follow-up (needs per-item diff + selective publish plumbing).
 */

/** Must cover EVERY key of `UnpublishedDiff`. A missing section contributes zero to the
 *  total, so the window reports "all caught up" and hides the publish control while real
 *  edits sit unpublished — which is what happened to `site_styles`, publishable since
 *  20260714120000 but absent here. Pinned by tests/editor-publish.test.tsx. */
const SECTIONS: { key: keyof UnpublishedDiff; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'site_content', label: 'Site text' },
  { key: 'site_styles', label: 'Styles' },
  { key: 'media', label: 'Photos & media' },
  { key: 'track', label: 'Songs' },
  { key: 'release', label: 'Releases' },
  { key: 'video', label: 'Videos' },
  { key: 'merch', label: 'Merch' },
  { key: 'tour_date', label: 'Tour dates' },
  { key: 'link', label: 'Links' },
]

function describe(d: SectionDiff): string {
  const parts: string[] = []
  if (d.added) parts.push(`${d.added} added`)
  if (d.edited) parts.push(`${d.edited} edited`)
  if (d.deleted) parts.push(`${d.deleted} removed`)
  return parts.join(' · ')
}
function totalChanges(diff: UnpublishedDiff): number {
  return SECTIONS.reduce((n, s) => n + diff[s.key].added + diff[s.key].edited + diff[s.key].deleted, 0)
}

export function EditorPublish({ artistId }: { artistId: string }) {
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<UnpublishedDiff | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useLockBodyScroll(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy])

  async function openWindow() {
    setOpen(true)
    setDiff(null)
    setPassword('')
    setError(null)
    setDone(false)
    setDiff(await getUnpublishedDiffAction(artistId))
  }
  function close() {
    if (!busy) setOpen(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    const res = await publishAllGatedAction(artistId, password)
    setBusy(false)
    if (res.ok) {
      setPassword('')
      setDone(true)
      setDiff(await getUnpublishedDiffAction(artistId)) // now zero — reflects live state
    } else {
      setError(res.error ?? 'Publish failed.')
    }
  }

  const dirtySections = diff ? SECTIONS.filter((s) => diff[s.key].dirty) : []
  const total = diff ? totalChanges(diff) : 0

  return (
    <>
      <button type="button" onClick={openWindow} className={buttonClass('accent')}>
        Publish
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <form onSubmit={submit} className={modalCardClass}>
            <h2 className="text-lg font-bold tracking-[-0.01em]">
              {done ? 'Published' : 'Review & publish'}
            </h2>

            {!diff ? (
              <p className="mt-1 font-space text-xs text-ink-muted">Checking for changes…</p>
            ) : done ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
                <span className="text-accent">
                  <Icon name="check" size={18} />
                </span>
                Your changes are live.
              </p>
            ) : total === 0 ? (
              <p className="mt-1 font-space text-xs text-ink-muted">
                You&apos;re all caught up — nothing to publish.
              </p>
            ) : (
              <>
                <p className="mt-1 font-space text-xs text-ink-muted">
                  {total} change{total === 1 ? '' : 's'} since your last publish. Enter your password to make
                  them live.
                </p>

                <ul className="mt-4 divide-y divide-hairline-soft rounded-lg border border-hairline">
                  {dirtySections.map((s) => (
                    <li key={String(s.key)} className="flex items-center justify-between px-3.5 py-2.5">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                        {describe(diff[s.key])}
                      </span>
                    </li>
                  ))}
                </ul>

                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  className={cx(inputClass, 'mt-4 w-full')}
                />
                {error && (
                  <p role="alert" className="mt-2 font-space text-xs text-accent-red">
                    {error}
                  </p>
                )}
              </>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className={buttonClass('ghost')}>
                {done || total === 0 ? 'Close' : 'Cancel'}
              </button>
              {!done && total > 0 && diff && (
                <button type="submit" disabled={!password || busy} className={buttonClass('accent')}>
                  {busy ? 'Publishing…' : 'Publish'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  )
}
