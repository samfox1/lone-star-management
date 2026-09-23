// @vitest-environment jsdom
// Two ranked columns, five rows each, the leader ringed. Uniform rows are the
// point: the size-by-count ramp was cut (Sam, 2026-09-22), so a test that lets
// per-row sizing back in is the one that matters here.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TopContent, TOP_N } from '@/components/ui/top-content'
import { CONTENT_KINDS, type ContentKind, type ContentList, type EntityFacts } from '@/lib/analytics'

const song = (n: number): ContentList['items'][number] => ({
  id: `s${n}`, title: `Song ${n}`, image: n % 2 ? 'https://i.scdn.co/image/x' : null, sub: null, count: 100 - n,
})
/** Eight songs — more than TOP_N, so this list is the one that earns a View all. */
const songs: ContentList = { items: Array.from({ length: 8 }, (_, i) => song(i + 1)), attributed: 500, unattributed: 50 }
/** Four products — fewer than TOP_N, so every row already shows. */
const merch: ContentList = {
  items: [
    { id: 'm1', title: 'Tour Tee 2026', image: null, sub: '$32', count: 6 },
    { id: 'm2', title: 'Embroidered Cap', image: null, sub: '$28', count: 4 },
    { id: 'm3', title: 'Heatwaves Vinyl', image: null, sub: '$34', count: 2 },
    { id: 'm4', title: 'Logo Tote', image: null, sub: '$18', count: 1 },
  ],
  attributed: 13, unattributed: 0,
}
const nothing: ContentList = { items: [], attributed: 0, unattributed: 0 }
const lists = { songs, merch } as Record<ContentKind['key'], ContentList>

const headings = () => screen.queryAllByRole('heading').map((h) => h.textContent)
const headingLevels = () => screen.queryAllByRole('heading').map((h) => h.tagName)
const colFor = (name: string) => screen.getByRole('heading', { name }).closest('section')!
const rowsIn = (el: HTMLElement) => within(el).getAllByRole('listitem')

