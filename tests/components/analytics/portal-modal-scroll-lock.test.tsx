// @vitest-environment jsdom
// A dialog must freeze the page behind it.
/**
 * PortalModal's body-scroll lock (Sam, 2026-09-22: "when I open the view all window, the
 * background screen shouldn't be scrollable").
 *
 * WHY THIS BUG EXISTED. Thirteen dashboard modals call `useLockBodyScroll`; PortalModal
 * was the only one that did not, because it lives in `components/ui` and the hook lived in
 * the dashboard folder where a shared component could not reach it. Nothing failed — the
 * window opened, looked right, and let the page scroll underneath. The hook has moved to
 * `components/ui` and PortalModal now calls it.
 *
 * WHY IT IS TESTED HERE rather than through TopContent: the lock belongs to PortalModal,
 * so a test aimed at the View-all button would pass just as well if someone re-added the
 * hook to TopContent and left every OTHER PortalModal caller — the upload drop zones —
 * still scrolling the page behind them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { PortalModal } from '@/components/ui/portal-modal'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('PortalModal freezes the page behind it', () => {
  it('hides body overflow while it is mounted', () => {
    render(
      <PortalModal ariaLabel="Songs" onClose={() => {}}>
        <p>rows</p>
      </PortalModal>,
    )

    expect(document.body.style.overflow).toBe('hidden')
  })

  it('gives the page its scroll back when it closes', () => {
    // The callers mount and unmount this rather than passing `open`, so unmount IS close.
    const view = render(
      <PortalModal ariaLabel="Songs" onClose={() => {}}>
        <p>rows</p>
      </PortalModal>,
    )
    expect(document.body.style.overflow).toBe('hidden')

    view.unmount()

    expect(document.body.style.overflow).toBe('')
  })

  it('restores the OUTER lock, not the page, when stacked on another modal', () => {
    // A PortalModal often opens on top of a CardModal that already locked the body. If the
    // inner one restored the ORIGINAL value it would hand scrolling back to the page while
    // the outer dialog is still open — the same bug, one layer down.
    document.body.style.overflow = 'hidden' // stand-in for the outer modal's lock

    const view = render(
      <PortalModal ariaLabel="Upload" onClose={() => {}}>
        <p>drop zone</p>
      </PortalModal>,
    )
    view.unmount()

    expect(document.body.style.overflow).toBe('hidden')
  })
})
