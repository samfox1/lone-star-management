'use client'

import { useEffect, useRef, useState } from 'react'
import { buttonClass, inputClass, modalOverlayClass, modalCardClass } from '@/components/ui/ui'
import { useLockBodyScroll } from './use-lock-body-scroll'

/**
 * The publish control shared by every on-site content list (releases, videos, merch,
 * tour): a floating button, bottom-right. It lights up when there's something to
 * publish — a selection⇄live delta (`pendingCount`, the reconcile browsers) OR
 * unpublished content edits (`dirty`, the live-toggle browsers, where presence is
 * already live and only content needs pushing). Opens a password prompt — publishing
 * to the public site is password-gated — and hands the entered password to `onPublish`,
 * which commits the change. Shows the server's error inline (e.g. a wrong password)
 * and clears the field on success. `noun` names what's being published in the modal.
 */
export function PublishBar({
  pendingCount,
  dirty = false,
  onPublish,
  noun = 'releases',
}: {
  pendingCount: number
  /** Unpublished CONTENT edits (renames, links…) — enables publish even when the
   *  on-site selection is unchanged, so an edit is never stranded as a draft. */
  dirty?: boolean
  onPublish: (password: string) => Promise<{ ok: boolean; error?: string }>
  /** Plural noun for the modal copy, e.g. "videos". Defaults to "releases". */
  noun?: string
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // close() is captured by the Escape effect (deps [open]); a ref (synced in an
  // effect, never during render) keeps its busy check live so Escape / an overlay
  // click can't dismiss the modal mid-publish.
  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])
  function close() {
    if (busyRef.current) return
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // The bar is ALWAYS visible; it's just greyed out (disabled) until a toggle
  // creates a pending change (or a content edit is waiting), then it lights up.
  const enabled = pendingCount > 0 || dirty
  useLockBodyScroll(open && enabled) // the dialog only renders when open && enabled

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    const res = await onPublish(password)
    setBusy(false)
    if (res.ok) {
      setPassword('')
      setOpen(false)
    } else {
      setError(res.error ?? 'Publish failed.')
    }
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-40">
        <button
          type="button"
          onClick={() => enabled && setOpen(true)}
          disabled={!enabled}
          title={
            pendingCount > 0
              ? `Publish ${pendingCount} change${pendingCount === 1 ? '' : 's'}`
              : enabled
                ? 'Publish your latest edits'
                : 'No changes to publish'
          }
          className={
            enabled
              ? 'inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 font-space text-sm font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover'
              : 'inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-hairline bg-surface px-5 py-3 font-space text-sm font-semibold text-ink-faint shadow-sm'
          }
        >
          Publish
          {pendingCount > 0 && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs tabular-nums">{pendingCount}</span>
          )}
        </button>
      </div>

      {open && enabled && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <form onSubmit={submit} className={modalCardClass}>
            <h2 className="text-lg font-bold tracking-[-0.01em]">Publish to the site</h2>
            <p className="mt-1 font-space text-xs text-ink-muted">
              {pendingCount > 0
                ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} to your public ${noun}.`
                : `Push your latest edits to your public ${noun}.`}{' '}
              Enter your password to confirm.
            </p>

            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className={`${inputClass} mt-4 w-full`}
            />

            {error && (
              <p role="alert" className="mt-2 font-space text-xs text-accent-red">
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className={buttonClass('ghost')}>
                Cancel
              </button>
              <button type="submit" disabled={!password || busy} className={buttonClass('solid')}>
                {busy ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
