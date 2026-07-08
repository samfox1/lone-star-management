'use client'

import { useRef, type ReactNode } from 'react'
import { toast } from './toast'

/**
 * A form that confirms with a toast. Wraps an edit server action (bound to its
 * type/id/artistId, taking FormData → {error?}); on submit it runs client-side so it
 * can toast "Saved" (or the error) — the same post-action feedback uploads and deletes
 * give. Progressive-enhancement is traded for the toast, which is the point here.
 */
export function SaveForm({
  action,
  savedMessage = 'Saved',
  className,
  children,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | void>
  savedMessage?: string
  className?: string
  children: ReactNode
}) {
  const busyRef = useRef(false) // hard re-entry latch against a fast double-submit (Enter twice)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busyRef.current) return
    const fd = new FormData(e.currentTarget) // capture before the await
    busyRef.current = true
    try {
      const res = await action(fd)
      if (res && 'error' in res && res.error) {
        toast(res.error, 'error')
        return
      }
      toast(savedMessage)
    } catch {
      toast('Something went wrong saving.', 'error')
    } finally {
      busyRef.current = false
    }
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      {children}
    </form>
  )
}
