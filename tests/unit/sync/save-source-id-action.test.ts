// saveSourceIdAction (dashboard/actions.ts) is the ONE door both Connections paths
// write a source id through: `connectSource` (connections/actions.ts, the "+ Connect"
// flow) and the per-connection edit field's `saveId` (connection-modal.tsx) both call
// it directly with whatever the manager typed.
//
// For every source except Drive that's a bare id/handle and belongs verbatim in the
// column. Drive is different: its placeholder says "Google Drive folder link," and a
// manager who pastes a share URL (the thing the placeholder asks for) got the RAW LINK
// written to `drive_folder_id` — nothing at this door ever called `parseDriveFolderId`.
// The link then fails later at Check/import with a misleading "not shared" error that
// doesn't explain the real cause (found in a docs review, 2026-09-28).
//
// This must normalise (or refuse) at the door itself, because both UI call sites — and
// any future one — go through it; fixing one call site and not the other would leave
// the bug alive on whichever path wasn't touched.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@/lib/supabase/server'

const ARTIST = 'a1'
const FOLDER = '1AbC_dEfGhIjKlMnOpQrS'

/** Every `update()` the action reached, so a refusal can be proven to write nothing. */
const writes: { table: string; patch: Record<string, unknown> }[] = []

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: () => {
          writes.push({ table, patch })
          const done = Promise.resolve({ error: null })
          return Object.assign(done, {
            select: () => ({ single: async () => ({ data: { id: ARTIST }, error: null }) }),
          })
        },
      }),
    }),
  })),
}))

// The YouTube resolver calls the Data API for a handle; its own tests cover that
// (youtube-resolve.test.ts). Here only the WIRING is under test.
const resolveYouTubeChannelId = vi.fn()
vi.mock('@/lib/youtube', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/youtube')>()),
  resolveYouTubeChannelId: (...args: unknown[]) => resolveYouTubeChannelId(...args),
}))

const load = () => import('@/app/artists/[id]/(dashboard)/actions')

beforeEach(() => {
  writes.length = 0
  vi.mocked(createClient).mockClear()
  resolveYouTubeChannelId.mockReset()
})

describe('saveSourceIdAction: drive_folder_id normalises a pasted link', () => {
  it('a share link saves the bare id, never the link', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'drive_folder_id', `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`)
    expect(res.error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { drive_folder_id: FOLDER } }])
  })

  it('an open?id= link saves the bare id', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'drive_folder_id', `https://drive.google.com/open?id=${FOLDER}`)
    expect(res.error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { drive_folder_id: FOLDER } }])
  })

  it('a bare id saves unchanged', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'drive_folder_id', FOLDER)
    expect(res.error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { drive_folder_id: FOLDER } }])
  })

  it('CRITICAL: junk is refused in plain words, and nothing is written', async () => {
    const { saveSourceIdAction } = await load()
    for (const bad of ['https://evil.example.com/folders/x', "abc' or '1'='1", 'https://drive.google.com/', 'short']) {
      const res = await saveSourceIdAction(ARTIST, 'drive_folder_id', bad)
      expect(res.error).toBe("That doesn't look like a Google Drive folder link.")
    }
    expect(writes).toEqual([])
  })

  it('a blank value still clears the link (writes NULL)', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'drive_folder_id', '   ')
    expect(res.error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { drive_folder_id: null } }])
  })
})

describe('saveSourceIdAction: every other id field is saved exactly as before', () => {
  it('spotify_artist_id is saved verbatim, no parsing applied', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'spotify_artist_id', '26K')
    expect(res.error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { spotify_artist_id: '26K' } }])
  })

  it('a Drive-style link in a non-drive field is saved verbatim (no cross-field parsing)', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'bandsintown_name', 'https://drive.google.com/drive/folders/x')
    expect(res.error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { bandsintown_name: 'https://drive.google.com/drive/folders/x' } }])
  })

  it('an unknown column is still refused', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'not_a_real_column', 'x')
    expect(res.error).toBe('Unknown source.')
    expect(writes).toEqual([])
  })
})

describe('saveSourceIdAction: ticketmaster_attraction_id takes the ID or the artist page link', () => {
  it('CRITICAL: a pasted artist page link saves the attraction id', async () => {
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'ticketmaster_attraction_id', 'https://www.ticketmaster.com/skeen-tickets/artist/K8vZ917_szV7?src=share')
    expect(res.error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { ticketmaster_attraction_id: 'K8vZ917_szV7' } }])
  })

  it('a bare id saves as it is; junk is refused and writes nothing', async () => {
    const { saveSourceIdAction } = await load()
    expect((await saveSourceIdAction(ARTIST, 'ticketmaster_attraction_id', ' K8vZ917_szV7 ')).error).toBeUndefined()
    expect(writes).toEqual([{ table: 'artists', patch: { ticketmaster_attraction_id: 'K8vZ917_szV7' } }])
    writes.length = 0
    const res = await saveSourceIdAction(ARTIST, 'ticketmaster_attraction_id', 'https://example.com/x')
    expect(res.error).toBe('Paste the Ticketmaster attraction ID or your artist page link.')
    expect(writes).toEqual([])
  })
})

describe('saveSourceIdAction: youtube_channel_id always saves the real channel id', () => {
  it('CRITICAL: a handle is resolved and the UC id is what lands', async () => {
    resolveYouTubeChannelId.mockResolvedValue({ id: 'UC1234567890abcdefghijkl' })
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'youtube_channel_id', 'https://youtube.com/@Sskeen')
    expect(res.error).toBeUndefined()
    expect(resolveYouTubeChannelId).toHaveBeenCalledWith('https://youtube.com/@Sskeen')
    expect(writes).toEqual([{ table: 'artists', patch: { youtube_channel_id: 'UC1234567890abcdefghijkl' } }])
  })

  it('a channel YouTube cannot find is refused and writes nothing', async () => {
    resolveYouTubeChannelId.mockResolvedValue({ error: 'Couldn’t find that YouTube channel.' })
    const { saveSourceIdAction } = await load()
    const res = await saveSourceIdAction(ARTIST, 'youtube_channel_id', '@nobody-here')
    expect(res.error).toBe('Couldn’t find that YouTube channel.')
    expect(writes).toEqual([])
  })

  it('a blank clears the field without asking YouTube', async () => {
    const { saveSourceIdAction } = await load()
    expect((await saveSourceIdAction(ARTIST, 'youtube_channel_id', '  ')).error).toBeUndefined()
    expect(resolveYouTubeChannelId).not.toHaveBeenCalled()
    expect(writes).toEqual([{ table: 'artists', patch: { youtube_channel_id: null } }]) // cleared
  })
})
