// @vitest-environment jsdom
// Local state seeded from a prop: kept while the prop holds, replaced the moment it changes.
/**
 * useSeeded ((manager-tools)/_ui/use-seeded.ts) — the optimistic value Brand's inline text
 * and the Settings rows show while a save is out, and the rows the Settings and Connections
 * lists hold between refreshes. Two promises, both load-bearing:
 *
 *   - a local change STICKS while the prop is unchanged (an optimistic save shows at once);
 *   - a NEW prop replaces it (a refresh after another save), so a stale optimistic value
 *     never outlives the server's — including a local change made before the refresh.
 */
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSeeded } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/use-seeded'

describe('useSeeded', () => {
  it('starts at the prop, and a local set sticks while the prop is unchanged', () => {
    const { result, rerender } = renderHook(({ v }) => useSeeded(v), { initialProps: { v: 'server' } })
    expect(result.current[0]).toBe('server')
    act(() => result.current[1]('optimistic'))
    expect(result.current[0]).toBe('optimistic')
    rerender({ v: 'server' }) // same prop: a parent re-render must not undo the edit
    expect(result.current[0]).toBe('optimistic')
  })

  it('CRITICAL: a new prop replaces the local value, even one set since the last', () => {
    const { result, rerender } = renderHook(({ v }) => useSeeded(v), { initialProps: { v: 'a' } })
    act(() => result.current[1]('stale optimistic'))
    rerender({ v: 'b' })
    expect(result.current[0]).toBe('b')
    // And it is seeded from there: a later local set works on the new value.
    act(() => result.current[1]((prev) => `${prev}!`))
    expect(result.current[0]).toBe('b!')
  })

  it('CRITICAL: functional updates chain on the latest value (list patches)', () => {
    const rows = [{ k: 1, on: false }, { k: 2, on: false }]
    const { result } = renderHook(() => useSeeded(rows))
    act(() => {
      result.current[1]((all) => all.map((r) => (r.k === 1 ? { ...r, on: true } : r)))
      result.current[1]((all) => all.map((r) => (r.k === 2 ? { ...r, on: true } : r)))
    })
    expect(result.current[0].map((r) => r.on)).toEqual([true, true])
  })
})
