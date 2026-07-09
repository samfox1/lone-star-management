// @vitest-environment jsdom
/**
 * MusicTabs — the Released | Unreleased switch on the Music page. Released is
 * the default view; switching swaps the rendered half (the inactive half is
 * unmounted, so the PublishBar only exists on Released).
 */
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MusicTabs } from '@/app/artists/[id]/(dashboard)/music/music-tabs'

afterEach(cleanup)

function setup() {
  render(
    <MusicTabs
      releasedCount={12}
      unreleasedCount={3}
      released={<div>RELEASED HALF</div>}
      unreleased={<div>UNRELEASED HALF</div>}
    />,
  )
}

describe('MusicTabs', () => {
  it('shows Released by default with both counts', () => {
    setup()
    expect(screen.getByText('RELEASED HALF')).toBeInTheDocument()
    expect(screen.queryByText('UNRELEASED HALF')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Released.*12/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Unreleased.*3/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches to Unreleased and back', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Unreleased/ }))
    expect(screen.getByText('UNRELEASED HALF')).toBeInTheDocument()
    expect(screen.queryByText('RELEASED HALF')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Released.*12/ }))
    expect(screen.getByText('RELEASED HALF')).toBeInTheDocument()
  })
})