describe('TopContent', () => {
  it('heads each column from the registry, and the registry knows only songs and merch', () => {
    render(<TopContent lists={lists} />)
    expect(headings()).toEqual(CONTENT_KINDS.map((k) => k.heading))
    // The overview page has no h1/h2 of its own, so these are its first headings.
    expect(new Set(headingLevels())).toEqual(new Set(['H2']))
    expect(CONTENT_KINDS.map((k) => k.entity)).toEqual(['track', 'merch'])
    // Tour ranking was cut: dates are not comparable to each other.
    expect((CONTENT_KINDS as readonly { entity: string }[]).some((k) => k.entity === 'tour_date')).toBe(false)
  })

  it('CRITICAL: shows at most TOP_N rows per column, however long the list is', () => {
    render(<TopContent lists={lists} />)
    expect(songs.items.length).toBeGreaterThan(TOP_N)
    expect(rowsIn(colFor('Most Played Songs') as HTMLElement)).toHaveLength(TOP_N)
    expect(rowsIn(colFor('Most Clicked Merch') as HTMLElement)).toHaveLength(merch.items.length)
  })

  it('CRITICAL: View all appears only where rows are HIDDEN — never over a list already fully shown', () => {
    render(<TopContent lists={lists} />)
    expect(within(colFor('Most Played Songs') as HTMLElement).getByRole('button', { name: /view all/i })).toBeTruthy()
    expect(within(colFor('Most Clicked Merch') as HTMLElement).queryByRole('button', { name: /view all/i })).toBeNull()
  })

  it('View all opens a window holding EVERY row, not just the five on the page', () => {
    render(<TopContent lists={lists} />)
    fireEvent.click(screen.getByRole('button', { name: /view all/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(songs.items.length)
    expect(within(dialog).getByText('Song 8')).toBeTruthy()
  })

  it('the window closes on Escape', () => {
    render(<TopContent lists={lists} />)
    fireEvent.click(screen.getByRole('button', { name: /view all/i }))
    expect(screen.queryByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CRITICAL: the leader alone is ringed — in every column, and only the first row', () => {
    render(<TopContent lists={lists} />)
    for (const name of ['Most Played Songs', 'Most Clicked Merch']) {
      const rows = rowsIn(colFor(name) as HTMLElement)
      expect(rows[0].className).toMatch(/ring-1/)
      for (const r of rows.slice(1)) expect(r.className).not.toMatch(/ring-1/)
    }
  })

  it('CRITICAL: every row is the same size — no per-row sizing survives anywhere', () => {
    const { container } = render(<TopContent lists={lists} />)
    // THE ROW ITSELF IS IN THIS SWEEP, not just its children. An earlier version of
    // this test scanned only `li *`, so a ramp re-added to the <li> — where row height
    // and the inherited font-size actually live — left it green. It was caught by
    // re-adding the ramp and watching nothing happen, twice.
    const sized = [...container.querySelectorAll<HTMLElement>('li, li *')].filter(
      (el) => el.style.fontSize || el.style.height || el.style.width || el.style.paddingBlock,
    )
    expect(sized).toEqual([])
    // Every row, cover, title and count is drawn from ONE class string, not one per rank.
    // The row's own ring is the single allowed difference, so it is normalised away.
    const cls = (sel: string) => [...container.querySelectorAll(sel)].map((e) => e.className)
    const rowShape = cls('li').map((c) => c.replace(/ring-1|ring-ink-faint|rounded-md|border-transparent/g, '').replace(/\s+/g, ' ').trim())
    expect(new Set(rowShape).size).toBe(1)
    expect(new Set(cls('li > span:first-child')).size).toBe(1)
    expect(new Set(cls('li > span:nth-child(2) > span:first-child')).size).toBe(1)
    expect(new Set(cls('li > span:nth-child(3)')).size).toBe(1)
  })

  it('says nothing about attribution — that line was cut', () => {
    const { container } = render(<TopContent lists={lists} />)
    expect(container.textContent).not.toMatch(/named a|did not|what they acted on/i)
  })

  it('a kind with nothing to list has no column at all', () => {
    render(<TopContent lists={{ songs, merch: nothing } as Record<ContentKind['key'], ContentList>} />)
    expect(headings()).toEqual(['Most Played Songs'])
  })

  it('says so once when neither kind has anything', () => {
    render(<TopContent lists={{ songs: nothing, merch: nothing } as Record<ContentKind['key'], ContentList>} />)
    expect(headings()).toEqual([])
    expect(screen.getByText(/nothing played or clicked yet/i)).toBeTruthy()
  })

  it('CRITICAL: a block emptied by DELETIONS must not claim nothing happened — the KPI row above says otherwise', () => {
    // topContent keeps an event attributed when the row it named has since been
    // deleted, so `attributed` can be thousands while `items` is empty. Saying
    // "nothing yet" here would flatly contradict the buy-clicks tile on the same page.
    const allGone: ContentList = { items: [], attributed: 4000, unattributed: 0 }
    render(<TopContent lists={{ songs: nothing, merch: allGone } as Record<ContentKind['key'], ContentList>} />)
    expect(headings()).toEqual([])
    expect(screen.queryByText(/nothing played or clicked yet/i)).toBeNull()
    expect(screen.getByText(/since been deleted/i)).toBeTruthy()
  })

  it('CRITICAL: hides a second line that only repeats the title — a single\'s album is named after it', () => {
    const singles: ContentList = {
      items: [
        { id: 'a', title: 'What I Want', image: null, sub: 'What I Want', count: 13 },
        { id: 'b', title: 'Home Again', image: null, sub: '  home again  ', count: 9 },
        { id: 'c', title: 'Intro', image: null, sub: 'Heatwaves & Horizons', count: 4 },
      ],
      attributed: 26, unattributed: 0,
    }
    render(<TopContent lists={{ songs: singles, merch: nothing } as Record<ContentKind['key'], ContentList>} />)
    const rows = rowsIn(colFor('Most Played Songs') as HTMLElement)
    // Exact repeat, and a repeat differing only by case and padding, both go.
    expect(rows[0].textContent).toBe('What I Want13 plays')
    expect(rows[1].textContent).toBe('Home Again9 plays')
    // A real album name stays: it is the one that adds something.
    expect(rows[2].textContent).toContain('Heatwaves & Horizons')
  })

  describe('the hover', () => {
    const facts: Record<string, EntityFacts> = {
      s1: { kind: 'song', services: [{ key: 'soundcloud', pct: 62 }, { key: 'spotify', pct: 38 }] },
      s2: { kind: 'song', services: [{ key: 'spotify', pct: 100 }] },
      m1: { kind: 'merch', opened: 6, cart: 4 },
    }
    const withFacts = () => render(<TopContent lists={lists} facts={facts} />)

    it('shows nothing until a row is pointed at', () => {
      withFacts()
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('CRITICAL: a song names every service it was played on, as a percent', () => {
      withFacts()
      fireEvent.mouseEnter(rowsIn(colFor('Most Played Songs') as HTMLElement)[0], { clientX: 400, clientY: 300 })
      const tip = screen.getByRole('tooltip')
      expect(tip.textContent).toContain('62%')
      expect(tip.textContent).toContain('38%')
    })

    it('CRITICAL: one service reads 100% — the everyday case, not an empty panel', () => {
      withFacts()
      fireEvent.mouseEnter(rowsIn(colFor('Most Played Songs') as HTMLElement)[1], { clientX: 10, clientY: 10 })
      const tip = screen.getByRole('tooltip')
      expect(tip.textContent).toContain('100%')
      expect(tip.querySelectorAll('svg')).toHaveLength(1)
    })

    it('CRITICAL: merch shows opened and added to cart, each with its number', () => {
      withFacts()
      fireEvent.mouseEnter(rowsIn(colFor('Most Clicked Merch') as HTMLElement)[0], { clientX: 50, clientY: 50 })
      const tip = screen.getByRole('tooltip')
      expect(tip.textContent).toMatch(/opened/i)
      expect(tip.textContent).toContain('6')
      expect(tip.textContent).toMatch(/added to cart/i)
      expect(tip.textContent).toContain('4')
    })

    it('clears when the View all window closes under the cursor', () => {
      // Review 2026-09-23: the row unmounts without a mouseleave, so the tip used to stay
      // painted at its last spot until another row was hovered.
      withFacts()
      fireEvent.click(screen.getByRole('button', { name: /view all/i }))
      fireEvent.mouseEnter(within(screen.getByRole('dialog')).getAllByRole('listitem')[0], { clientX: 40, clientY: 40 })
      expect(screen.queryByRole('tooltip')).toBeTruthy()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('CRITICAL: it sits ABOVE and RIGHT of the cursor, and follows it', () => {
      withFacts()
      const row = rowsIn(colFor('Most Played Songs') as HTMLElement)[0]
      fireEvent.mouseEnter(row, { clientX: 400, clientY: 300 })
      const at = () => {
        const t = screen.getByRole('tooltip') as HTMLElement
        return { left: parseFloat(t.style.left), top: parseFloat(t.style.top) }
      }
      const first = at()
      expect(first.left).toBeGreaterThan(400)
      expect(first.top).toBeLessThan(300)
      // Following the cursor is the whole ask — a tip pinned to the row would not move.
      fireEvent.mouseMove(row, { clientX: 700, clientY: 120 })
      const second = at()
      expect(second.left).toBeGreaterThan(first.left)
      expect(second.top).toBeLessThan(first.top)
    })

    it('a row with no facts yet shows no tooltip rather than an empty one', () => {
      withFacts()
      fireEvent.mouseEnter(rowsIn(colFor('Most Played Songs') as HTMLElement)[2], { clientX: 5, clientY: 5 })
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('CRITICAL: the row under the pointer is marked, and only that row', () => {
      withFacts()
      const rows = rowsIn(colFor('Most Played Songs') as HTMLElement)
      const lit = () => rows.filter((r) => r.className.includes('bg-surface-hover')).length
      expect(lit()).toBe(0)
      fireEvent.mouseEnter(rows[2], { clientX: 5, clientY: 5 })
      expect(rows[2].className).toMatch(/bg-surface-hover/)
      expect(lit()).toBe(1)
      fireEvent.mouseLeave(rows[2])
      expect(lit()).toBe(0)
    })

    it('a row with no facts still lights up — the highlight is about pointing, not data', () => {
      withFacts()
      const rows = rowsIn(colFor('Most Played Songs') as HTMLElement)
      fireEvent.mouseEnter(rows[2], { clientX: 5, clientY: 5 })
      expect(rows[2].className).toMatch(/bg-surface-hover/)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('CRITICAL: the tip works inside the View-all window, and paints above it', () => {
      withFacts()
      fireEvent.click(screen.getByRole('button', { name: /view all/i }))
      const dialog = screen.getByRole('dialog')
      fireEvent.mouseEnter(within(dialog).getAllByRole('listitem')[0], { clientX: 300, clientY: 300 })
      const tip = screen.getByRole('tooltip')
      expect(tip.textContent).toContain('62%')
      // jsdom does not apply Tailwind, so stacking is compared by the tokens themselves:
      // the tip must out-rank the overlay it is drawn over, or it hides behind it.
      const z = (el: Element) => Number(/z-\[?(\d+)\]?/.exec(el.className)?.[1] ?? 0)
      expect(z(tip)).toBeGreaterThan(z(dialog))
    })

    it('leaving the row puts it away', () => {
      withFacts()
      const row = rowsIn(colFor('Most Played Songs') as HTMLElement)[0]
      fireEvent.mouseEnter(row, { clientX: 400, clientY: 300 })
      expect(screen.queryByRole('tooltip')).toBeTruthy()
      fireEvent.mouseLeave(row)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('without facts at all the block still renders and never hovers', () => {
      render(<TopContent lists={lists} />)
      fireEvent.mouseEnter(rowsIn(colFor('Most Played Songs') as HTMLElement)[0], { clientX: 1, clientY: 1 })
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })

  it('draws a cover where there is one and a quiet square where there is not', () => {
    const { container } = render(<TopContent lists={lists} />)
    // Songs 1,3,5 of the visible five carry an image; all four merch rows do not.
    expect(container.querySelectorAll('img')).toHaveLength(3)
    expect(container.querySelectorAll('li')).toHaveLength(TOP_N + merch.items.length)
  })
})
