'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { runSerialized, type SaveStatus } from './inspector-shared'
import { saveEditorFieldAction } from '../actions'

/** Long enough that typing a sentence is one save, short enough that tabbing away
 *  feels saved. Same value the style panel debounces at. */
const DEBOUNCE_MS = 500

/**
 * The Text panel's values and their debounced save, OWNED ABOVE both views.
 *
 * The list and the full-panel editor are two windows onto the same field. If each held
 * its own copy, opening Edit after typing would show the stale value, and both copies
 * would run their own debounce — two writes racing for one key, last-writer-wins,
 * against a live site. One hook, one source, both views.
 *
 * Mirrors `useStyleRegionSave`: serialized per key (never two in flight for one field),
 * status shared across fields, and pending edits flushed on unmount so a fast tab-away
 * cannot drop the last keystroke.
 */
export function useTextFieldSave(
  artistId: string,
  initial: { key: string; value: string }[],
  onApplyField?: (key: string, value: string) => void,
): {
  values: Record<string, string>
  status: SaveStatus
  edit: (key: string, value: string) => void
} {
  // Only what the manager has TYPED. The displayed value is derived below — which is
  // what makes a custom site work at all: its fields arrive over the bridge after the
  // first render, and seeding state from them would need an effect that re-syncs
  // (forbidden here, and the source of the stale/blank-caption bug it replaced).
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())

  const persist = useCallback(
    (key: string, value: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () => saveEditorFieldAction(artistId, key, value))
    },
    [artistId],
  )

  // Flush still-pending edits on unmount so a fast tab-away can't drop one.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((value, key) => {
        void saveEditorFieldAction(artistId, key, value)
      })
    }
  }, [artistId])

  const edit = useCallback(
    (key: string, value: string) => {
      setEdits((v) => ({ ...v, [key]: value }))
      onApplyField?.(key, value) // optimistic live-preview paint
      pending.current.set(key, value)
      const existing = timers.current.get(key)
      if (existing) clearTimeout(existing)
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key)
          persist(key, value)
        }, DEBOUNCE_MS),
      )
    },
    [onApplyField, persist],
  )

  // Derived, never stored: a typed value wins, otherwise whatever the field currently
  // carries. Fields arriving late (a custom site's, over the bridge) therefore show up
  // with their values the render they appear, with no effect and nothing to re-sync.
  const values: Record<string, string> = {}
  for (const f of initial) values[f.key] = edits[f.key] ?? f.value

  return { values, status, edit }
}
