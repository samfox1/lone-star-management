'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a copy's check stays up. */
const FLASH_MS = 1400

/**
 * Copy text: the async clipboard first, and when a browser refuses it (permissions, an
 * insecure origin) or has none, a hidden textarea selected and copied the old way. Focus goes
 * back where it was, so a keyboard user is not dropped on <body>. False only if both failed.
 * (Subscribers' copy; Enquiries' copy-address since 2026-10-05.)
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused: fall back below.
  }
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  prev?.focus()
  return ok
}

/** A value that shows for FLASH_MS, then clears. A second flash restarts the clock. */
export function useFlash<T>(): [T | null, (v: T) => void] {
  const [value, setValue] = useState<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const flash = useCallback((v: T) => {
    if (timer.current) clearTimeout(timer.current)
    setValue(v)
    timer.current = setTimeout(() => {
      timer.current = null
      setValue(null)
    }, FLASH_MS)
  }, [])
  return [value, flash]
}
