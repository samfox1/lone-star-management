'use client'

import { useSyncExternalStore } from 'react'

/**
 * TIMES IN THE MANAGER'S OWN TIME ZONE. The server renders in its zone (UTC on a host), so a
 * time formatted there and again in the browser would differ and break hydration. So nothing
 * time-of-day renders until the browser has mounted: the server snapshot is `false` / `null`,
 * the browser's is the real thing, and React swaps them after hydration (useSyncExternalStore's
 * contract), with no effect and no setState.
 */
const nothing = () => () => {}

export function useMounted(): boolean {
  return useSyncExternalStore(nothing, () => true, () => false)
}

function everySecond(onTick: () => void) {
  const t = setInterval(onTick, 1000)
  return () => clearInterval(t)
}

/** Whole seconds, so two reads inside one second agree (a snapshot must be stable). */
const nowSecond = () => Math.floor(Date.now() / 1000) * 1000

/** The time now, in ms, ticking once a second while `ticking`; null on the server. */
export function useNow(ticking: boolean): number | null {
  return useSyncExternalStore(ticking ? everySecond : nothing, nowSecond, () => null)
}
