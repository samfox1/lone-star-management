'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { ICON_BOLD } from '@/components/ui/icon-hover'
import { FOCUS_RING } from './(manager-tools)/_ui/focus-ring'
import { deleteMediaAction } from './actions'
import { useConfirm } from './confirm-dialog'
import { toast } from './toast'

/** Client delete for a media asset (hero video / profile photo): calls
 *  deleteMediaAction and confirms with a toast ("{noun} removed", or the error).
 *
 *  A RED TRASH GLYPH, not the word "Delete" (Sam, 2026-10-02: icons over words; 2026-10-05).
 *  Its name ("Delete photo") is the hover title and the accessible name. A 28px target.
 *
 *  IRREVERSIBLE — the file leaves Storage along with the row, and nothing restores it —
 *  so it is gated behind the app's own confirm dialog, the same gate ActionButton applies to its
 *  destructive callers. `confirm` overrides the wording; it can't be waived. */
export function MediaDeleteButton({
  mediaId,
  storagePath,
  artistId,
  noun,
  confirm,
  className,
}: {
  mediaId: string
  storagePath: string
  artistId: string
  noun: string
  /** Override the confirmation wording. Never optional — only the text is. */
  confirm?: string
  /** Placement only (the glyph's look is its own). */
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const { ask, dialog } = useConfirm()
  // No re-entry ref: see DeleteButton. The question covers the button until it is answered,
  // and `useConfirm` keeps only one question at a time.
  async function onClick() {
    if (!(await ask(confirm ?? `Delete this ${noun.toLowerCase()}? This can't be undone.`))) return
    setBusy(true)
    try {
      const res = await deleteMediaAction(mediaId, storagePath, artistId)
      if (res?.error) toast(res.error, 'error')
      else toast(`${noun} removed`)
    } catch {
      toast(`Couldn't remove that ${noun.toLowerCase()}.`, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={`Delete ${noun.toLowerCase()}`}
        title={`Delete ${noun.toLowerCase()}`}
        className={cx(
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-accent-red transition-opacity disabled:opacity-40',
          ICON_BOLD,
          FOCUS_RING,
          className,
        )}
      >
        <Icon name="trash" size={15} />
      </button>
      {dialog}
    </>
  )
}
