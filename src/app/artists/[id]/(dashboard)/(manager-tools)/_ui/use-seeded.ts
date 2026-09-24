'use client'

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * LOCAL STATE SEEDED FROM A PROP, AND RE-SEEDED WHEN THE PROP CHANGES. The optimistic
 * value a row shows while its save is out, or the rows a list holds between refreshes.
 *
 * Brand's inline text, the Settings rows and the Connections list each spelled this out by
 * hand as `useState({ from, now })` plus a render-phase reset. The reset is the point: a
 * refresh after another save sends a new prop, and a stale optimistic value must not
 * outlive the server's. It happens while rendering (React's pattern for "reset when a prop
 * changes"), not in an effect, so there is never a painted frame showing the stale value.
 *
 * The prop is compared by identity: pass the server's value or array, not one rebuilt on
 * every render, or it re-seeds every time.
 */
export function useSeeded<T>(prop: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState({ from: prop, now: prop })
  const stale = state.from !== prop
  if (stale) setState({ from: prop, now: prop })
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => setState((s) => ({ ...s, now: typeof next === 'function' ? (next as (prev: T) => T)(s.now) : next })),
    [],
  )
  return [stale ? prop : state.now, set]
}
