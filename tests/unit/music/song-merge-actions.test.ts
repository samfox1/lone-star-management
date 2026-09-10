// Merging songs refuses a caller who does not manage the artist.
/**
 * `mergeSongsAction`'s ownership guard.
 *
 * The DB tests (tests/song-merge.db.test.ts) prove RLS and the artist-scoped re-read stop
 * a cross-artist merge. Neither covers THIS layer: `callerOwns` exists because RLS
 * row-FILTERS an UPDATE/DELETE instead of rejecting it, so a non-owner's merge would
 * touch zero rows and hand back `{}` — a silent success that looks identical to a real
 * merge. Deleting the guard leaves every DB test green, which is exactly why it needs a
 * test of its own.
 *
 * The second assertion in each case is the load-bearing one: checking only the return
 * value would still pass if a refactor moved the guard AFTER the write.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mergeSongs } from '@/lib/song-merge'
import { gcDeletedAudioObject } from '@/lib/storage-gc'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let visible = true
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: 'a1' } : null }) }),
      }),
    }),
  })),
}))
vi.mock('@/lib/song-merge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/song-merge')>()),
  mergeSongs: vi.fn(async () => ({ ok: true, orphanedAudioPath: null })),
}))
vi.mock('@/lib/storage-gc', () => ({ gcDeletedAudioObject: vi.fn(async () => undefined) }))

const mockedMerge = vi.mocked(mergeSongs)
const mockedGc = vi.mocked(gcDeletedAudioObject)
const load = () => import('@/app/artists/[id]/(dashboard)/music/actions')

beforeEach(() => {
  mockedMerge.mockClear()
  mockedGc.mockClear()
  mockedMerge.mockResolvedValue({ ok: true, orphanedAudioPath: null })
  visible = true
})

describe('mergeSongsAction — ownership guard', () => {
  it('merges for an owner', async () => {
    const { mergeSongsAction } = await load()
    expect((await mergeSongsAction('a1', 'keep', 'drop')).error).toBeUndefined()
    expect(mockedMerge).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: a non-owner gets an error, and the merge is never attempted', async () => {
    const { mergeSongsAction } = await load()
    visible = false
    expect((await mergeSongsAction('a1', 'keep', 'drop')).error).toBe('Not found.')
    expect(mockedMerge).not.toHaveBeenCalled()
  })

  it('passes the artist id through, so the merge is scoped to it', async () => {
    const { mergeSongsAction } = await load()
    await mergeSongsAction('a1', 'keep', 'drop')
    expect(mockedMerge).toHaveBeenCalledWith(expect.anything(), 'a1', 'keep', 'drop')
  })
})

describe('mergeSongsAction — refusals and storage', () => {
  it('surfaces a refusal verbatim, so the manager learns what to clear', async () => {
    const { mergeSongsAction } = await load()
    mockedMerge.mockResolvedValue({ ok: false, error: 'These songs have different Spotify links…' })
    expect((await mergeSongsAction('a1', 'keep', 'drop')).error).toBe(
      'These songs have different Spotify links…',
    )
  })

  // A refusal wrote nothing and deleted nothing, so there is no orphan — collecting on a
  // refusal would delete a live song's master.
  it('CRITICAL: never collects storage after a refusal', async () => {
    const { mergeSongsAction } = await load()
    mockedMerge.mockResolvedValue({ ok: false, error: 'nope' })
    await mergeSongsAction('a1', 'keep', 'drop')
    expect(mockedGc).not.toHaveBeenCalled()
  })

  // The audio bucket is paid storage and the duplicate's row is gone, so nothing else
  // will ever reference the object it left behind.
  it('collects the duplicate’s orphaned master, keyed to the DELETED song', async () => {
    const { mergeSongsAction } = await load()
    mockedMerge.mockResolvedValue({ ok: true, orphanedAudioPath: 'a1/audio/drop.mp3' })
    await mergeSongsAction('a1', 'keep', 'drop')
    expect(mockedGc).toHaveBeenCalledWith(expect.anything(), 'drop', 'a1/audio/drop.mp3')
  })
})
