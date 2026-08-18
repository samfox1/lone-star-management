import { useCallback, useRef, useState } from 'react'

/**
 * The editor session's UNDO ledger (skeen brief, 2026-08-03) — now the MINORITY path:
 * since 2026-08-17 "Revert changes" restores the LAST PUBLISH (restorePublishedAction),
 * and this ledger is walked only for an artist who has never published, where there is
 * no edition to restore. Every key remembers what it was BEFORE this session first
 * touched it, so that one fallback can hand the whole session back.
 *
 * The first touch of a key records its session-start value; every later edit to the
 * same key leaves the entry alone. "Revert N changes" walks the ledger in reverse and
 * writes each `before` back through the SAME save paths the panels use, so validation,
 * serialization and the frame repaint all come for free. `before: null` means "no row
 * existed" — reverting deletes rather than writing an empty copy.
 */
export type JournalEntry =
  | { kind: 'style'; key: string; before: string | null }
  | { kind: 'field'; key: string; before: string }
  | { kind: 'link'; key: string; before: string }
  /** A component-slot placement: `before` is the photo id that held the role, or null. */
  | { kind: 'slot'; role: string; before: string | null }

const idOf = (e: JournalEntry) => `${e.kind}:${'key' in e ? e.key : e.role}`

export function useSessionJournal(): {
  entries: JournalEntry[]
  count: number
  record: (entry: JournalEntry) => void
  clear: () => void
} {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const touched = useRef<Set<string>>(new Set())

  const record = useCallback((entry: JournalEntry) => {
    const id = idOf(entry)
    if (touched.current.has(id)) return
    touched.current.add(id)
    setEntries((list) => [...list, entry])
  }, [])

  const clear = useCallback(() => {
    touched.current.clear()
    setEntries([])
  }, [])

  return { entries, count: entries.length, record, clear }
}
