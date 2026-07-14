'use client'

import { useMemo, useState } from 'react'

/**
 * The "which items are on the site" selection shared by every publish-gated browser
 * (releases, videos, merch, tour). Seeds the desired on-site set from what's
 * currently live (`on_site`), and re-seeds when the server's live set changes — after
 * a successful publish + refresh — by adjusting state during render, keyed on which
 * ids are actually on-site (the sanctioned "reset state on prop change" pattern).
 *
 * `pendingCount` is the size of the selection ⇄ live delta: it drives the PublishBar,
 * which appears only when the manager's selection differs from what's live.
 */
export function useOnSiteSelection<T extends { id: string; on_site: boolean }>(items: T[]) {
  const liveKey = useMemo(
    () => items.filter((i) => i.on_site).map((i) => i.id).sort().join(','),
    [items],
  )
  const seed = () => ({ key: liveKey, ids: new Set(items.filter((i) => i.on_site).map((i) => i.id)) })
  const [sel, setSel] = useState(seed)
  if (sel.key !== liveKey) setSel(seed())

  const toggle = (id: string) =>
    setSel((prev) => {
      const ids = new Set(prev.ids)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      return { key: prev.key, ids }
    })

  const pendingCount = items.filter((i) => sel.ids.has(i.id) !== i.on_site).length

  return { selected: sel.ids, toggle, pendingCount }
}
