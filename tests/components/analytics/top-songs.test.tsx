// @vitest-environment jsdom
// The played-songs list, and the line that keeps it from looking short.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopSongs } from '@/components/ui/top-songs'

const songs = [
  { id: 'a', title: 'Summer Sun', cover_url: 'https://i.scdn.co/image/ab67616d0000b273abc', album_name: 'Summer', plays: 18 },
  { id: 'b', title: 'Home Again', cover_url: null, album_name: null, plays: 6 },
]

describe('TopSongs', () => {
  it('lists every song with its plays, most played first', () => {
    render(<TopSongs songs={songs} attributed={24} unattributed={46} />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('Summer Sun')
    expect(items[0]).toContain('18')
    expect(items[1]).toContain('Home Again')
  })

  it('CRITICAL: the bar is against the most-played song, and the leader is full', () => {
    const { container } = render(<TopSongs songs={songs} attributed={24} unattributed={46} />)
    const w = [...container.querySelectorAll('[data-bar]')].map((b) => parseFloat((b as HTMLElement).style.width))
    expect(w[0]).toBe(100)
    expect(w[1]).toBeCloseTo((6 / 18) * 100, 5)
  })

  it('CRITICAL: says how many plays named a song and how many did not', () => {
    render(<TopSongs songs={songs} attributed={24} unattributed={46} />)
    expect(screen.getByText(/24 plays named a song · 46 did not/i)).toBeTruthy()
  })

  it('drops the second half of the line when every play named a song', () => {
    render(<TopSongs songs={songs} attributed={24} unattributed={0} />)
    expect(screen.getByText(/^24 plays named a song$/i)).toBeTruthy()
  })

  it('draws a cover when there is one and a quiet square when there is not', () => {
    const { container } = render(<TopSongs songs={songs} attributed={24} unattributed={0} />)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says what is missing rather than an empty frame', () => {
    render(<TopSongs songs={[]} attributed={0} unattributed={0} empty="No plays yet." />)
    expect(screen.getByText('No plays yet.')).toBeTruthy()
  })
})
