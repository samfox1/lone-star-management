// @vitest-environment jsdom
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
import { updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'

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
  audio_path: null, release_id: null, spotify_id: null, apple_id: null,
  deezer_id: null, apple_url: null, soundcloud_url: null, deezer_url: null, ...over,
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
