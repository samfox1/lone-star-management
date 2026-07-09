// @vitest-environment jsdom
/**
 * UnreleasedBrowser — the dashboard-only half of the Music tab. Tests the grouping
 * (unreleased releases first, loose uploads last, chrome skipped when everything is
 * loose), the empty state, the add flow, and — decision #3 — that there is NO
 * publish affordance (Unreleased never reaches the public site). TrackCard is
 * stubbed so the test doesn't pull in the audio uploader / server actions.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { UnreleasedBrowser, LOOSE, type UnreleasedTrack } from '@/app/artists/[id]/(dashboard)/music/unreleased-browser'

// Stub the heavy card so we only exercise the browser's grouping logic.
vi.mock('@/app/artists/[id]/(dashboard)/tracks/track-card', () => ({
  TrackCard: ({ track }: { track: { title: string } }) => <li data-testid="track">{track.title}</li>,
}))

afterEach(cleanup)

const track = (over: Partial<UnreleasedTrack>): UnreleasedTrack => ({
  id: 'x', title: 'x', cover_url: null, stream_url: null, source: 'manual',
  audio_path: null, release_id: null, spotify_id: null, apple_id: null,
  deezer_id: null, apple_url: null, group: LOOSE, groupLabel: '', ...over,
})

function setup(tracks: UnreleasedTrack[], addAction = vi.fn(async (_fd: FormData) => ({}))) {
  render(<UnreleasedBrowser tracks={tracks} artistId="a1" releases={[]} addAction={addAction} />)
  return addAction
}

const titles = () => screen.getAllByTestId('track').map((el) => el.textContent)

describe('UnreleasedBrowser', () => {
  it('groups tracks under their unreleased release, loose uploads last', () => {
    setup([
      track({ id: '1', title: 'Loose One' }),
      track({ id: '2', title: 'Demo A', group: 'r1', groupLabel: 'Demo EP' }),
      track({ id: '3', title: 'Demo B', group: 'r1', groupLabel: 'Demo EP' }),
    ])
    expect(screen.getByText('Demo EP')).toBeInTheDocument()
    expect(screen.getByText('Not on a release')).toBeInTheDocument()
    expect(titles()).toEqual(['Demo A', 'Demo B', 'Loose One']) // release group first
  })

  it('skips the group chrome when everything is loose', () => {
    setup([track({ id: '1', title: 'Only Upload' })])
    expect(screen.queryByText('Not on a release')).not.toBeInTheDocument()
    expect(titles()).toEqual(['Only Upload'])
  })

  it('shows the empty state when there is nothing unreleased', () => {
    setup([])
    expect(screen.getByText('No unreleased music')).toBeInTheDocument()
  })

  it('has NO publish affordance — unreleased music is dashboard-only', () => {
    setup([track({ id: '1', title: 'Demo' })])
    expect(screen.queryByText('Publish')).not.toBeInTheDocument()
  })

  it('reveals the add form and submits the new title', async () => {
    const addAction = setup([])
    fireEvent.click(screen.getByLabelText('Add track'))
    fireEvent.change(screen.getByPlaceholderText('Track title'), { target: { value: 'New Demo' } })
    fireEvent.submit(screen.getByPlaceholderText('Track title').closest('form')!)
    await waitFor(() => expect(addAction).toHaveBeenCalledTimes(1))
    const fd = addAction.mock.calls[0][0] as FormData
    expect(fd.get('title')).toBe('New Demo')
  })
})
