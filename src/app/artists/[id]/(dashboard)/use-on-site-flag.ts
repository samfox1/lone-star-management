'use client'

import { useMemo, useState, useTransition } from 'react'

/**
 * An optimistic per-row `on_site` flag with an injected write (PRESENCE_PLAN.md S1).
 *
 * The same shape as `useLiveOnSite`, generalised over WHICH action writes the row, so a
 * DRAFT-PRESENCE type (a release, whose write cascades to its songs) and a LIVE-TOGGLE
 * type can share the optimistic bookkeeping without sharing an action. The checkbox IS
 * the working-row state either way; what differs is when fans see it, and that is the
 * door's business, not this hook's.
 *
 * Re-seeds when the server's set changes (after a refresh), by adjusting state during
 * render keyed on which ids are on — the sanctioned reset-on-prop-change pattern.
 */
export function useOnSiteFlag<T extends { id: string; on_site: boolean }>(
  items: T[],
  write: (id: string, on: boolean) => Promise<{ error?: string } | undefined | void>,
  onError?: (message: string) => void,
) {
  const key = useMemo(() => items.filter((i) => i.on_site).map((i) => i.id).sort().join(','), [items])
  const seed = () => ({ key, ids: new Set(items.filter((i) => i.on_site).map((i) => i.id)) })
  const [state, setState] = useState(seed)
  if (state.key !== key) setState(seed())
  const [busy, start] = useTransition()

  const set = (id: string, on: boolean) =>
    setState((prev) => {
      const ids = new Set(prev.ids)
      if (on) ids.add(id)
      else ids.delete(id)
      return { key: prev.key, ids }
    })

  function toggle(id: string) {
    const next = !state.ids.has(id)
    set(id, next) // optimistic
    start(async () => {
      const res = await write(id, next)
      if (res && 'error' in res && res.error) {
        set(id, !next) // revert just this row
        onError?.(res.error)
      }
    })
  }

  return { onSite: (id: string) => state.ids.has(id), toggle, busy }
}
