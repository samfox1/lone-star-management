// @vitest-environment jsdom
/**
 * SongAddButton — the Music page's "+ Add Music". Manual path asks the format
 * first (Single / EP / Album): a single is one song; an EP/album is a manual
 * RELEASE with song rows (+ Add song appends one) whose songs inherit its
 * released/unreleased choice (REQUIRED, no default). Streaming path: URL rows
 * only — metadata resolves FROM the service, automatically released.
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
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push({ __table: table, ...row })
        const id = `${table}-${inserted.length}`
        return Object.assign(Promise.resolve({ error: null }), {
          select: () => ({ single: async () => ({ data: { id }, error: null }) }),
        })
      },
      select: () => ({ eq: () => ({ like: async () => ({ data: [] }) }) }),
      delete: () => ({ in: async () => ({}), eq: async () => ({}) }),
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
  fireEvent.click(screen.getByRole('button', { name: 'Add music' }))
  return screen.getByRole('dialog')
}

const dropAudio = (dialog: HTMLElement, index = 0) => {
  const zone = within(dialog).getAllByText(/Drop the audio file/)[index].closest('label')!
  const input = zone.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(8)], `take-${index}.mp3`, { type: 'audio/mpeg' })] } })
}

describe('SongAddButton', () => {
  it('offers Add Manually and Upload from Streaming Service; manual asks the format first', () => {
    const dialog = openModal()
    expect(within(dialog).getByText('Upload from Streaming Service')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByText('Add Manually'))
    expect(within(dialog).getByText('Single')).toBeInTheDocument()
    expect(within(dialog).getByText('EP')).toBeInTheDocument()
    expect(within(dialog).getByText('Album')).toBeInTheDocument()
  })

  it('streaming: URLs only — metadata resolves from the service, released automatically', async () => {
    const dialog = openModal()
    fireEvent.click(within(dialog).getByText('Upload from Streaming Service'))
    expect(within(dialog).queryByPlaceholderText('Song title')).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('https://open.spotify.com/track/…'), {
      target: { value: 'https://open.spotify.com/track/ZZ9' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(vi.mocked(resolveStreamingSongAction)).toHaveBeenCalledWith({ spotify: 'https://open.spotify.com/track/ZZ9' })
    expect(inserted[0]).toMatchObject({
      __table: 'tracks',
      title: 'Resolved Title',
      released: true,
      spotify_id: 'ZZ9',
    })
    expect(uploads).toHaveLength(0)
  })

  it('single: one song, required released choice blocks until picked', async () => {
    const dialog = openModal()
    fireEvent.click(within(dialog).getByText('Add Manually'))
    fireEvent.click(within(dialog).getByText('Single'))
    expect(within(dialog).getByText(/Has this been released\?/)).toBeInTheDocument()
    expect(within(dialog).getByText('*')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('Song title'), { target: { value: 'Hand Made' } })
    dropAudio(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByText('Choose released or unreleased.')).toBeInTheDocument()
    expect(inserted).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'released' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ __table: 'tracks', title: 'Hand Made', released: true, release_id: null })
    expect(uploads.map((u) => u.bucket)).toEqual(['audio'])
  })

  it('EP: creates the release and its song rows (+ Add song appends one)', async () => {
    const dialog = openModal()
    fireEvent.click(within(dialog).getByText('Add Manually'))
    fireEvent.click(within(dialog).getByText('EP'))

    // EPs start with two rows; + Add song appends a third.
    expect(within(dialog).getAllByPlaceholderText('Song title')).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Add song' }))
    const titles = within(dialog).getAllByPlaceholderText('Song title')
    expect(titles).toHaveLength(3)

    fireEvent.change(within(dialog).getByPlaceholderText('EP title'), { target: { value: 'Basement Demos' } })
    titles.forEach((input, i) => fireEvent.change(input, { target: { value: `Cut ${i + 1}` } }))
    // Each drop renames its zone's label to the filename, so always hit the
    // FIRST still-empty zone.
    for (let i = 0; i < 3; i++) dropAudio(dialog, 0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'unreleased' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(inserted).toHaveLength(4)) // 1 release + 3 songs
    expect(inserted[0]).toMatchObject({
      __table: 'releases',
      title: 'Basement Demos',
      slug: 'basement-demos',
      release_type: 'ep',
      source: 'manual',
      released: false,
    })
    const songs = inserted.slice(1)
    expect(songs.map((s) => s.title)).toEqual(['Cut 1', 'Cut 2', 'Cut 3'])
    for (const s of songs) expect(s).toMatchObject({ __table: 'tracks', release_id: 'releases-1', released: false })
    expect(uploads.filter((u) => u.bucket === 'audio')).toHaveLength(3)
  })
})
