// @vitest-environment jsdom
/**
 * UnreleasedBrowser — the dashboard-only half of the Music tab. Tests the grouping
 * (unreleased releases first, loose uploads last, chrome skipped when everything is
 * loose), the manageable unreleased-release cards, the empty state, the add flow,
 * and — decision #3 — that there is NO publish affordance (Unreleased never reaches
 * the public site). Heavy cards are stubbed so the test doesn't pull in the audio
 * uploader / server actions.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { UnreleasedBrowser, LOOSE, type UnreleasedTrack } from '@/app/artists/[id]/(dashboard)/music/unreleased-browser'
import type { Release } from '@/app/artists/[id]/(dashboard)/releases/release-card'

// Stub the heavy cards so we only exercise the browser's grouping logic.
vi.mock('@/app/artists/[id]/(dashboard)/tracks/track-card', () => ({
  TrackCard: ({ track }: { track: { title: string } }) => <li data-testid="track">{track.title}</li>,
}))
vi.mock('@/app/artists/[id]/(dashboard)/releases/release-card', () => ({
  ReleaseCard: ({ release }: { release: { title: string } }) => <div data-testid="release-card">{release.title}</div>,
}))

afterEach(cleanup)

const track = (over: Partial<UnreleasedTrack>): UnreleasedTrack => ({
  id: 'x', title: 'x', cover_url: null, stream_url: null, source: 'manual',
  audio_path: null, release_id: null, spotify_id: null, apple_id: null,
  deezer_id: null, apple_url: null, group: LOOSE, groupLabel: '', ...over,
})

const demoRelease = (over: Partial<Release> = {}): Release => ({
  id: 'r1', title: 'Demo EP', slug: 'demo-ep', cover_url: null, release_date: null,
  release_type: 'ep', links: [], visible: true, songs: [], ...over,
})

function setup(
  tracks: UnreleasedTrack[],
  addAction = vi.fn(async (_fd: FormData) => ({})),
  unreleasedReleases: Release[] = [],
) {
  render(
    <UnreleasedBrowser
      tracks={tracks}
      artistId="a1"
      artistSlug="a"
      releases={[]}
      unreleasedReleases={unreleasedReleases}
      addAction={addAction}
    />,
  )
  return addAction
}

const titles = () => screen.getAllByTestId('track').map((el) => el.textContent)

describe('UnreleasedBrowser', () => {
  it('groups songs under their unreleased release, loose uploads last', () => {
    setup([
      track({ id: '1', title: 'Loose One' }),
      track({ id: '2', title: 'Demo A', group: 'r1', groupLabel: 'Demo EP' }),
      track({ id: '3', title: 'Demo B', group: 'r1', groupLabel: 'Demo EP' }),
    ])
    expect(screen.getByText('Demo EP')).toBeInTheDocument()
    expect(screen.getByText('Not on a release')).toBeInTheDocument()
    expect(titles()).toEqual(['Demo A', 'Demo B', 'Loose One']) // release group first
  })

  it('renders unreleased releases as manageable cards (edit type/links/delete)', () => {
    setup([], undefined, [demoRelease()])
    expect(screen.getByTestId('release-card')).toHaveTextContent('Demo EP')
    // A release card alone means the section is not empty.
    expect(screen.queryByText('No unreleased music')).not.toBeInTheDocument()
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
    setup([track({ id: '1', title: 'Demo' })], undefined, [demoRelease()])
    expect(screen.queryByText('Publish')).not.toBeInTheDocument()
  })

  it('reveals the add form and submits the new song title', async () => {
    const addAction = setup([])
    fireEvent.click(screen.getByLabelText('Add song'))
    fireEvent.change(screen.getByPlaceholderText('Song title'), { target: { value: 'New Demo' } })
    fireEvent.submit(screen.getByPlaceholderText('Song title').closest('form')!)
    await waitFor(() => expect(addAction).toHaveBeenCalledTimes(1))
    const fd = addAction.mock.calls[0][0] as FormData
    expect(fd.get('title')).toBe('New Demo')
  })
})
