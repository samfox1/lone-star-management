/**
 * Saving or deleting a kind that matched no row says so, instead of "done".
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/actions.ts
 *           (saveEnquiryKindAction, deleteEnquiryKindAction), through saveEnquiryKind
 *           (src/lib/enquiries/kind-save.ts)
 * Feature:  Settings › Email: a kind's name, description and delete
 * Tier:     STRICT (AGENTS.md "Test depth"): a write that silently did nothing. AGENTS.md rule 3:
 *           an UPDATE or DELETE that RLS (or a stale id) filters to zero rows returns
 *           `error: null`. Both actions used to read that as success, and the dashboard then
 *           saved or removed a kind the database still held unchanged (review 2026-09-23).
 * Covers:   • save and delete report an error when no row matched; both succeed when it did
 *           • a save writes only the checked fields and returns what it stored
 *           • a bad description is refused before it reaches the database
 * Not here: that the write really is row-filtered for another artist (against the database:
 *           tests/integration/enquiries/enquiry-kind-description.test.ts).
 * Fixtures: the ownership gate and next/cache are mocked; a fake client answers every chain with
 *           the rows it is given, and rows only when `.select` asked for them (like PostgREST), so
 *           the only thing standing between "no rows" and "success" is the action's own check.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/_owns', () => ({
  requireOwnedArtist: vi.fn(async () => ({ ok: true })),
}))

let rows: { id: string }[] = []
/** Every `.update(…)` payload the actions sent: empty when a refusal stopped them first. */
let updates: unknown[] = []
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    // Every builder step returns the chain; awaiting it yields the planted rows.
    // Like PostgREST, a write returns rows ONLY when `.select` asked for them, so an
    // action that drops `.select` sees `data: null` and must not read that as "gone".
    const chain: Record<string, unknown> = {}
    let selected = false
    for (const m of ['delete', 'eq']) chain[m] = () => chain
    chain.update = (payload: unknown) => (updates.push(payload), chain)
    chain.select = () => ((selected = true), chain)
    chain.then = (ok: (v: unknown) => void) => ok({ data: selected ? rows : null, error: null })
    return { from: () => chain }
  }),
}))

const load = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/actions')

beforeEach(() => {
  rows = []
  updates = []
})

describe('kind writes that matched nothing', () => {
  // A save that changed no row is an error, not "saved".
  it('save reports an error when no row changed', async () => {
    const { saveEnquiryKindAction } = await load()
    const res = await saveEnquiryKindAction('a1', 'k-gone', { label: 'Press', description: 'For radio' })
    expect(res.error).toBeTruthy()
    expect(res.saved).toBeUndefined()
  })

  // A delete that removed no row is an error, not "deleted".
  it('delete reports an error when no row went', async () => {
    const { deleteEnquiryKindAction } = await load()
    expect((await deleteEnquiryKindAction('a1', 'k-gone')).error).toBeTruthy()
  })

  // With the row there, both succeed: the check is not simply always failing.
  it('both succeed when the row was there', async () => {
    rows = [{ id: 'k1' }]
    const { saveEnquiryKindAction, deleteEnquiryKindAction } = await load()
    expect((await saveEnquiryKindAction('a1', 'k1', { label: 'Press' })).error).toBeUndefined()
    expect((await deleteEnquiryKindAction('a1', 'k1')).error).toBeUndefined()
  })
})

describe('saving a kind’s name and description', () => {
  // Only the fields sent are written, trimmed, and the stored values come back.
  it('writes the checked fields only, and returns what it stored', async () => {
    rows = [{ id: 'k1' }]
    const { saveEnquiryKindAction } = await load()
    expect(await saveEnquiryKindAction('a1', 'k1', { description: '  For radio  ' })).toEqual({ saved: { description: 'For radio' } })
    expect(updates).toEqual([{ description: 'For radio' }])
  })

  // The action is callable with anything, so it checks the description itself.
  it('refuses a bad description BEFORE it reaches the database', async () => {
    // The action is callable with anything, not only from the dashboard's own field.
    rows = [{ id: 'k1' }]
    const { saveEnquiryKindAction } = await load()
    expect((await saveEnquiryKindAction('a1', 'k1', { description: 'For\nshows' })).error).toMatch(/one line/)
    expect((await saveEnquiryKindAction('a1', 'k1', { description: 'x'.repeat(121) })).error).toMatch(/120/)
    expect(updates).toEqual([])
  })
})
