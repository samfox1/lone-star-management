'use client'

import { useState, type ReactNode } from 'react'
import { deleteContentAction } from './actions'
import { useConfirm } from './confirm-dialog'
import { toast } from './toast'
import type { CrudEntity } from '@/lib/content'

/**
 * Client delete button for server-rendered lists (content-sections): calls
 * deleteContentAction and confirms with a toast ("{noun} deleted", or the error).
 * Card grids use CardModal's built-in delete; this is for the plain list rows.
 *
 * The delete is IRREVERSIBLE — the row is gone, there is no undo and no trash — so it
 * is gated behind the app's own confirm dialog, the same gate ActionButton's `confirm` applies
 * to its destructive callers. `confirm` overrides the wording; it can't be waived.
 */
export function DeleteButton({
  type,
  id,
  artistId,
  noun,
  confirm,
  className,
  children,
}: {
  type: CrudEntity
  id: string
  artistId: string
  noun: string
  /** Override the confirmation wording. Never optional — only the text is. */
  confirm?: string
  className?: string
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const { ask, dialog } = useConfirm()
  // No re-entry ref here, unlike ActionButton. The question is a full-screen dialog and the
  // delete cannot start until it is answered, so there is no window in which a second click
  // reaches this handler: the first click's own dialog is covering the button. `useConfirm`
  // keeps ONE question at a time (confirm-dialog.tsx, pinned by its own test), which is what
  // actually makes a second press harmless. A ref here latched nothing — deleting it changed
  // no test, which is how it was found.
  async function onClick() {
    if (!(await ask(confirm ?? `Delete this ${noun.toLowerCase()}? This can't be undone.`))) return
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
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" onClick={onClick} disabled={busy} className={className}>
        {busy ? 'Deleting…' : children}
      </button>
      {dialog}
    </>
  )
}
