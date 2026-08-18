import { useTransition } from 'react'

/**
 * The inspector's OPTIMISTIC RULE, extracted (2026-08-18 inspector split): apply the
 * change to local state immediately, persist in a transition, roll the state back if
 * the server says no. Before this hook the rule existed because it had been hand-copied
 * correctly ~14 times (every toggle/remove/reorder/place in the inspector) — no
 * locality: a fix to the rollback rule was a fourteen-site sweep.
 *
 * ONE runner per inspector, not one per list: `isPending` is deliberately shared, so a
 * guarded operation cannot start while ANY other guarded operation is in flight — the
 * behaviour the copies always had.
 *
 * `guard` (default true) is the conflict gate. Removes, reorders and slot placements
 * guard — two overlapping reorders would persist a stale order. The on/off toggles
 * historically DON'T guard (rapid flipping stays responsive; the writes are per-row
 * and idempotent), so they pass `guard: false`.
 */
export function useOptimisticRunner(): {
  isPending: boolean
  run: (op: {
    /** Set the optimistic state — runs synchronously, before the persist. */
    apply: () => void
    persist: () => Promise<{ error?: string } | void>
    /** Undo `apply` — runs only when persist reports an error. */
    rollback: () => void
    guard?: boolean
  }) => void
} {
  const [isPending, startTransition] = useTransition()
  return {
    isPending,
    run: ({ apply, persist, rollback, guard = true }) => {
      if (guard && isPending) return
      apply()
      startTransition(async () => {
        const res = await persist()
        if (res?.error) rollback()
      })
    },
  }
}
