/**
 * The font actions' ownership gate.
 *
 * Each of these takes an `artistId` straight off the client. RLS is the real gate, but a
 * row-filtered UPDATE or DELETE matches zero rows and returns NO ERROR — so without
 * `callerOwns` the action answers `{}` and the UI shows a success toast for a write that
 * never happened. That is the "defaults to allow" shape: it hides nothing today and would
 * hide an RLS regression completely.
 *
 * The load-bearing assertion in each case is the second one: that the write was never
 * REACHED. Checking only the return value would still pass if a future refactor moved the
 * ownership read after the write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { removeArtistFont, setArtistFont, setFontSlot } from '@/lib/fonts'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/** Flips the RLS-scoped ownership read between "you can see this artist" and "you can't". */
let visible = true
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: 'a1' } : null }) }) }),
    }),
  })),
}))
vi.mock('@/lib/fonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/fonts')>()),
  setArtistFont: vi.fn(async () => ({ ok: true, font: { id: 'f1' } })),
  removeArtistFont: vi.fn(async () => ({ ok: true, storagePath: 'a1/fonts/x.woff2' })),
  setFontSlot: vi.fn(async () => ({ ok: true })),
}))
// The sweep talks to Storage; the actions only have to not depend on its result.
vi.mock('@/lib/storage-gc', () => ({ gcFontObjects: vi.fn(async () => {}) }))

const mockedAdd = vi.mocked(setArtistFont)
const mockedRemove = vi.mocked(removeArtistFont)
const mockedSlot = vi.mocked(setFontSlot)

const actions = () => import('@/app/artists/[id]/(dashboard)/brand/actions')

const VALID = { label: 'PP Mori', storagePath: 'a1/fonts/x.woff2', format: 'woff2' }

beforeEach(() => {
  visible = true
})

describe('the font actions refuse a caller who does not manage the artist', () => {
  it('CRITICAL: addArtistFontAction', async () => {
    visible = false
    const { addArtistFontAction } = await actions()
    expect((await addArtistFontAction('a1', VALID)).error).toBe('Not found.')
    expect(mockedAdd).not.toHaveBeenCalled()
  })

  it('CRITICAL: removeArtistFontAction', async () => {
    visible = false
    const { removeArtistFontAction } = await actions()
    expect((await removeArtistFontAction('a1', 'f1')).error).toBe('Not found.')
    expect(mockedRemove).not.toHaveBeenCalled()
  })

  it('CRITICAL: setFontSlotAction', async () => {
    visible = false
    const { setFontSlotAction } = await actions()
    expect((await setFontSlotAction('a1', 'primary', 'f1')).error).toBe('Not found.')
    expect(mockedSlot).not.toHaveBeenCalled()
  })
})

describe('a manager gets through, and a failure underneath is reported', () => {
  it('writes when the caller manages the artist', async () => {
    const { addArtistFontAction, removeArtistFontAction, setFontSlotAction } = await actions()
    expect((await addArtistFontAction('a1', VALID)).error).toBeUndefined()
    expect((await removeArtistFontAction('a1', 'f1')).error).toBeUndefined()
    expect((await setFontSlotAction('a1', 'primary', 'f1')).error).toBeUndefined()
    expect(mockedAdd).toHaveBeenCalledTimes(1)
    expect(mockedRemove).toHaveBeenCalledTimes(1)
    expect(mockedSlot).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: passes the underlying error through instead of reporting success', async () => {
    // The error text is specific ("That file location is not valid.") and the manager
    // needs it; a generic swallow leaves them retrying the same broken upload.
    mockedAdd.mockResolvedValueOnce({ ok: false, error: 'That file location is not valid.' })
    const { addArtistFontAction } = await actions()
    expect((await addArtistFontAction('a1', VALID)).error).toBe('That file location is not valid.')
  })

  it('emptying a slot (null) is a legitimate call, not a missing argument', async () => {
    const { setFontSlotAction } = await actions()
    expect((await setFontSlotAction('a1', 'primary', null)).error).toBeUndefined()
    expect(mockedSlot).toHaveBeenCalledWith(expect.anything(), 'a1', 'primary', null)
  })
})
