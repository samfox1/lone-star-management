// @vitest-environment jsdom
// The editor's autosave never drops the last edit: closing the panel or hiding the page writes it.
/**
 * useDebouncedFieldSave — THE LAST EDIT IS NEVER DROPPED (data loss: strict).
 *
 * Every editor panel autosaves through this hook (Sam, 2026-08-14: autosave to the draft,
 * silent on success). An edit waits 500ms before it is written, so the dangerous moment is
 * the manager leaving inside that window: Back, a click on the preview, another editor
 * opening, a tab switch. The unmount flush existed with no test at all, which is how a
 * rule evaporates in the next rewrite (AGENTS.md). These pin it, and the page-hide flush
 * added beside it (2026-09-28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedFieldSave } from '@/app/artists/[id]/(dashboard)/editor/use-debounced-field-save'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(normalize?: (v: string, key: string) => string | null) {
  const persist = vi.fn<(key: string, value: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))
  const hook = renderHook(() => useDebouncedFieldSave<string>({ persist, normalize }))
  return { persist, ...hook }
}

/** Pretend the tab went to the background. jsdom's visibilityState is a getter. */
function hidePage() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('closing the panel inside the debounce window', () => {
  it('CRITICAL: writes the LAST value, exactly once', () => {
    const { persist, result, unmount } = mount()
    act(() => {
      result.current.save('caption', 'first draft')
      result.current.save('caption', 'final words')
    })
    expect(persist).not.toHaveBeenCalled() // still debouncing
    unmount()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith('caption', 'final words')
  })

  it('CRITICAL: every pending field is written, not just one', () => {
    const { persist, result, unmount } = mount()
    act(() => {
      result.current.save('title', 'T')
      result.current.save('price', '12')
    })
    unmount()
    expect(persist.mock.calls).toEqual(expect.arrayContaining([['title', 'T'], ['price', '12']]))
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('an edit the timer already wrote is NOT written a second time on close', () => {
    const { persist, result, unmount } = mount()
    act(() => {
      result.current.save('caption', 'saved')
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(persist).toHaveBeenCalledTimes(1)
    unmount()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('a REFUSED newest input is not replaced by the older valid one on close', () => {
    // Newest input wins: the manager's latest text was refused (too long, say), so the
    // flush must not quietly write the value they had since changed.
    const { persist, result, unmount } = mount((v) => (v.length > 5 ? null : v))
    act(() => {
      expect(result.current.save('caption', 'short')).toBe(true)
      expect(result.current.save('caption', 'far too long')).toBe(false)
    })
    unmount()
    expect(persist).not.toHaveBeenCalled()
  })
})

describe('the page is hidden inside the debounce window', () => {
  it('CRITICAL: writes the pending edit NOW, and the timer does not write it again', async () => {
    const { persist, result } = mount()
    act(() => {
      result.current.save('caption', 'before the tab switch')
    })
    await act(async () => {
      hidePage()
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith('caption', 'before the tab switch')
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('a visible-again event writes nothing (only HIDDEN flushes)', () => {
    const { persist, result } = mount()
    act(() => {
      result.current.save('caption', 'x')
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(persist).not.toHaveBeenCalled()
  })

  it('CRITICAL: pagehide (the tab closing) writes the pending edit too', async () => {
    const { persist, result } = mount()
    act(() => {
      result.current.save('caption', 'closing now')
    })
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(persist).toHaveBeenCalledWith('caption', 'closing now')
  })
})
