'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { runSerialized, type SaveStatus } from './inspector-shared'

/** Long enough that typing a sentence (or dragging a slider) coalesces into one write,
 *  short enough that tabbing away feels saved. The value every panel debounced at. */
const DEFAULT_DEBOUNCE_MS = 500

/** What a save action resolves to. `runSerialized` reads `.error`; an action that
 *  returns only `{ ok }` is fine (a missing `.error` reads as success — the existing
 *  behaviour, preserved). One permissive shape so it stays assignable to runSerialized's
 *  `{ error? } | void` while still accepting the `{ ok }`-returning actions. */
type SaveResult = { error?: string; ok?: boolean } | void
type SaveAction = () => Promise<SaveResult>

/**
 * THE debounced per-field save machinery, factored out of the six panels that each
 * hand-rolled a byte-identical copy of it (Style, Text, Links, Video, Merch, Tour) on
 * top of `runSerialized`. One shape, one place — so the ordering (#6) and errored-set
 * (#8) correctness, the debounce, and the unmount flush can't drift apart across panels.
 *
 * What it owns, per KEY (a field id / region key / act name):
 *  • a 500ms debounce, so a typing burst or a slider drag is one write;
 *  • optimistic repaint via `onApply` (the frame bridge), fired only for a valid value;
 *  • SERIALIZED persistence (`runSerialized`), so an older keystroke's write can't land
 *    after a newer one, and one field's failure isn't masked by another's success;
 *  • a flush on unmount, so tabbing away can't drop the last pending change.
 *
 * It deliberately does NOT own the displayed value: each panel keeps its own text/values
 * state (some re-seed from the bridge, some keep raw-vs-trimmed, some are objects), and a
 * hook that also owned display would have to model all of that. `save` returns whether
 * the value was accepted so the caller can drive its own invalid state from one source.
 *
 * `runNow` is the non-debounced door onto the same serialized runner + status, for the
 * discrete saves that must NOT debounce (adding a tour act; the cursor panel's immediate,
 * revert-on-failure writes).
 */
export function useDebouncedFieldSave<V>({
  persist,
  normalize,
  onApply,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: {
  /** Write one key's value. The same thunk runs on debounce AND on the unmount flush. */
  persist: (key: string, value: V) => Promise<SaveResult>
  /** Validate/transform the input before it is saved: return the value to persist, or
   *  `null` to reject it (nothing painted, nothing queued, `save` returns false). The
   *  transform lets a panel save a trimmed/cleaned value while displaying the raw one. */
  normalize?: (input: V) => V | null
  /** Optimistic live-preview paint over the bridge, for an accepted value only. */
  onApply?: (key: string, value: V) => void
  debounceMs?: number
}): {
  status: SaveStatus
  /** Queue a debounced save. Returns false when `normalize` rejected the input. */
  save: (key: string, input: V) => boolean
  /** Run a save immediately through the shared serialized runner + status — for the
   *  discrete (non-debounced) writes a panel also makes. */
  runNow: (key: string, action: SaveAction) => void
} {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, V>>(new Map())

  // Read persist/normalize/onApply through refs so `save`/`runNow` stay stable even when
  // a caller passes inline callbacks, and so the unmount-flush closure always fires the
  // LATEST persist (a changed artistId) without re-subscribing the effect.
  const persistRef = useRef(persist)
  const normalizeRef = useRef(normalize)
  const onApplyRef = useRef(onApply)
  useEffect(() => {
    persistRef.current = persist
    normalizeRef.current = normalize
    onApplyRef.current = onApply
  })

  const runNow = useCallback((key: string, action: SaveAction) => {
    setStatus('saving')
    runSerialized(saving, errored, setStatus, key, action)
  }, [])

  const save = useCallback(
    (key: string, input: V): boolean => {
      const value = normalizeRef.current ? normalizeRef.current(input) : input
      const existing = timers.current.get(key)
      if (existing) clearTimeout(existing)
      timers.current.delete(key)
      if (value === null) {
        // Newest input wins: a rejected value cancels any still-pending save for this
        // key, so an earlier valid keystroke can't land under a field the manager has
        // since made invalid (nor flush that stale value on unmount).
        pending.current.delete(key)
        return false
      }
      onApplyRef.current?.(key, value)
      pending.current.set(key, value)
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key)
          pending.current.delete(key)
          runNow(key, () => persistRef.current(key, value))
        }, debounceMs),
      )
      return true
    },
    [debounceMs, runNow],
  )

  // Flush still-pending edits on unmount so a fast tab-away can't drop the last one.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((value, key) => {
        void persistRef.current(key, value)
      })
    }
  }, [])

  return { status, save, runNow }
}
