// @vitest-environment jsdom
// The chip and sort control above a dashboard grid. Holds no state of its own.
/**
 * FilterBar — the chip + sort control for dashboard grids. Presentational: it holds no
 * state, just fires onChip / onSort and marks the active chip / sort with aria-pressed.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FilterBar } from '@/app/artists/[id]/(dashboard)/filter-bar'

afterEach(cleanup)

const CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'spotify', label: 'Spotify' },
]
const SORTS = [
  { key: 'az', label: 'A–Z' },
  { key: 'newest', label: 'Newest' },
]

describe('FilterBar', () => {
  it('fires onChip with the clicked chip key', () => {
    const onChip = vi.fn()
    render(<FilterBar chips={CHIPS} active="all" onChip={onChip} />)
    fireEvent.click(screen.getByText('Spotify'))
    expect(onChip).toHaveBeenCalledWith('spotify')
  })

  it('marks the active chip with aria-pressed', () => {
    render(<FilterBar chips={CHIPS} active="spotify" onChip={vi.fn()} />)
    expect(screen.getByText('Spotify').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('All').getAttribute('aria-pressed')).toBe('false')
  })

  it('fires onSort with the clicked sort key', () => {
    const onSort = vi.fn()
    render(<FilterBar chips={CHIPS} active="all" onChip={vi.fn()} sortOptions={SORTS} sort="az" onSort={onSort} />)
    fireEvent.click(screen.getByText('Newest'))
    expect(onSort).toHaveBeenCalledWith('newest')
  })

  it('omits the sort control when sortOptions is absent', () => {
    render(<FilterBar chips={CHIPS} active="all" onChip={vi.fn()} />)
    expect(screen.queryByText('A–Z')).not.toBeInTheDocument()
  })

  // The `trailing` slot carries every ACTION on a dashboard grid — Import from Drive,
  // Sync, the one + button. Dropping `{trailing}` from the render silently removes all
  // of them from the toolbar while the chips and sort still look right. The consumer
  // tests notice (music-browser.test.tsx), but they report it as "no Sync button",
  // which points at MusicBrowser rather than at the slot that stopped rendering.
  it('renders both slots: leading before the chips, trailing before the sort control', () => {
    render(
      <FilterBar
        leading={<span>LEAD</span>}
        trailing={<button type="button">Import</button>}
        chips={CHIPS}
        active="all"
        onChip={vi.fn()}
        sortOptions={SORTS}
        sort="az"
        onSort={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
    expect(screen.getByText('LEAD')).toBeInTheDocument()
  })

  it('renders the trailing slot even with no sort control (the slot is not sort-gated)', () => {
    render(<FilterBar chips={CHIPS} active="all" onChip={vi.fn()} trailing={<button type="button">Import</button>} />)
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
  })
})
