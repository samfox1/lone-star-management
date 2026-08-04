/**
 * The Brand actions' purpose allowlist.
 *
 * `setBrandAssetAction` takes `purpose` straight off the client. Its guard exists so the
 * action is not a general-purpose writer for ANY media purpose — the write underneath is
 * a DELETE by (artist_id, purpose) followed by an insert, so an unchecked purpose would
 * hand a caller a one-shot "wipe this artist's gallery" primitive.
 *
 * Nothing tested it: the component tests mock this module away, and brand-media.test.ts
 * calls the pure `setBrandAsset` underneath, bypassing the guard entirely. Deleting the
 * check failed no test.
 *
 * The second assertion is the load-bearing one. Checking only the return value would
 * still pass if a future refactor validated AFTER the write — the DELETE would already
 * have happened. So this asserts the write was never reached.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setBrandAsset } from '@/lib/brand'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// The actions now do an RLS-scoped ownership read before writing. `visible` flips it so
// the non-owner path can be exercised.
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
vi.mock('@/lib/brand', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/brand')>()),
  setBrandAsset: vi.fn(async () => ({ ok: true })),
  saveFraming: vi.fn(async () => ({ ok: true })),
}))

const mockedWrite = vi.mocked(setBrandAsset)

beforeEach(() => {
  mockedWrite.mockClear()
  visible = true
})

describe('setBrandAssetAction — purpose allowlist', () => {
  it('accepts the three brand purposes', async () => {
    const { setBrandAssetAction } = await import('@/app/artists/[id]/(dashboard)/brand/actions')
    for (const ok of ['logo_primary', 'logo_secondary', 'favicon']) {
      expect((await setBrandAssetAction('a1', ok, 'a1/brand/x.png')).error).toBeUndefined()
    }
    expect(mockedWrite).toHaveBeenCalledTimes(3)
  })

  it('CRITICAL: refuses a media purpose that is not a brand asset', async () => {
    const { setBrandAssetAction } = await import('@/app/artists/[id]/(dashboard)/brand/actions')
    // gallery_image is the dangerous one: the write vacates by (artist_id, purpose), so
    // accepting it would delete every gallery photo the artist has.
    for (const bad of ['gallery_image', 'hero_video', 'profile_photo', 'bio_video']) {
      expect((await setBrandAssetAction('a1', bad, 'a1/brand/x.png')).error).toBe('Unknown brand asset.')
    }
    expect(mockedWrite).not.toHaveBeenCalled()
  })

  it('CRITICAL: refuses junk, and never reaches the write', async () => {
    const { setBrandAssetAction } = await import('@/app/artists/[id]/(dashboard)/brand/actions')
    for (const bad of ['', 'FAVICON', 'favicon ', 'logo', '*', 'favicon; drop']) {
      expect((await setBrandAssetAction('a1', bad, 'a1/brand/x.png')).error).toBe('Unknown brand asset.')
    }
    expect(mockedWrite).not.toHaveBeenCalled()
  })

  it('rejects BEFORE the write, not after — order is the whole guarantee', async () => {
    const { setBrandAssetAction } = await import('@/app/artists/[id]/(dashboard)/brand/actions')
    await setBrandAssetAction('a1', 'gallery_image', null)
    // A clear (null path) is pure DELETE. If validation moved after the write, this call
    // would have wiped the gallery and still returned an error.
    expect(mockedWrite).not.toHaveBeenCalled()
  })
})

describe('ownership guard — a blocked write must not look like a success', () => {
  it('CRITICAL: a caller who cannot see the artist gets an error, not {}', async () => {
    // RLS already blocks the write, but a row-filtered UPDATE/DELETE matches zero rows and
    // returns no error — so without this guard an authorization failure was indistinguishable
    // from success, and would hide an RLS regression completely.
    const { setBrandAssetAction, saveFramingAction } = await import(
      '@/app/artists/[id]/(dashboard)/brand/actions'
    )
    visible = false
    expect((await setBrandAssetAction('a1', 'favicon', null)).error).toBe('Not found.')
    expect((await saveFramingAction('a1', { zoom: 2, offsetY: 0 })).error).toBe('Not found.')
  })

  it('CRITICAL: the guard runs BEFORE the write', async () => {
    const { setBrandAssetAction } = await import('@/app/artists/[id]/(dashboard)/brand/actions')
    visible = false
    await setBrandAssetAction('a1', 'logo_primary', null)
    expect(mockedWrite).not.toHaveBeenCalled()
  })
})
