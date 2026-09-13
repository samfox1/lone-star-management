// @vitest-environment jsdom
// The content toggle: three lists, one at a time, each honest about its gaps.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TopContent } from '@/components/ui/top-content'
import { CONTENT_KINDS, type ContentList } from '@/lib/analytics'

const songs: ContentList = {
  items: [
    { id: 'a', title: 'Summer Sun', image: 'https://i.scdn.co/image/ab67616d0000b273abc', sub: 'Summer', count: 18 },
    { id: 'b', title: 'Home Again', image: null, sub: null, count: 6 },
  ],
  attributed: 24, unattributed: 46,
}
const tourNoneNamed: ContentList = { items: [], attributed: 0, unattributed: 22 }
const merchNothing: ContentList = { items: [], attributed: 0, unattributed: 0 }
const lists = { songs, tour: tourNoneNamed, merch: merchNothing }

describe('TopContent', () => {
  it('offers one tab per kind, derived from the registry', () => {
    render(<TopContent lists={lists} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(CONTENT_KINDS.map((k) => k.label))
    expect(screen.queryByRole('tab', { name: /video/i })).toBeNull()
  })

  it('opens on songs, most played first, with the leader\'s bar full', () => {
    const { container } = render(<TopContent lists={lists} />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('Summer Sun')
    expect(items[0]).toContain('18')
    const w = [...container.querySelectorAll('[data-bar]')].map((b) => parseFloat((b as HTMLElement).style.width))
    expect(w[0]).toBe(100)
    expect(w[1]).toBeCloseTo((6 / 18) * 100, 5)
    expect(screen.getByText(/24 plays named a song · 46 did not/i)).toBeTruthy()
  })

  it('CRITICAL: an empty tab says WHICH kind of empty — none named a date is not the same as no clicks', () => {
    render(<TopContent lists={lists} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tour' }))
    expect(within(screen.getByRole('tabpanel')).getByText(/22 ticket clicks, none named a date yet/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Merch' }))
    expect(within(screen.getByRole('tabpanel')).getByText(/^No buy clicks yet\.$/i)).toBeTruthy()
  })

  it('switching tabs marks the selected one and swaps the list', () => {
    render(<TopContent lists={lists} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tour' }))
    expect(screen.getByRole('tab', { name: 'Tour' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Songs' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('Summer Sun')).toBeNull()
  })

  it('draws a cover when there is one and a quiet square when there is not', () => {
    const { container } = render(<TopContent lists={lists} />)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
