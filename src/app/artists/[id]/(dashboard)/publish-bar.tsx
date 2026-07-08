'use client'

import { useEffect, useState } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'

/**
 * The publish control shared by every on-site content list (releases, videos, merch,
 * tour): a floating button, bottom-right, that surfaces only when the on-site
 * selection differs from what's live. Opens a password prompt — publishing to the
 * public site is password-gated — and hands the entered password to `onPublish`,
 * which commits the change. Shows the server's error inline (e.g. a wrong password)
 * and clears the field on success. `noun` names what's being published in the modal.
 */
export function PublishBar({
  pendingCount,
  onPublish,
  noun = 'releases',
}: {
  pendingCount: number
  onPublish: (password: string) => Promise<{ ok: boolean; error?: string }>
  /** Plural noun for the modal copy, e.g. "videos". Defaults to "releases". */
  noun?: string
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // The bar is ALWAYS visible; it's just greyed out (disabled) until a toggle
  // creates a pending change, then it lights up with the count.
  const dirty = pendingCount > 0

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
          onClick={() => dirty && setOpen(true)}
          disabled={!dirty}
          title={dirty ? `Publish ${pendingCount} change${pendingCount === 1 ? '' : 's'}` : 'No changes to publish'}
          className={
            dirty
              ? 'inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 font-space text-sm font-semibold text-white shadow-lg transition-colors hover:bg-black'
              : 'inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-hairline bg-surface px-5 py-3 font-space text-sm font-semibold text-ink-faint shadow-sm'
          }
        >
          Publish
          {dirty && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs tabular-nums">{pendingCount}</span>
          )}
        </button>
      </div>

      {open && dirty && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <form onSubmit={submit} className="w-[400px] max-w-full rounded-2xl bg-paper p-6 shadow-2xl">
            <h2 className="text-lg font-bold tracking-[-0.01em]">Publish to the site</h2>
            <p className="mt-1 font-space text-xs text-ink-muted">
              {pendingCount} change{pendingCount === 1 ? '' : 's'} to your public {noun}. Enter your password to confirm.
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
              <button type="button" onClick={() => setOpen(false)} className={buttonClass('ghost')}>
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
