'use client'

import { useEffect, useRef } from 'react'

/**
 * A ROW'S EDITOR OPENS WHEN THE PAGE IS ARRIVED AT BY ITS ID. A test's pencil (sections.ts
 * SEO_EDIT_TARGETS) links to `listing#share`, `listing#alt`, `facts#bio`, and its label says
 * what happens next ("Change the share picture", "Open the bio editor"): so landing there
 * opens that editor, not just the row.
 *
 * Checked after mount (a tick later, so the router has written the URL on a client-side
 * move) and on every hashchange. Never while rendering: the server has no hash.
 */
export function useOpenOnHash(id: string, onHit: () => void) {
  const hit = useRef(onHit)
  useEffect(() => {
    hit.current = onHit
  })
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${id}`) hit.current()
    }
    const t = setTimeout(check, 0)
    window.addEventListener('hashchange', check)
    return () => {
      clearTimeout(t)
      window.removeEventListener('hashchange', check)
    }
  }, [id])
}

/** Drop `#id` from the address once its editor closes, so a reload doesn't open it again. */
export function clearHash(id: string) {
  if (typeof window === 'undefined' || window.location.hash !== `#${id}`) return
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
}
