// @vitest-environment jsdom
// The inspector's optimistic-update rule, tested once instead of through fourteen panels.
/**
 * The inspector's optimistic rule, tested through ONE interface instead of via
 * fourteen panel flows (2026-08-18 inspector split).
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOptimisticRunner } from '@/app/artists/[id]/(dashboard)/editor/use-optimistic'

function deferred() {
  let resolve!: (v: { error?: string } | void) => void
  const promise = new Promise<{ error?: string } | void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useOptimisticRunner', () => {
  it('applies immediately, keeps the state on success', async () => {
    const { result } = renderHook(() => useOptimisticRunner())
    const apply = vi.fn()
    const rollback = vi.fn()
    await act(async () => {
      result.current.run({ apply, persist: async () => ({}), rollback })
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(rollback).not.toHaveBeenCalled()
  })

  it('CRITICAL: rolls back when the server says no', async () => {
    const { result } = renderHook(() => useOptimisticRunner())
    const rollback = vi.fn()
    await act(async () => {
      result.current.run({ apply: () => {}, persist: async () => ({ error: 'nope' }), rollback })
    })
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('a void persist result (some actions return nothing) never rolls back', async () => {
    const { result } = renderHook(() => useOptimisticRunner())
    const rollback = vi.fn()
    await act(async () => {
      result.current.run({ apply: () => {}, persist: async () => undefined, rollback })
    })
    expect(rollback).not.toHaveBeenCalled()
  })

  it('CRITICAL: a guarded op is DROPPED while another is in flight; guard:false runs anyway', async () => {
    const { result } = renderHook(() => useOptimisticRunner())
    const gate = deferred()
    const first = vi.fn()
    const guarded = vi.fn()
    const unguarded = vi.fn()
    await act(async () => {
      result.current.run({ apply: first, persist: () => gate.promise, rollback: () => {} })
    })
    expect(first).toHaveBeenCalled()
    expect(result.current.isPending).toBe(true)
    await act(async () => {
      result.current.run({ apply: guarded, persist: async () => ({}), rollback: () => {} })
      result.current.run({ apply: unguarded, guard: false, persist: async () => ({}), rollback: () => {} })
    })
    expect(guarded).not.toHaveBeenCalled() // the conflict gate the removes/reorders rely on
    expect(unguarded).toHaveBeenCalled() // toggles stay responsive mid-flight
    await act(async () => gate.resolve({}))
    expect(result.current.isPending).toBe(false)
  })
})
