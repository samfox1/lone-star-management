'use client'

import { useRef, useState, type ReactNode } from 'react'
import { deleteContentAction } from './actions'
import { toast } from './toast'
import type { CrudEntity } from '@/lib/content'

/**
 * Client delete button for server-rendered lists (content-sections): calls
 * deleteContentAction and confirms with a toast ("{noun} deleted", or the error).
 * Card grids use CardModal's built-in delete; this is for the plain list rows.
 */
export function DeleteButton({
  type,
  id,
  artistId,
  noun,
  className,
  children,
}: {
  type: CrudEntity
  id: string
  artistId: string
  noun: string
  className?: string
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false) // hard re-entry latch (state is a stale closure across fast clicks)
  async function onClick() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await deleteContentAction(type, id, artistId)
      if (res?.error) {
        toast(res.error, 'error')
        return
      }
      toast(`${noun} deleted`)
    } catch {
      toast(`Couldn't delete that ${noun.toLowerCase()}.`, 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {busy ? 'Deleting…' : children}
    </button>
  )
}
