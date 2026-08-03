import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanClassText } from '@/lib/site-editor/save'
import { runSerialized, type SaveStatus } from './inspector-shared'
import { saveEditorStyleAction } from '../actions'

/** How long a style edit sits before persisting — long enough to coalesce a drag or a
 *  typing burst, short enough that "it saved" is never in doubt. */
const DEBOUNCE_MS = 500

/**
 * The ONE debounced style-region save pipeline, shared by the section Style panel and
 * the per-item editor (each was hand-rolling its own copy of this machinery):
 *
 *  • validate with the SAME `cleanClassText` the server uses, so a panel can never
 *    claim "Saved" on a write the server would reject;
 *  • optimistic repaint via `onApplyStyle` (the frame bridge);
 *  • per-key 500ms debounce, so a drag coalesces into one write;
 *  • per-key SERIALIZED persistence (`runSerialized`), so an older edit's write can't
 *    land after a newer one;
 *  • flush on unmount, so tabbing away can't drop the last change.
 *
 * `save` returns false when the string is rejected — the caller shows its own invalid
 * state; nothing is painted or persisted for a rejected value.
 */
export function useStyleRegionSave(
  artistId: string,
  onApplyStyle?: (key: string, className: string) => void,
): { status: SaveStatus; save: (key: string, raw: string) => boolean } {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())

  const persist = useCallback(
    (key: string, className: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () => saveEditorStyleAction(artistId, key, className))
    },
    [artistId],
  )

  // Flush pending edits on unmount so leaving the panel can't drop the last change.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((className, key) => {
        void saveEditorStyleAction(artistId, key, className)
      })
    }
  }, [artistId])

  // Read through a ref so `save` stays stable when the caller passes an inline callback.
  const onApplyRef = useRef(onApplyStyle)
  useEffect(() => {
    onApplyRef.current = onApplyStyle
  })

  const save = useCallback(
    (key: string, raw: string): boolean => {
      const clean = cleanClassText(raw)
      if (clean === null) return false
      onApplyRef.current?.(key, clean)
      pending.current.set(key, clean)
      const existing = timers.current.get(key)
      if (existing) clearTimeout(existing)
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key)
          persist(key, clean)
        }, DEBOUNCE_MS),
      )
      return true
    },
    [persist],
  )

  return { status, save }
}
