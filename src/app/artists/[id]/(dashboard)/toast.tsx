'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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

/** The stack's distance from the bottom of the screen when nothing is docked there. */
const STACK_BOTTOM = 24

// THE LIFT (visual check, 2026-09-23). A bar docked across the bottom of the screen — the
// Brand page's Publish bar — has its Revert and Publish bottom-right, exactly where the
// stack sits, so a toast raised while it was up covered them. The bar reports its height
// here while it is up and 0 when it goes; the stack rises by that much. Module-level, like
// `toast()`, so the bar needs no context or prop from the layout that mounts the Toaster.
let lift = 0
let liftListeners: (() => void)[] = []

/** Raise the toast stack by `px` (a docked bar's height); `liftToasts(0)` when it goes. */
export function liftToasts(px: number) {
  const next = Math.max(0, Math.round(px))
  if (next === lift) return
  lift = next
  for (const l of liftListeners) l()
}

function subscribeLift(onChange: () => void) {
  liftListeners.push(onChange)
  return () => {
    liftListeners = liftListeners.filter((x) => x !== onChange)
  }
}

/** The toast stack: bottom-right, auto-dismiss, click to dismiss. Mounted once. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const raised = useSyncExternalStore(subscribeLift, () => lift, () => 0)

  useEffect(() => {
    const l: Listener = (t) => {
      setToasts((cur) => [...cur, t])
      timers.current.push(setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 4500))
    }
    listeners.push(l)
    const pending = timers.current
    return () => {
      listeners = listeners.filter((x) => x !== l)
      for (const id of pending) clearTimeout(id)
    }
  }, [])

  const dismiss = (id: number) => setToasts((cur) => cur.filter((x) => x.id !== id))

  return (
    <div
      className="pointer-events-none fixed right-6 z-[60] flex flex-col items-end gap-2 motion-safe:transition-[bottom] motion-safe:duration-200"
      style={{ bottom: STACK_BOTTOM + raised }}
    >
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
