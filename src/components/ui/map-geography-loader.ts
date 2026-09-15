'use client'

import { useEffect, useState } from 'react'
import type { FlatGeography, GlobeGeography } from '@/lib/map-geography'

/**
 * The baked geography, loaded by the browser once and shared by every map on the page. Each kind is
 * its own chunk, fetched on first use: the flat map's when the map first shows, the globe's only when
 * the globe first opens. It used to ride in every page's props, ~860 KB a request.
 *
 * This is the ONE place src/data is reached from the client, and only by a dynamic import()
 * (client-imports.test.ts holds that line).
 */
type Kinds = { flat: FlatGeography; globe: GlobeGeography }
type Kind = keyof Kinds

const importers: { [K in Kind]: () => Promise<Kinds[K]> } = {
  flat: () => import('@/data/map-flat.json').then((m) => m.default as unknown as FlatGeography),
  globe: () => import('@/data/map-globe.json').then((m) => m.default as unknown as GlobeGeography),
}
const loaded = new Map<Kind, unknown>()
const pending = new Map<Kind, Promise<unknown>>()

function fetchGeography<K extends Kind>(kind: K): Promise<Kinds[K]> {
  let p = pending.get(kind) as Promise<Kinds[K]> | undefined
  if (!p) {
    p = importers[kind]().then((g) => {
      loaded.set(kind, g)
      return g
    })
    // A failed fetch (a deploy mid-session renames the chunk) is not cached: the next mount tries again.
    p.catch(() => pending.delete(kind))
    pending.set(kind, p)
  }
  return p
}

/** One kind of geography: at once when it has loaded before, otherwise after it arrives. `enabled` false fetches nothing yet. */
export function useGeography<K extends Kind>(kind: K, enabled = true): { geography: Kinds[K] | null; failed: boolean } {
  const [geography, setGeography] = useState<Kinds[K] | null>(() => (loaded.get(kind) as Kinds[K] | undefined) ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!enabled || geography) return
    let live = true
    fetchGeography(kind).then(
      (g) => { if (live) setGeography(g) },
      () => { if (live) setFailed(true) },
    )
    return () => { live = false }
  }, [kind, enabled, geography])
  return { geography, failed }
}
