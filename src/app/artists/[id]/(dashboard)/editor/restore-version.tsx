'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { EYEBROW, plural } from './inspector-shared'
import { listPublishMomentsAction, restorePublishedAction } from '../actions'
import type { PublishMoment } from '@/lib/content'

/**
 * The three-dot menu beside Publish, and the one thing in it: Restore version
 * (Sam, 2026-08-15).
 *
 * Deliberately NOT the inspector's "Remove changes" button. Those are different acts and
 * they were confusing each other while they shared one control: Remove changes undoes what
 * the manager just did, cheap and expected; restoring a version reaches past the session
 * into what visitors have already seen. This one sits next to Publish because it belongs
 * to the same idea — what the public gets — and it asks before it acts.
 */
export function RestoreVersionMenu({ artistId }: { artistId: string }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // A menu that outlives the click that dismissed it is a menu in the way. Same
  // mousedown-not-click reasoning as the inspector rows: it fires before whatever the
  // manager actually meant to press.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function restore(at: string) {
    setRestoring(true)
    try {
      await restorePublishedAction(artistId, at)
      // The draft changed underneath every panel and the preview — re-read it, or the
      // editor keeps showing the values that were just thrown away.
      router.refresh()
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
      >
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-lg border border-hairline bg-paper py-1 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setPicking(true)
            }}
            className="w-full px-3 py-2 text-left font-space text-[12px] text-ink hover:bg-surface"
          >
            Restore version
          </button>
        </div>
      )}
      {picking && (
        <RestoreDialog
          artistId={artistId}
          busy={restoring}
          onCancel={() => setPicking(false)}
          onRestore={(at) => {
            setPicking(false)
            void restore(at)
          }}
        />
      )}
    </div>
  )
}

/** "14 Aug, 6:00 pm" — a moment a manager can recognise, not an ISO string. */
export function momentLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Pick a published version and confirm. The newest is preselected, so the common case
 * ("put it back the way it was") is two clicks and needs no reading.
 */
function RestoreDialog({
  artistId,
  busy,
  onCancel,
  onRestore,
}: {
  artistId: string
  busy: boolean
  onCancel: () => void
  onRestore: (at: string) => void
}) {
  const [moments, setMoments] = useState<PublishMoment[] | null>(null)
  const [chosen, setChosen] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    listPublishMomentsAction(artistId).then((res) => {
      if (!live) return
      const list = res.ok ? (res.moments ?? []) : []
      setMoments(list)
      setChosen(list[0]?.publishedAt)
    })
    return () => {
      live = false
    }
  }, [artistId])

  const nothingPublished = moments !== null && moments.length === 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Restore version"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-hairline bg-paper p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Restore version</h2>
        {nothingPublished ? (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            There is nothing published yet, so there is no earlier version to go back to.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              Put the site back to how it looked at an earlier publish. Anything changed
              since then will be lost.
            </p>
            <div role="radiogroup" aria-label="Version" className="mt-3 max-h-52 space-y-1 overflow-y-auto">
              {(moments ?? []).map((m, i) => (
                <button
                  key={m.publishedAt}
                  type="button"
                  role="radio"
                  aria-checked={chosen === m.publishedAt}
                  aria-label={`${momentLabel(m.publishedAt)}${i === 0 ? ', most recent' : ''} — ${plural(m.entities, 'change')}`}
                  onClick={() => setChosen(m.publishedAt)}
                  className={cx(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors',
                    chosen === m.publishedAt ? 'border-ink bg-surface' : 'border-hairline hover:border-ink-faint',
                  )}
                >
                  <span className="font-space text-[12px] text-ink">
                    {momentLabel(m.publishedAt)}
                    {i === 0 && <span className={cx(EYEBROW, 'ml-2')}>Most recent</span>}
                  </span>
                  <span className="font-space text-[11px] text-ink-faint">{plural(m.entities, 'change')}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted hover:border-ink hover:text-ink"
          >
            Cancel
          </button>
          {/* No restore button at all when there is nothing to restore — an enabled
              control that could only do nothing is worse than its absence. */}
          {!nothingPublished && (
            <button
              type="button"
              disabled={busy || !chosen}
              onClick={() => chosen && onRestore(chosen)}
              className="flex-1 rounded-lg border border-accent-red bg-accent-red px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-paper hover:opacity-85 disabled:opacity-40"
            >
              {busy ? 'Restoring…' : 'Restore this version'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
