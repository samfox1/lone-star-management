// @vitest-environment jsdom
// The single-song editor, and the pasted listen link that promotes an upload to Released.
/**
 * TrackCard — the orphan-single editor, now the SAME single-style modal a release
 * single uses. Tests the Spotify (stream_url) slot: pasting a link saves it on blur
 * via updateContentAction, which promotes an upload to Released by derivation. The
 * audio uploader, supabase client (sparkline + signed audio URL), and server actions
 * are mocked.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TrackCard, type Track } from '@/app/artists/[id]/(dashboard)/tracks/track-card'
import { setTrackTypeAction, updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'

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
  setTrackReleaseAction: vi.fn(async () => ({})),
  setTrackTypeAction: vi.fn(async () => ({})),
  setTrackParentReleaseAction: vi.fn(async () => ({})),
  // Pulled in transitively via release-card (shared SONG_PLATFORMS).
  setReleaseLinkAction: vi.fn(async () => ({})),
  setReleaseTypeAction: vi.fn(async () => ({})),
  updateReleaseDetailsAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const track = (over: Partial<Track> = {}): Track => ({
  id: 't1', title: 'Demo', cover_url: null, stream_url: null, source: 'manual',
  audio_path: null, release_id: null, parent_release_id: null, release_date: null,
  release_type: 'single', on_site: false, spotify_id: null, apple_id: null, deezer_id: null,
  apple_url: null, soundcloud_url: null, deezer_url: null, ...over,
})

function openModal(t: Track = track()) {
  render(<TrackCard track={t} artistId="a1" releases={[]} />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t.title) }))
}

describe('TrackCard listen link', () => {
  it('saves a pasted Spotify link on blur through updateContentAction (promotes the song)', async () => {
    openModal()
    const input = screen.getByPlaceholderText('Spotify link')
    fireEvent.change(input, { target: { value: 'https://soundcloud.com/x/song' } })
    fireEvent.blur(input)

    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const [type, id, artistId, fd] = vi.mocked(updateContentAction).mock.calls[0]
    expect([type, id, artistId]).toEqual(['track', 't1', 'a1'])
    expect((fd as FormData).get('stream_url')).toBe('https://soundcloud.com/x/song')
  })

  it('prefills the current Spotify link', () => {
    openModal(track({ stream_url: 'https://x/s' }))
    expect(screen.getByPlaceholderText('Spotify link')).toHaveValue('https://x/s')
  })
})

/**
 * SONG TYPE (Sam, 2026-08-21: "Theres no way to edit the details of the music").
 *
 * A song's `release_type` decides which section of the Music page it files under and what
 * the site's grid calls it — and it was settable at ADD time and never again. A release
 * card had type chips; a SONG had a read-only badge, so a standalone SoundCloud track,
 * the one kind that has no release row to edit instead, could never be re-tagged at all.
 * That is how a live set ended up filed as a remix.
 */
describe('TrackCard song type', () => {
  const openEdit = (t: Track = track()) => {
    openModal(t)
    fireEvent.click(screen.getByRole('button', { name: `${t.title} options` }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/i }))
  }
  /** The song card's own modal also has a Save; the edit sheet opens on top, so its
   *  Save is the last one mounted. */
  const saveEdit = () => {
    const buttons = screen.getAllByRole('button', { name: 'Save' })
    fireEvent.click(buttons[buttons.length - 1])
  }

  it('CRITICAL: offers every type in the registry, not a hand-picked few', () => {
    // Derived from RELEASE_TYPES, so a type added later appears here the day it lands
    // (AGENTS.md rule 4) — this is the check that would have caught 'live' being
    // unpickable.
    openEdit()
    for (const label of ['Single', 'EP', 'Album', 'Remix', 'Live', 'Featured']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('CRITICAL: picking Live saves it against the song', async () => {
    openEdit(track({ release_type: 'remix' }))
    fireEvent.click(screen.getByRole('button', { name: 'Live' }))
    saveEdit()

    await waitFor(() => expect(setTrackTypeAction).toHaveBeenCalledTimes(1))
    const [id, artistId, fd] = vi.mocked(setTrackTypeAction).mock.calls[0]
    expect([id, artistId]).toEqual(['t1', 'a1'])
    expect((fd as FormData).get('release_type')).toBe('live')
  })

  it('does not write a type the manager never touched', async () => {
    // Saving an unrelated edit must not stamp release_type — a no-op write would lock
    // the value against a later Spotify sync for no reason.
    openEdit(track({ release_type: 'single' }))
    saveEdit()
    await waitFor(() => expect(screen.queryByText('Edit song')).toBeNull())
    expect(setTrackTypeAction).not.toHaveBeenCalled()
  })
})
