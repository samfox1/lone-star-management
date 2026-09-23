'use client'

import { useEffect } from 'react'

/**
 * Freeze background page scroll while `locked` (a modal/overlay is open), so the
 * page behind the dialog can't scroll. Restores the previous `body` overflow on
 * unlock/unmount. Stacking-safe: each lock captures the value it replaced, so
 * closing an inner modal restores the outer one's lock, and the last close
 * restores the original.
 */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [locked])
}
