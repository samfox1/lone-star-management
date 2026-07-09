'use client'

import { useRef, useState, type ReactNode } from 'react'
import { toast } from './toast'

/**
 * A button that runs a field-less bound server action and confirms with a toast —
 * the click-to-run cousin of SaveForm, for actions carrying no form input (per-section
 * Publish, integration Pull, Shopify Disconnect). The action may return `{ error? }`
 * or `{ ok, error? }`; a non-empty `error` toasts as a failure, otherwise `savedMessage`.
 * An optional `confirm` string gates destructive actions behind window.confirm.
 */
export function ActionButton({
  action,
  savedMessage,
  busyLabel,
  confirm,
  disabled,
  className,
  children,
}: {
  action: () => Promise<{ error?: string; ok?: boolean } | void>
  savedMessage: string
  busyLabel?: string
  confirm?: string
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false) // hard re-entry latch (state is a stale closure across fast clicks)

  async function onClick() {
    if (busyRef.current) return
    if (confirm && !window.confirm(confirm)) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await action()
      if (res && 'error' in res && res.error) {
        toast(res.error, 'error')
        return
      }
      toast(savedMessage)
    } catch {
      toast('Something went wrong.', 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={className}>
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
