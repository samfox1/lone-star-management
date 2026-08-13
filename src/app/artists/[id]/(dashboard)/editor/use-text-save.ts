'use client'

import { useCallback, useState } from 'react'
import { type SaveStatus } from './inspector-shared'
import { useDebouncedFieldSave } from './use-debounced-field-save'
import { saveEditorFieldAction } from '../actions'

/**
 * The Text panel's values and their debounced save, OWNED ABOVE both views.
 *
 * The list and the full-panel editor are two windows onto the same field. If each held
 * its own copy, opening Edit after typing would show the stale value, and both copies
 * would run their own debounce — two writes racing for one key against a live site. One
 * hook, one source, both views.
 *
 * The debounce/serialization/flush is the generic `useDebouncedFieldSave`; this hook adds
 * only the shared value model on top: the manager's TYPED edits, with the displayed value
 * DERIVED (never stored). That derivation is what makes a custom site work — its fields
 * arrive over the bridge after first render, so seeding state from them would need an
 * effect that re-syncs (the source of the stale/blank-caption bug this replaced).
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
  const [edits, setEdits] = useState<Record<string, string>>({})
  const { status, save } = useDebouncedFieldSave<string>({
    persist: (key, value) => saveEditorFieldAction(artistId, key, value),
    onApply: onApplyField,
  })

  const edit = useCallback(
    (key: string, value: string) => {
      setEdits((v) => ({ ...v, [key]: value }))
      save(key, value) // optimistic paint + debounced persist, all in the hook
    },
    [save],
  )

  // Derived, never stored: a typed value wins, otherwise whatever the field currently
  // carries. Fields arriving late (a custom site's, over the bridge) therefore show up
  // with their values the render they appear, with no effect and nothing to re-sync.
  const values: Record<string, string> = {}
  for (const f of initial) values[f.key] = edits[f.key] ?? f.value

  return { values, status, edit }
}
