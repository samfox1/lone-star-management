// Renaming or deleting a kind that matched no row says so, instead of "done".
/**
 * `renameEnquiryKindAction` / `deleteEnquiryKindAction` — the zero-row case.
 *
 * AGENTS.md rule 3: an UPDATE or DELETE that RLS (or a stale id) filters to zero rows
 * returns `error: null`. Both actions used to read that as success, and the dashboard
 * then renamed or removed a kind that the database still held unchanged (review
 * 2026-09-23). The fake below answers every chain with the rows it is given, so the
 * only thing standing between "no rows" and "success" is the action's own check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/_owns', () => ({
  requireOwnedArtist: vi.fn(async () => ({ ok: true })),
}))

let rows: { id: string }[] = []
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    // Every builder step returns the chain; awaiting it yields the planted rows.
    // Like PostgREST, a write returns rows ONLY when `.select` asked for them, so an
    // action that drops `.select` sees `data: null` and must not read that as "gone".
    const chain: Record<string, unknown> = {}
    let selected = false
    for (const m of ['update', 'delete', 'eq']) chain[m] = () => chain
    chain.select = () => ((selected = true), chain)
    chain.then = (ok: (v: unknown) => void) => ok({ data: selected ? rows : null, error: null })
    return { from: () => chain }
  }),
}))

const load = () => import('@/app/artists/[id]/(dashboard)/enquiries/actions')

beforeEach(() => {
  rows = []
})

describe('kind writes that matched nothing', () => {
  it('rename reports an error when no row changed', async () => {
    const { renameEnquiryKindAction } = await load()
    expect((await renameEnquiryKindAction('a1', 'k-gone', 'Press')).error).toBeTruthy()
  })

  it('delete reports an error when no row went', async () => {
    const { deleteEnquiryKindAction } = await load()
    expect((await deleteEnquiryKindAction('a1', 'k-gone')).error).toBeTruthy()
  })

  it('both succeed when the row was there', async () => {
    rows = [{ id: 'k1' }]
    const { renameEnquiryKindAction, deleteEnquiryKindAction } = await load()
    expect((await renameEnquiryKindAction('a1', 'k1', 'Press')).error).toBeUndefined()
    expect((await deleteEnquiryKindAction('a1', 'k1')).error).toBeUndefined()
  })
})
