// @vitest-environment jsdom
/**
 * useOnSiteSelection — the "which items are on the site" selection behind every
 * publish-gated browser. Seeds from what's live (`on_site`), tracks the selection⇄live
 * delta as pendingCount, and re-seeds when the server's live set changes (post-publish).
 */
import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOnSiteSelection } from '@/app/artists/[id]/(dashboard)/use-on-site-selection'

type Item = { id: string; on_site: boolean }

describe('useOnSiteSelection', () => {
  it('seeds the selection from currently-live items, with no pending delta', () => {
    const items: Item[] = [{ id: 'a', on_site: true }, { id: 'b', on_site: false }]
    const { result } = renderHook(() => useOnSiteSelection(items))
    expect([...result.current.selected]).toEqual(['a'])
    expect(result.current.pendingCount).toBe(0)
  })

  it('toggling an off item on creates one pending change', () => {
    const items: Item[] = [{ id: 'a', on_site: true }, { id: 'b', on_site: false }]
    const { result } = renderHook(() => useOnSiteSelection(items))
    act(() => result.current.toggle('b'))
    expect(result.current.selected.has('b')).toBe(true)
    expect(result.current.pendingCount).toBe(1)
  })

  it('toggling a live item off also counts as pending', () => {
    const items: Item[] = [{ id: 'a', on_site: true }, { id: 'b', on_site: false }]
    const { result } = renderHook(() => useOnSiteSelection(items))
    act(() => result.current.toggle('a')) // deselect a live item
    act(() => result.current.toggle('b')) // select an off item
    expect(result.current.pendingCount).toBe(2)
  })

  it('re-seeds to the new live set when items change (post-publish), clearing the delta', () => {
    const initial: Item[] = [{ id: 'a', on_site: true }, { id: 'b', on_site: false }]
    const { result, rerender } = renderHook(({ items }) => useOnSiteSelection(items), {
      initialProps: { items: initial },
    })
    act(() => result.current.toggle('b')) // pending: put b on-site
    expect(result.current.pendingCount).toBe(1)

    // Server caught up: b is now live. The live key changes → selection re-seeds.
    rerender({ items: [{ id: 'a', on_site: true }, { id: 'b', on_site: true }] })
    expect([...result.current.selected].sort()).toEqual(['a', 'b'])
    expect(result.current.pendingCount).toBe(0)
  })
})
