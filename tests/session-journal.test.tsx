// @vitest-environment jsdom
/**
 * The editor's UNDO ledger (`useSessionJournal`).
 *
 * Written 2026-08-04 after a mutation sweep found the hook had NO direct coverage: both
 * of its invariants could be deleted outright and the whole suite stayed green. It was
 * only exercised incidentally through the inspector, which never asserted the behaviour
 * that makes it an undo ledger rather than an edit log.
 *
 * The invariant: an entry holds what a key was when the SESSION started, not what it was
 * a moment ago. Autosave persists ~500ms behind every keystroke, so if the journal
 * recorded each edit, "Revert changes" would replay some arbitrary mid-typing value —
 * looking like it worked while quietly restoring the wrong thing. That is the failure
 * this file exists to catch.
 */
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSessionJournal } from '@/app/artists/[id]/(dashboard)/editor/use-session-journal'

describe('useSessionJournal', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSessionJournal())
    expect(result.current.entries).toEqual([])
    expect(result.current.count).toBe(0)
  })

  it('CRITICAL: the FIRST touch of a key wins — later edits never overwrite it', () => {
    const { result } = renderHook(() => useSessionJournal())

    act(() => result.current.record({ kind: 'field', key: 'artist_name', before: 'SESSION START' }))
    // The manager keeps typing; autosave keeps firing. Each of these is a later state,
    // and none of them is what a revert should restore.
    act(() => result.current.record({ kind: 'field', key: 'artist_name', before: 'mid typing' }))
    act(() => result.current.record({ kind: 'field', key: 'artist_name', before: 'later still' }))

    expect(result.current.entries).toEqual([{ kind: 'field', key: 'artist_name', before: 'SESSION START' }])
    expect(result.current.count).toBe(1)
  })

  it('records each distinct key once, in the order they were first touched', () => {
    const { result } = renderHook(() => useSessionJournal())

    act(() => result.current.record({ kind: 'field', key: 'a', before: '1' }))
    act(() => result.current.record({ kind: 'field', key: 'b', before: '2' }))
    act(() => result.current.record({ kind: 'field', key: 'a', before: 'IGNORED' }))

    expect(result.current.entries).toEqual([
      { kind: 'field', key: 'a', before: '1' },
      { kind: 'field', key: 'b', before: '2' },
    ])
  })

  it('CRITICAL: identity is kind + key, so the same name under two kinds is two entries', () => {
    // A style override and a text field can share a name. Collapsing them would mean
    // reverting one silently discarded the other's starting value.
    const { result } = renderHook(() => useSessionJournal())

    act(() => result.current.record({ kind: 'style', key: 'hero', before: 'text-6xl' }))
    act(() => result.current.record({ kind: 'field', key: 'hero', before: 'SKEEN' }))
    act(() => result.current.record({ kind: 'link', key: 'hero', before: 'https://x' }))

    expect(result.current.count).toBe(3)
  })

  it('a slot entry is identified by its role', () => {
    const { result } = renderHook(() => useSessionJournal())

    act(() => result.current.record({ kind: 'slot', role: 'polaroid_1', before: 'photo-1' }))
    act(() => result.current.record({ kind: 'slot', role: 'polaroid_1', before: 'photo-99' }))
    act(() => result.current.record({ kind: 'slot', role: 'polaroid_2', before: null }))

    expect(result.current.entries).toEqual([
      { kind: 'slot', role: 'polaroid_1', before: 'photo-1' },
      { kind: 'slot', role: 'polaroid_2', before: null },
    ])
  })

  it('keeps a null `before` — "no row existed" is a real starting state, not a missing one', () => {
    // Revert reads this as "delete", rather than writing an empty row back.
    const { result } = renderHook(() => useSessionJournal())
    act(() => result.current.record({ kind: 'style', key: 'hero', before: null }))
    expect(result.current.entries).toEqual([{ kind: 'style', key: 'hero', before: null }])
  })

  it('clear() empties the ledger', () => {
    const { result } = renderHook(() => useSessionJournal())
    act(() => result.current.record({ kind: 'field', key: 'a', before: '1' }))
    act(() => result.current.clear())
    expect(result.current.entries).toEqual([])
    expect(result.current.count).toBe(0)
  })

  it('CRITICAL: after clear(), a key can be recorded again', () => {
    // Reverting calls clear(). If the touched set survived, the next edit to that key
    // would record NOTHING, and a second Revert would silently do nothing at all.
    const { result } = renderHook(() => useSessionJournal())

    act(() => result.current.record({ kind: 'field', key: 'a', before: 'first session value' }))
    act(() => result.current.clear())
    act(() => result.current.record({ kind: 'field', key: 'a', before: 'value after the revert' }))

    expect(result.current.entries).toEqual([{ kind: 'field', key: 'a', before: 'value after the revert' }])
  })
})
