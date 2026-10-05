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
 *   - "Merge" shows ONLY on a row whose title another song's normalises to — the same
 *     rule the song modal uses (Sam, 2026-09-11). It once offered every song in the
 *     catalogue on every row, a delete-a-song button pointed at unrelated songs;
 *   - the modal opens from a tracklist row with THAT row's song as the one that
 *     will be deleted (preselecting the wrong song deletes the wrong row), and offers
 *     only its twins — never itself, never an unrelated song;
 *   - confirm accepted → mergeSongsAction gets (artistId, keepId, dropId) in that
 *     order — backwards deletes the keeper;
 *   - confirm declined → NOTHING is called (the merge deletes a row; the confirm
 *     is the only undo).
 *
 * Actions are mocked as in the sibling card tests; the confirm is the app's own dialog
 * (useConfirm), answered per test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { ReleaseCard, type Release, type ReleaseSong } from '@/app/artists/[id]/(dashboard)/releases/release-card'
import { mergeSongsAction } from '@/app/artists/[id]/(dashboard)/music/actions'
import type { MergeTarget } from '@/app/artists/[id]/(dashboard)/music/merge-song-modal'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
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
  // The song modal's own actions (a tracklist song opens the shared SongModal).
  setTrackReleaseAction: vi.fn(async () => ({})),
  setTrackTypeAction: vi.fn(async () => ({})),
  setTrackParentReleaseAction: vi.fn(async () => ({})),
  setTrackOnSiteAction: vi.fn(async () => ({})),
  setTrackReleasedAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/music/actions', () => ({
  mergeSongsAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const song = (id: string, title: string): ReleaseSong => ({
  id, title, featured_artists: [], stream_url: null, audio_path: null, cover_url: null, source: 'spotify',
  release_id: 'r1', release_date: null, release_type: 'ep', on_site: true,
  spotify_id: null, apple_id: null, deezer_id: null,
  apple_url: null, soundcloud_url: null, deezer_url: null,
})

const release = (over: Partial<Release> = {}): Release => ({
  id: 'r1', title: 'Night EP', slug: 'night-ep', cover_url: null, release_date: '2026-01-01',
  release_type: 'ep', links: [], on_site: false,
  songs: [song('s1', 'Alpha'), song('s2', 'Beta')],
  ...over,
})

/** The full catalog, as the page passes it: EVERY song, including this release's own.
 *  'Beta (feat. Kay)' normalises to 'beta' — a stray duplicate of the EP's Beta with no
 *  release. Alpha has no twin anywhere. */
const catalog: MergeTarget[] = [
  { id: 's1', title: 'Alpha', release_id: 'r1' },
  { id: 's2', title: 'Beta', release_id: 'r1' },
  { id: 'x8', title: 'Beta (feat. Kay)', release_id: null },
  { id: 'x9', title: 'Gamma (standalone)', release_id: null },
]

function openTracklist(r: Release = release(), targets = catalog) {
  render(<ReleaseCard release={r} artistId="a1" artistSlug="lone-pine" mergeTargets={targets} />)
  fireEvent.click(screen.getByRole('button', { name: /Night EP — \d+ songs?/ }))
}

describe('ReleaseCard tracklist merge', () => {
  it('CRITICAL: Merge shows only on a row that has a same-title twin', () => {
    openTracklist()
    expect(screen.getByRole('button', { name: 'Merge Beta into…' })).toBeInTheDocument()
    // Alpha has no twin: offering to delete it into Beta or Gamma is how a real song
    // gets folded into an unrelated one.
    expect(screen.queryByRole('button', { name: 'Merge Alpha into…' })).toBeNull()
  })

  it('CRITICAL: opens with THAT row as the one to be deleted, and offers only its twins', () => {
    openTracklist()
    fireEvent.click(screen.getByRole('button', { name: 'Merge Beta into…' }))

    // The modal names the row's song as the one that disappears…
    const modal = screen.getByRole('dialog', { name: 'Merge song' })
    expect(within(modal).getByRole('heading', { name: 'Merge “Beta”' })).toBeInTheDocument()
    // …and the keeper selector offers its twin and nothing else (the empty choice aside).
    fireEvent.click(within(modal).getByRole('combobox', { name: 'Keep' }))
    const options = within(screen.getByRole('listbox', { name: 'Keep' })).getAllByRole('option').map((o) => o.textContent)
    expect(options.slice(1)).toEqual(['Beta (feat. Kay)'])
  })

  it('the same song on ANOTHER release is not a twin (one row per release, 2026-09-11)', () => {
    openTracklist(release(), [
      ...catalog.filter((t) => t.id !== 'x8'),
      { id: 'x7', title: 'Beta', release_id: 'r-single' },
    ])
    expect(screen.queryByRole('button', { name: 'Merge Beta into…' })).toBeNull()
  })

  /** Fill in the keeper and press Merge; returns the question that raises. */
  async function askToMerge() {
    fireEvent.click(screen.getByRole('button', { name: 'Merge Beta into…' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Keep' }))
    fireEvent.click(screen.getByRole('option', { name: 'Beta (feat. Kay)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    // The QUESTION names the action; the answer itself is just "Confirm" (Sam, 2026-10-02).
    return screen.findByRole('dialog', { name: /^Merge “Beta” into “/ })
  }

  it('confirm accepted → calls mergeSongsAction with (artistId, keepId, dropId) — the row song is the one dropped', async () => {
    openTracklist()
    const ask = await askToMerge()
    // The question NAMES both songs, so the manager can see which one disappears.
    expect(ask).toHaveTextContent(/“Beta” will be deleted/)
    fireEvent.click(within(ask).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(mergeSongsAction).toHaveBeenCalledTimes(1))
    expect(mergeSongsAction).toHaveBeenCalledWith('a1', 'x8', 's2')
  })

  it('CRITICAL: confirm declined → nothing is called', async () => {
    openTracklist()
    const ask = await askToMerge()
    // The question actually gated the click — otherwise this test passes while the
    // merge silently races the assertion below.
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(mergeSongsAction).not.toHaveBeenCalled())
  })

  it('rows offer no merge when there is nothing to merge into', () => {
    // A catalog of only this song: its "targets" would be empty after self-exclusion.
    openTracklist(release({ songs: [song('s2', 'Beta')], title: 'Night EP' }), [{ id: 's2', title: 'Beta' }])
    expect(screen.queryByRole('button', { name: 'Merge Beta into…' })).toBeNull()
  })
})
