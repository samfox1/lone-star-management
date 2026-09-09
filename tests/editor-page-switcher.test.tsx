// @vitest-environment jsdom
/**
 * THE PAGE SWITCHER (SITE_PAGES_PLAN.md P2).
 *
 * The strip at the top of the inspector that says which page the frame is showing and
 * moves it to another. Small, and every one of its rules is a trap the plan named:
 *
 *   - It renders from `manifest.pages` VERBATIM. It never filters and never guesses
 *     availability — the site resolves that (C4: /about exists only while the bio lives
 *     there) and re-announces when the SET changes (skeen b3b38b8).
 *   - It must NOT set the current page itself. `setPage` posts `set-page` and waits; the
 *     frame's `page-change` is the confirmation. An older frame that ignores `set-page`
 *     therefore leaves the switcher truthfully on the page still showing, rather than
 *     lying about a switch that never happened (use-frame-bridge.ts:217-223).
 *   - `null` is a real state, not a bug: it is what the editor holds before the first
 *     `page-change`, and what it falls back to when the page it was on is evicted
 *     (use-frame-bridge.ts:322-325). Nothing is marked current then.
 *   - One page means no switcher. Every site before this feature is in that state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PageSwitcher } from '@/app/artists/[id]/(dashboard)/editor/page-switcher'

afterEach(cleanup)

const PAGES = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'about', label: 'About', path: '/about' },
  { key: 'merch', label: 'Merch', path: '/merch' },
]

const tabs = () => screen.queryAllByRole('tab').map((el) => el.textContent)

describe('the switcher renders exactly what the site declared', () => {
  it('CRITICAL: one tab per declared page, in declaration order', () => {
    render(<PageSwitcher pages={PAGES} current="home" onSelect={vi.fn()} />)
    expect(tabs()).toEqual(['Home', 'About', 'Merch'])
  })

  it('CRITICAL: fewer than two pages means no switcher at all', () => {
    // A control offering one choice is furniture. Every existing site declares no pages
    // and must look exactly as it does today (the P1 regression, at the UI layer).
    const { container: none } = render(<PageSwitcher pages={undefined} current={null} onSelect={vi.fn()} />)
    expect(none.textContent).toBe('')
    cleanup()
    const { container: one } = render(<PageSwitcher pages={[PAGES[0]]} current="home" onSelect={vi.fn()} />)
    expect(one.textContent).toBe('')
  })

  it('does not filter or reorder — a page the editor cannot explain is still offered', () => {
    // The switcher is not a second source of truth about availability. The site decides
    // and re-announces; second-guessing here is how the two sides drift.
    render(<PageSwitcher pages={[...PAGES].reverse()} current={null} onSelect={vi.fn()} />)
    expect(tabs()).toEqual(['Merch', 'About', 'Home'])
  })
})

describe('the switcher shows the page the FRAME is on, never its own guess', () => {
  it('CRITICAL: the current page is the selected tab; the others are not', () => {
    render(<PageSwitcher pages={PAGES} current="about" onSelect={vi.fn()} />)
    const selected = screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true')
    expect(selected.map((el) => el.textContent)).toEqual(['About'])
  })

  it('CRITICAL: with no page yet, NOTHING is marked current', () => {
    // Marking the first tab would be a guess, and a wrong one on any site whose frame
    // opens somewhere other than its first declared page.
    render(<PageSwitcher pages={PAGES} current={null} onSelect={vi.fn()} />)
    expect(screen.getAllByRole('tab').some((el) => el.getAttribute('aria-selected') === 'true')).toBe(false)
  })

  it('CRITICAL: clicking a tab asks, and does NOT move the marker itself', () => {
    // The whole point of D6/A1: `setPage` posts and waits for `page-change`. If the
    // switcher moved its own marker, a frame that ignored the message would leave the
    // editor pointed at a page it is not displaying — latched, and silently wrong.
    const onSelect = vi.fn()
    render(<PageSwitcher pages={PAGES} current="home" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Merch' }))
    expect(onSelect).toHaveBeenCalledWith('merch')
    const selected = screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true')
    expect(selected.map((el) => el.textContent), 'the marker moved before the frame confirmed').toEqual(['Home'])
  })

  it('clicking the page already showing asks again rather than doing nothing', () => {
    // A frame that failed to render is one a manager re-clicks. Suppressing the re-ask
    // would make the only available recovery a page reload.
    const onSelect = vi.fn()
    render(<PageSwitcher pages={PAGES} current="home" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }))
    expect(onSelect).toHaveBeenCalledWith('home')
  })
})
