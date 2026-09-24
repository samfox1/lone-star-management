'use client'

import { useEffect, useRef } from 'react'

/**
 * "The Brand bar just reverted" — a window event, so a tab that keeps its OWN copy of what
 * the server said can take the server's word again.
 *
 * Why an event: the Colors tab seeds its palette ONCE and treats its copy as the truth (a
 * refresh landing mid-drag must not snap a swatch back — colors-ledger.tsx). That was safe
 * while nothing but the page itself changed colours. Now colours publish and Revert puts
 * them back (BRAND_SYNC_PLAN.md, 20260925120000), and the refresh that carries the reverted
 * palette looks exactly like any other refresh. The bar (in the layout) and the ledger (in
 * the page) share no state, so the bar says so out loud and the ledger re-seeds from the next
 * props it gets.
 */
export const BRAND_REVERTED = 'lone-star:brand-reverted'

export function announceBrandRevert(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BRAND_REVERTED))
}

/** Call `onRevert` whenever the Brand bar reverts. The newest callback is always the one
 *  called, without re-subscribing on every render. */
export function useOnBrandRevert(onRevert: () => void): void {
  const latest = useRef(onRevert)
  useEffect(() => {
    latest.current = onRevert
  })
  useEffect(() => {
    const handle = () => latest.current()
    window.addEventListener(BRAND_REVERTED, handle)
    return () => window.removeEventListener(BRAND_REVERTED, handle)
  }, [])
}
