'use client'

import { useMemo, useState, useTransition } from 'react'
import { setOnSiteAction } from './actions'
import type { ToggleKind } from '@/lib/content'
import { toast } from './toast'

/**
 * The on-site toggle for a LIVE-TOGGLE type (ADR 0009): flipping it writes `on_site`
 * immediately and the public site follows without a publish, because every door gates
 * on the working row. This is the library-page half of the same control the editor
 * gives these types — both write the same flag with the same meaning, so the two
 * surfaces agree instead of racing.
 *
 * Contrast `useOnSiteFlag` with `setReleaseOnSiteAction`, which the Music page uses for
 * the DRAFT-PRESENCE types (release / track): same optimistic bookkeeping, but the door
 * reads the snapshot there, so the write is a draft until Publish (ADR 0010). Here the
 * checkbox IS the site. Never point this at a DRAFT_PRESENCE type.
 *
 * Optimistic, reverting just the one row on failure (same shape as the editor's
 * togglePhotoOnSite). Re-seeds when the server's live set changes, by adjusting state
 * during render keyed on which ids are on-site — the sanctioned reset-on-prop-change
 * pattern, matching useOnSiteSelection.
 */
export function useLiveOnSite<T extends { id: string; on_site: boolean }>(
  items: T[],
  kind: ToggleKind,
  artistId: string,
) {
  const liveKey = useMemo(
    () => items.filter((i) => i.on_site).map((i) => i.id).sort().join(','),
    [items],
  )
  const seed = () => ({ key: liveKey, ids: new Set(items.filter((i) => i.on_site).map((i) => i.id)) })
  const [live, setLive] = useState(seed)
  if (live.key !== liveKey) setLive(seed())
  const [busy, start] = useTransition()

  /** Flip one row's on_site, in place. */
  const write = (id: string, on: boolean) =>
    setLive((prev) => {
      const ids = new Set(prev.ids)
      if (on) ids.add(id)
      else ids.delete(id)
      return { key: prev.key, ids }
    })

  function toggle(id: string) {
    const next = !live.ids.has(id)
    write(id, next) // optimistic
    start(async () => {
      const res = await setOnSiteAction(kind, id, artistId, next)
      if (res?.error) {
        write(id, !next)
        toast(res.error, 'error')
      }
    })
  }

  return { onSite: (id: string) => live.ids.has(id), toggle, busy }
}
