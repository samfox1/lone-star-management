'use client'

import { useState } from 'react'
import { deleteMediaAction } from './actions'
import { useConfirm } from './confirm-dialog'
import { toast } from './toast'

/** Client delete for a media asset (hero video / profile photo): calls
 *  deleteMediaAction and confirms with a toast ("{noun} removed", or the error).
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
      <button type="button" onClick={onClick} disabled={busy} className={className}>
        {busy ? 'Removing…' : 'Delete'}
      </button>
      {dialog}
    </>
  )
}
