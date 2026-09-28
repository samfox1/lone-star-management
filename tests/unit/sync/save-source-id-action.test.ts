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

const load = () => import('@/app/artists/[id]/(dashboard)/actions')

beforeEach(() => {
  writes.length = 0
  vi.mocked(createClient).mockClear()
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
