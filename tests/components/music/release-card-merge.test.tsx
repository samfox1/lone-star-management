// @vitest-environment jsdom
// Merging a duplicate song from inside a release tracklist.
/**
 * ReleaseCard tracklist — "Merge into…" on a release's songs.
 *
 * The sync REFUSES an uncertain cross-platform match, and the duplicate it leaves
 * behind frequently lives INSIDE a release tracklist — where, until this, nothing
 * offered the merge that standalone song cards (TrackCard) already have. These pin
 * the affordance to the SAME modal and server action the song cards use:
 *
 *   - the modal opens from a tracklist row with THAT row's song as the one that
 *     will be deleted (preselecting the wrong song deletes the wrong row);
 *   - the row's own song is never offered as its target (merging a song into
 *     itself is refused server-side, but offering it invites the attempt);
 *   - confirm accepted → mergeSongsAction gets (artistId, keepId, dropId) in that
 *     order — backwards deletes the keeper;
 *   - confirm declined → NOTHING is called (the merge deletes a row; the confirm
 *     is the only undo).
 *
 * Actions are mocked as in the sibling card tests; the confirm is stubbed per test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { ReleaseCard, type Release, type ReleaseSong } from '@/app/artists/[id]/(dashboard)/releases/release-card'
import { mergeSongsAction } from '@/app/artists/[id]/(dashboard)/music/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/track-audio-uploader', () => ({
  TrackAudioUploader: () => <div data-testid="uploader" />,
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: async () => ({ data: [] }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  setReleaseLinkAction: vi.fn(async () => ({})),
  setReleaseTypeAction: vi.fn(async () => ({})),
  updateReleaseDetailsAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/music/actions', () => ({
  mergeSongsAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const song = (id: string, title: string): ReleaseSong => ({
  id, title, featured_artists: [], stream_url: null, audio_path: null,
  spotify_id: null, apple_id: null, deezer_id: null,
  apple_url: null, soundcloud_url: null, deezer_url: null,
})

const release = (over: Partial<Release> = {}): Release => ({
  id: 'r1', title: 'Night EP', slug: 'night-ep', cover_url: null, release_date: '2026-01-01',
  release_type: 'ep', links: [], on_site: false,
  songs: [song('s1', 'Alpha'), song('s2', 'Beta')],
  ...over,
})

/** The full catalog, as the page passes it: EVERY song, including this release's own. */
const catalog = [
  { id: 's1', title: 'Alpha' },
  { id: 's2', title: 'Beta' },
  { id: 'x9', title: 'Gamma (standalone)' },
]

function openTracklist(r: Release = release(), targets = catalog) {
  render(<ReleaseCard release={r} artistId="a1" artistSlug="lone-pine" mergeTargets={targets} />)
  fireEvent.click(screen.getByRole('button', { name: /Night EP — \d+ songs?/ }))
}

describe('ReleaseCard tracklist merge', () => {
  it('opens the merge modal from a row with THAT song as the one to be deleted, never offering it as its own target', () => {
    openTracklist()
    fireEvent.click(screen.getByRole('button', { name: 'Merge Beta into…' }))

    // The modal names the row's song as the one that disappears…
    expect(screen.getByText('Merge song')).toBeInTheDocument()
    expect(screen.getByText('Beta', { selector: 'span' })).toBeInTheDocument()
    // …and the keeper selector offers everything EXCEPT it.
    const select = screen.getByLabelText(/Keep this song/i)
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Alpha')
    expect(options).toContain('Gamma (standalone)')
    expect(options).not.toContain('Beta')
  })

  it('confirm accepted → calls mergeSongsAction with (artistId, keepId, dropId) — the row song is the one dropped', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    openTracklist()
    fireEvent.click(screen.getByRole('button', { name: 'Merge Beta into…' }))
    fireEvent.change(screen.getByLabelText(/Keep this song/i), { target: { value: 's1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    await waitFor(() => expect(mergeSongsAction).toHaveBeenCalledTimes(1))
    expect(mergeSongsAction).toHaveBeenCalledWith('a1', 's1', 's2')
  })

  it('CRITICAL: confirm declined → nothing is called', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    openTracklist()
    fireEvent.click(screen.getByRole('button', { name: 'Merge Beta into…' }))
    fireEvent.change(screen.getByLabelText(/Keep this song/i), { target: { value: 's1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    // The confirm actually gated the click — otherwise this test passes while the
    // merge silently races the assertion below.
    expect(confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mergeSongsAction).not.toHaveBeenCalled())
  })

  it('rows offer no merge when there is nothing to merge into', () => {
    // A catalog of only this song: its "targets" would be empty after self-exclusion.
    openTracklist(release({ songs: [song('s2', 'Beta')], title: 'Night EP' }), [{ id: 's2', title: 'Beta' }])
    expect(screen.queryByRole('button', { name: 'Merge Beta into…' })).toBeNull()
  })
})
