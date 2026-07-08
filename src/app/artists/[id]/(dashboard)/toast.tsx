'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'

export type ToastKind = 'success' | 'error'
type Toast = { id: number; message: string; kind: ToastKind }
type Listener = (t: Toast) => void

// Module-level pub/sub so any component can raise a toast without prop-drilling or a
// context — `<Toaster/>` (mounted once in the dashboard layout) is the only subscriber.
let listeners: Listener[] = []
let nextId = 1

/** Raise a transient toast, e.g. `toast('Video uploaded')` / `toast(err, 'error')`. */
export function toast(message: string, kind: ToastKind = 'success') {
  const t = { id: nextId++, message, kind }
  for (const l of listeners) l(t)
}

/** The toast stack: bottom-right, auto-dismiss, click to dismiss. Mounted once. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const l: Listener = (t) => {
      setToasts((cur) => [...cur, t])
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 4500)
    }
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  }, [])

  const dismiss = (id: number) => setToasts((cur) => cur.filter((x) => x.id !== id))

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cx(
            'toast-in pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border bg-paper px-4 py-3 text-left text-sm shadow-lg',
            t.kind === 'error' ? 'border-accent-red/30' : 'border-hairline',
          )}
        >
          <Icon
            name={t.kind === 'error' ? 'alert' : 'check'}
            size={15}
            className={cx('mt-px flex-none', t.kind === 'error' ? 'text-accent-red' : 'text-ink')}
          />
          <span className={cx('font-medium leading-snug', t.kind === 'error' ? 'text-accent-red' : 'text-ink')}>
            {t.message}
          </span>
        </button>
      ))}
    </div>
  )
}
