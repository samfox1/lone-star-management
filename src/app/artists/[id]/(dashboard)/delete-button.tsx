'use client'

import { useState, type ReactNode } from 'react'
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
  async function onClick() {
    if (busy) return
    setBusy(true)
    const res = await deleteContentAction(type, id, artistId)
    setBusy(false)
    if (res?.error) {
      toast(res.error, 'error')
      return
    }
    toast(`${noun} deleted`)
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {busy ? 'Deleting…' : children}
    </button>
  )
}
