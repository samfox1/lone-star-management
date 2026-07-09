// @vitest-environment jsdom
/**
 * TracksBrowser — the Music-tab tracks view. Tests its own logic (source-chip filter,
 * sort, chip derivation) with TrackCard stubbed out, so the test doesn't pull in the
 * audio uploader / server actions. The add + publish actions are injected mocks.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TracksBrowser, type BrowserTrack } from '@/app/artists/[id]/(dashboard)/music/tracks-browser'

// Stub the heavy card so we only exercise the browser's filter/sort/chip logic.
vi.mock('@/app/artists/[id]/(dashboard)/tracks/track-card', () => ({
  TrackCard: ({ track }: { track: { title: string } }) => <li data-testid="track">{track.title}</li>,
}))

afterEach(cleanup)

const track = (over: Partial<BrowserTrack>): BrowserTrack => ({
  id: 'x', title: 'x', cover_url: null, stream_url: null, source: 'manual',
  audio_path: null, release_id: null, created_at: '2026-01-01', ...over,
})

const TRACKS: BrowserTrack[] = [
  track({ id: '1', title: 'Alpha', source: 'spotify', created_at: '2026-01-01' }),
  track({ id: '2', title: 'Beta', source: 'manual', created_at: '2026-02-01' }),
  track({ id: '3', title: 'gamma', source: 'spotify', created_at: '2026-03-01' }),
]

function setup(tracks = TRACKS) {
  return render(
    <TracksBrowser
      tracks={tracks}
      artistId="a1"
      releases={[]}
      addAction={vi.fn(async () => ({}))}
      publishAction={vi.fn(async () => ({}))}
    />,
  )
}

const titles = () => screen.getAllByTestId('track').map((el) => el.textContent)

describe('TracksBrowser', () => {
  it('shows every track in catalog order by default', () => {
    setup()
    expect(titles()).toEqual(['Alpha', 'Beta', 'gamma'])
  })

  it('filters to a single source when its chip is clicked', () => {
    setup()
    fireEvent.click(screen.getByText('Manual'))
    expect(titles()).toEqual(['Beta'])
    fireEvent.click(screen.getByText('Spotify'))
    expect(titles()).toEqual(['Alpha', 'gamma'])
  })

  it('sorts A–Z and Newest', () => {
    setup()
    fireEvent.click(screen.getByText('A–Z'))
    expect(titles()).toEqual(['Alpha', 'Beta', 'gamma'])
    fireEvent.click(screen.getByText('Newest'))
    expect(titles()).toEqual(['gamma', 'Beta', 'Alpha']) // 2026-03, -02, -01
  })

  it('shows no source chips when every track shares one source', () => {
    setup([track({ id: '1', title: 'Only', source: 'manual' })])
    expect(screen.queryByText('Spotify')).not.toBeInTheDocument()
    expect(screen.getByTestId('track')).toHaveTextContent('Only')
  })
})
