// @vitest-environment jsdom
/**
 * SongAddButton — the Music page's single + button. Manual path: title,
 * contributors, cover, the audio file, and a REQUIRED released/unreleased
 * choice (no default — you must pick). Streaming path: URL rows only — title/
 * cover/contributors resolve FROM the service, and the song is automatically
 * released. Uploads/inserts run through a mocked supabase client.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SongAddButton, parseContributors } from '@/app/artists/[id]/(dashboard)/music/song-add'
import { resolveStreamingSongAction } from '@/app/artists/[id]/(dashboard)/actions'

const inserted: Record<string, unknown>[] = []
const uploads: { bucket: string; path: string }[] = []

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  resolveStreamingSongAction: vi.fn(async () => ({
    ok: true as const,
    song: { title: 'Resolved Title', cover_url: 'https://cdn/c.jpg', contributors: ['Guest'] },
  })),
}))
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

describe('parseContributors', () => {
  it('splits on commas and trims', () => {
    expect(parseContributors(' A, B feat. C ,,')).toEqual(['A', 'B feat. C'])
  })
})

function openModal() {
  render(<SongAddButton artistId="a1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Add song' }))
  return screen.getByRole('dialog')
}

describe('SongAddButton', () => {
  it('offers Add Manually and Upload from Streaming Service', () => {
    const dialog = openModal()
    expect(within(dialog).getByText('Add Manually')).toBeInTheDocument()
    expect(within(dialog).getByText('Upload from Streaming Service')).toBeInTheDocument()
  })

  it('streaming: URLs only — metadata resolves from the service, released automatically', async () => {
    const dialog = openModal()
    fireEvent.click(within(dialog).getByText('Upload from Streaming Service'))

    // Nothing to type but links: no title/contributors inputs on this path.
    expect(within(dialog).queryByPlaceholderText('Song title')).not.toBeInTheDocument()
    expect(within(dialog).queryByPlaceholderText(/Contributors/)).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('https://open.spotify.com/track/…'), {
      target: { value: 'https://open.spotify.com/track/ZZ9' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }))

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(vi.mocked(resolveStreamingSongAction)).toHaveBeenCalledWith({ spotify: 'https://open.spotify.com/track/ZZ9' })
    expect(inserted[0]).toMatchObject({
      artist_id: 'a1',
      title: 'Resolved Title',
      cover_url: 'https://cdn/c.jpg',
      featured_artists: ['Guest'],
      source: 'manual',
      released: true,
      stream_url: 'https://open.spotify.com/track/ZZ9',
      spotify_id: 'ZZ9',
    })
    expect(uploads).toHaveLength(0)
  })

  it('manual: released/unreleased is REQUIRED — no default, submit blocks until chosen', async () => {
    const dialog = openModal()
    fireEvent.click(within(dialog).getByText('Add Manually'))
    // The requirement is explained and marked.
    expect(within(dialog).getByText(/Has this song been released\?/)).toBeInTheDocument()
    expect(within(dialog).getByText('*')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'released' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByRole('button', { name: 'unreleased' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.change(within(dialog).getByPlaceholderText('Song title'), { target: { value: 'Hand Made' } })
    const drop = (label: RegExp, file: File) => {
      const zone = within(dialog).getByText(label).closest('label')!
      const input = zone.querySelector('input[type="file"]')!
      fireEvent.change(input, { target: { files: [file] } })
    }
    drop(/Drop the audio file/, new File([new Uint8Array(8)], 'demo.mp3', { type: 'audio/mpeg' }))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }))
    expect(await within(dialog).findByText('Choose released or unreleased.')).toBeInTheDocument()
    expect(inserted).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'released' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ title: 'Hand Made', source: 'manual', released: true })
    expect(uploads.map((u) => u.bucket)).toEqual(['audio'])
  })
})
