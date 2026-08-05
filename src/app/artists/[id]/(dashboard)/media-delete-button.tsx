'use client'

import { useRef, useState } from 'react'
import { deleteMediaAction } from './actions'
import { toast } from './toast'

/** Client delete for a media asset (hero video / profile photo): calls
 *  deleteMediaAction and confirms with a toast ("{noun} removed", or the error).
 *
 *  IRREVERSIBLE — the file leaves Storage along with the row, and nothing restores it —
 *  so it is gated behind window.confirm, the same gate ActionButton applies to its
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
  const busyRef = useRef(false)
  async function onClick() {
    if (busyRef.current) return
    if (!window.confirm(confirm ?? `Delete this ${noun.toLowerCase()}? This can't be undone.`)) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await deleteMediaAction(mediaId, storagePath, artistId)
      if (res?.error) toast(res.error, 'error')
      else toast(`${noun} removed`)
    } catch {
      toast(`Couldn't remove that ${noun.toLowerCase()}.`, 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {busy ? 'Removing…' : 'Delete'}
    </button>
  )
}
