// @vitest-environment jsdom
/**
 * SongAddButton — the Music page's single + button. Two ways in: Add manually
 * (title, contributors, cover, the audio file, REQUIRED released/unreleased
 * toggle) or From streaming (one URL row per service; any link ⇒ automatically
 * released, toggle locked). Uploads/inserts run through a mocked supabase
 * client; URL→column mapping is unit-tested directly.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SongAddButton, parseContributors, parseStreamingLinks } from '@/app/artists/[id]/(dashboard)/music/song-add'

const inserted: Record<string, unknown>[] = []
const uploads: { bucket: string; path: string }[] = []

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row)
        return { error: null }
      },
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          uploads.push({ bucket, path })
          return { error: null }
        },
        remove: async () => ({}),
      }),
    },
  }),
}))

beforeEach(() => {
  inserted.length = 0
  uploads.length = 0
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('parseStreamingLinks', () => {
  it('parses ids from Spotify/Deezer and stores Apple/SoundCloud URLs', () => {
    expect(
      parseStreamingLinks({
        spotify: 'https://open.spotify.com/track/AbC123?si=x',
        apple: 'https://music.apple.com/us/album/song/1?i=2',
        soundcloud: 'https://soundcloud.com/artist/song',
        deezer: 'https://www.deezer.com/en/track/9876',
      }),
    ).toEqual({
      stream_url: 'https://open.spotify.com/track/AbC123?si=x',
      spotify_id: 'AbC123',
      apple_url: 'https://music.apple.com/us/album/song/1?i=2',
      soundcloud_url: 'https://soundcloud.com/artist/song',
      provider_url: 'https://www.deezer.com/en/track/9876',
      deezer_id: '9876',
    })
  })
  it('drops empty rows', () => {
    expect(parseStreamingLinks({ spotify: '  ' })).toEqual({})
  })
})

describe('parseContributors', () => {
  it('splits on commas and trims', () => {
    expect(parseContributors(' A, B feat. C ,,')).toEqual(['A', 'B feat. C'])
  })
})

function openModal(defaultReleased?: 'released' | 'unreleased') {
  render(<SongAddButton artistId="a1" defaultReleased={defaultReleased} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add song' }))
  return screen.getByRole('dialog')
}

describe('SongAddButton', () => {
  it('offers Add manually and From streaming', () => {
    const dialog = openModal()
    expect(within(dialog).getByText('Add manually')).toBeInTheDocument()
    expect(within(dialog).getByText('From streaming')).toBeInTheDocument()
  })

  it('streaming: any URL locks the status to Released and inserts parsed columns', async () => {
    const dialog = openModal('unreleased')
    fireEvent.click(within(dialog).getByText('From streaming'))
    fireEvent.change(within(dialog).getByPlaceholderText('Song title'), { target: { value: 'Linked Song' } })
    fireEvent.change(within(dialog).getByPlaceholderText('Contributors (comma separated, optional)'), {
      target: { value: 'Ava, Max' },
    })
    // Toggle visible until a URL is present…
    expect(within(dialog).getByRole('group', { name: 'Released or unreleased' })).toBeInTheDocument()
    fireEvent.change(within(dialog).getByPlaceholderText('https://open.spotify.com/track/…'), {
      target: { value: 'https://open.spotify.com/track/ZZ9' },
    })
    // …then locked to Released.
    expect(within(dialog).queryByRole('group', { name: 'Released or unreleased' })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/Released — it's on a platform/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({
      artist_id: 'a1',
      title: 'Linked Song',
      featured_artists: ['Ava', 'Max'],
      source: 'manual',
      released: true,
      stream_url: 'https://open.spotify.com/track/ZZ9',
      spotify_id: 'ZZ9',
    })
    expect(uploads).toHaveLength(0) // no files on the streaming path
  })

  it('manual: requires the audio file, uploads cover + audio, inserts with the toggle', async () => {
    const dialog = openModal('released')
    fireEvent.click(within(dialog).getByText('Add manually'))
    fireEvent.change(within(dialog).getByPlaceholderText('Song title'), { target: { value: 'Hand Made' } })

    // Missing audio → validation error, nothing written.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }))
    expect(await within(dialog).findByText(/Attach the audio file/)).toBeInTheDocument()
    expect(inserted).toHaveLength(0)

    const drop = (label: RegExp, file: File) => {
      const zone = within(dialog).getByText(label).closest('label')!
      const input = zone.querySelector('input[type="file"]')!
      fireEvent.change(input, { target: { files: [file] } })
    }
    drop(/Drop the audio file/, new File([new Uint8Array(8)], 'demo take.mp3', { type: 'audio/mpeg' }))
    drop(/Drop the cover art/, new File([new Uint8Array(8)], 'cover.png', { type: 'image/png' }))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(uploads.map((u) => u.bucket)).toEqual(['media', 'audio']) // cover first, then audio
    expect(inserted[0]).toMatchObject({ title: 'Hand Made', source: 'manual', released: true })
    expect(String(inserted[0].audio_path)).toMatch(/^a1\/audio\/.+\.mp3$/)
    expect(String(inserted[0].cover_url)).toContain('/a1/covers/')
  })
})
