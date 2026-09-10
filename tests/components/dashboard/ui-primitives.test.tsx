// @vitest-environment jsdom
// The shared UI pieces that carry real behaviour: the modal, avatar initials, and chart maths.
/**
 * The shared primitives in src/components/ui — only the parts that carry BEHAVIOUR.
 * The class-string wrappers (Button, Card, Field, KLabel, Stat, AppShell) are
 * presentational and deliberately uncovered.
 *
 * PortalModal is the one that matters. Its dismissal rules were copy-pasted per
 * feature (audio upload, image upload, the per-item confirm) before being extracted,
 * and every rule below is invisible in review: nothing about the rendered output says
 * which listener phase it used, so a regression looks like working code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CardModal } from '@/app/artists/[id]/(dashboard)/card-modal'
import { PortalModal } from '@/components/ui/portal-modal'
import { AreaChart, Sparkline } from '@/components/ui/charts'
import { initials } from '@/components/ui/ui'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(cleanup)

/**
 * The REAL production nesting (track-audio.tsx, photo-tools.tsx): a PortalModal opened
 * from inside a CardModal. CardModal listens for Escape on `document` in the BUBBLE
 * phase (card-modal.tsx), so it is the exact listener PortalModal has to outrun.
 */
function Nested({
  onOuterClose,
  onInnerClose,
  inner = true,
}: {
  onOuterClose: () => void
  onInnerClose: () => void
  inner?: boolean
}) {
  return (
    <CardModal open onClose={onOuterClose} footer={null}>
      <p>outer body</p>
      {inner && (
        <PortalModal ariaLabel="Upload audio" onClose={onInnerClose}>
          <p>inner body</p>
        </PortalModal>
      )}
    </CardModal>
  )
}

/** Escape as the browser delivers it: dispatched at a node, so it capture-phases DOWN
 *  through document before bubbling back UP through it. */
const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' })

describe('PortalModal — Escape dismisses one layer', () => {
  it('CRITICAL: Escape closes the nested modal and leaves the modal under it open', () => {
    // Both listeners live on `document`. Without the capture phase + stopImmediatePropagation
    // the parent's bubble listener also fires, and one Escape closes BOTH layers — the
    // manager loses the release/song modal they were editing, unsaved, on a stray keypress.
    const onOuterClose = vi.fn()
    const onInnerClose = vi.fn()
    render(<Nested onOuterClose={onOuterClose} onInnerClose={onInnerClose} />)

    pressEscape()

    expect(onInnerClose).toHaveBeenCalledTimes(1)
    expect(onOuterClose).not.toHaveBeenCalled()
  })

  it('CRITICAL: once the nested modal is gone, Escape reaches the modal under it again', () => {
    // removeEventListener must repeat the `true` capture flag — a listener added with it
    // and removed without it is NOT removed. The stale capture listener would then swallow
    // every future Escape, leaving the parent modal permanently un-closable by keyboard,
    // with no error anywhere.
    const onOuterClose = vi.fn()
    const onInnerClose = vi.fn()
    const { rerender } = render(<Nested onOuterClose={onOuterClose} onInnerClose={onInnerClose} />)

    rerender(<Nested onOuterClose={onOuterClose} onInnerClose={onInnerClose} inner={false} />)
    pressEscape()

    expect(onInnerClose).not.toHaveBeenCalled()
    expect(onOuterClose).toHaveBeenCalledTimes(1)
  })

  it('ignores keys that are not Escape', () => {
    const onInnerClose = vi.fn()
    render(<Nested onOuterClose={vi.fn()} onInnerClose={onInnerClose} />)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(onInnerClose).not.toHaveBeenCalled()
  })
})

describe('PortalModal — pointer dismissal', () => {
  function open() {
    const onClose = vi.fn()
    render(
      <PortalModal ariaLabel="Upload audio" onClose={onClose}>
        <button type="button">Choose file</button>
      </PortalModal>,
    )
    return { onClose, dialog: screen.getByRole('dialog', { name: 'Upload audio' }) }
  }

  it('a click on the backdrop closes; a click on the card does not', () => {
    // The handler sits on the overlay, so every click inside bubbles to it. Without the
    // `e.target === e.currentTarget` check, clicking the drop zone would close the modal
    // mid-upload.
    const { onClose, dialog } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the corner button closes it', () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders into document.body, not into the tree that opened it', () => {
    // The portal is why an upload can never resize the modal underneath: the drop zone is
    // not part of that modal's layout. Rendered in place, it inherits its parent's width
    // and scroll box.
    render(<Nested onOuterClose={vi.fn()} onInnerClose={vi.fn()} />)
    const inner = screen.getByRole('dialog', { name: 'Upload audio' })
    expect(inner.parentElement).toBe(document.body)
    expect(screen.getByText('outer body').closest('[role="dialog"]')).not.toBe(inner)
  })
})

describe('initials — avatar fallback', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(initials('Lone Pine')).toBe('LP')
    expect(initials('gulf static band')).toBe('GS') // third word ignored
    expect(initials('  spaced   out  ')).toBe('SO')
    expect(initials('skeen')).toBe('S') // one word, one letter
  })

  it("never renders nothing — an unnamed artist gets '?'", () => {
    // The avatar is a fixed-size circle; an empty string collapses it to a blank disc that
    // reads as a broken image rather than a placeholder.
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

/** The `points` attribute of the chart's polyline, as the browser would read it. */
function points(el: HTMLElement): string {
  return el.querySelector('polyline')!.getAttribute('points')!
}

describe('charts — point maths', () => {
  it('CRITICAL: a flat series still produces real coordinates', () => {
    // max - min is 0 for a series that never moves (a brand-new artist: 0 plays every
    // day). Dividing by that span yields NaN for every point, and an SVG polyline with a
    // NaN point silently renders NOTHING — a blank card, no error.
    const { container } = render(<Sparkline values={[5, 5, 5]} />)
    expect(points(container)).not.toContain('NaN')
    expect(points(container).split(' ')).toHaveLength(3)
  })

  it('a series with fewer than two points draws a flat baseline across the full width', () => {
    // "No movement yet" must still look like a chart, not an empty box.
    const { container } = render(<Sparkline values={[]} width={72} height={24} />)
    const [first, last] = points(container).split(' ')
    expect(first).toBe('0,13.2')
    expect(last).toBe('72,13.2')

    const one = render(<Sparkline values={[9]} width={72} height={24} />)
    expect(points(one.container)).toBe(points(container))
  })

  it('maps the highest value to the top of the box and the lowest to the bottom', () => {
    // SVG y grows DOWNWARD, so the series has to be inverted. Getting this backwards
    // renders every trend upside down and still looks like a plausible chart.
    const { container } = render(<Sparkline values={[1, 9]} width={100} height={20} />)
    const [lo, hi] = points(container)
      .split(' ')
      .map((p) => Number(p.split(',')[1]))
    expect(hi).toBeLessThan(lo)
  })

  it('the area chart closes its polygon along the bottom edge', () => {
    // Without the two trailing corner points the fill is bounded by the line itself and
    // shades the wrong side of it.
    const { container } = render(<AreaChart values={[1, 4, 2]} height={160} />)
    const poly = container.querySelector('polygon')!.getAttribute('points')!
    expect(poly.endsWith('320,160 0,160')).toBe(true)
  })
})
