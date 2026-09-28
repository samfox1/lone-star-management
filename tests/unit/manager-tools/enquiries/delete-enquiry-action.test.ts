// Deleting an enquiry: the row goes, its audio goes with it, and "nothing matched" is not "done".
/**
 * `deleteEnquiryAction` (Sam, 2026-09-28: "a manager can delete an inquiry" — spam, mostly).
 *
 * The database is the authority on WHO may delete (the `enquiries_delete` policy,
 * 20260928140000, pinned by tests/integration/enquiries/enquiry-delete.isolation.test.ts).
 * What this file pins is what only the action does:
 *
 *   1. A delete that matched no row is an error, not a success. RLS filters a denied
 *      DELETE to zero rows and returns `error: null` (AGENTS.md rule 3).
 *   2. The audio goes too. An enquiry's attachment ROWS cascade with it, and the 90-day
 *      sweep finds objects only through those rows — so an object left behind here is
 *      never swept. Unsolicited files from strangers would sit in the bucket for good.
 *   3. The audio is NOT touched when the row was not deleted. Removing a stranger's demo
 *      from an enquiry that is still in the inbox is the worst order to get this in.
 *
 * The fake answers each table from what the test plants and records every call, so each
 * assertion lands on the action's behaviour, not on the fake's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const owns = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string })
vi.mock('@/app/artists/[id]/(dashboard)/_owns', () => ({ requireOwnedArtist: () => owns() }))

let deletedRows: { id: string }[] = []
let deleteError: { message: string } | null = null
let attachments: { storage_path: string | null }[] = []
let removeError: { message: string } | null = null
const calls: string[] = []
const removed: { bucket: string; paths: string[] }[] = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      // One chain per call. Awaiting it yields the planted rows for that table; a write
      // yields rows ONLY when `.select` asked for them, as PostgREST does.
      let op = 'select'
      let selected = false
      const chain: Record<string, unknown> = {}
      chain.delete = () => ((op = 'delete'), calls.push(`${table}.delete`), chain)
      chain.select = () => ((selected = true), chain)
      for (const m of ['eq', 'not', 'order']) {
        chain[m] = (...args: unknown[]) => (calls.push(`${table}.${m}(${args.map(String).join(',')})`), chain)
      }
      chain.then = (ok: (v: unknown) => void) => {
        if (table === 'enquiries' && op === 'delete') {
          return ok({ data: selected ? deletedRows : null, error: deleteError })
        }
        if (table === 'enquiry_attachments') return ok({ data: attachments, error: null })
        return ok({ data: [], error: null })
      }
      return chain
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths })
          return { data: null, error: removeError }
        },
      }),
    },
  })),
}))

const load = async () =>
  (await import('@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions')).deleteEnquiryAction

beforeEach(() => {
  deletedRows = []
  deleteError = null
  attachments = []
  removeError = null
  calls.length = 0
  removed.length = 0
  owns.mockResolvedValue({ ok: true })
})

describe('deleteEnquiryAction', () => {
  it('deletes the row, scoped to BOTH the enquiry and the artist', async () => {
    deletedRows = [{ id: 'e1' }]
    const res = await (await load())('a1', 'e1')

    expect(res).toEqual({ ok: true })
    expect(calls).toContain('enquiries.delete')
    expect(calls).toContain('enquiries.eq(id,e1)')
    expect(calls).toContain('enquiries.eq(artist_id,a1)')
  })

  it('CRITICAL: a delete that matched no row is an error, not a success', async () => {
    // RLS turned it away, or another tab got there first. Either way nothing was deleted.
    deletedRows = []
    const res = await (await load())('a1', 'e-gone')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('reports a refused delete', async () => {
    deleteError = { message: 'permission denied for table enquiries' }
    const res = await (await load())('a1', 'e1')
    expect(res.ok).toBe(false)
  })

  it('CRITICAL: removes the enquiry’s audio from the bucket once the row is gone', async () => {
    deletedRows = [{ id: 'e1' }]
    attachments = [
      { storage_path: 'a1/e1/one.mp3' },
      { storage_path: null }, // expired by the sweep, or never uploaded: nothing to remove
      { storage_path: 'a1/e1/two.wav' },
    ]
    await (await load())('a1', 'e1')

    expect(removed).toEqual([{ bucket: 'enquiry-attachments', paths: ['a1/e1/one.mp3', 'a1/e1/two.wav'] }])
    // The paths were read for THIS enquiry only.
    expect(calls).toContain('enquiry_attachments.eq(enquiry_id,e1)')
  })

  it('CRITICAL: leaves the audio alone when the row was NOT deleted', async () => {
    deletedRows = []
    attachments = [{ storage_path: 'a1/e1/one.mp3' }]
    await (await load())('a1', 'e1')
    expect(removed).toEqual([])
  })

  it('leaves the audio alone when the delete was refused', async () => {
    deleteError = { message: 'nope' }
    attachments = [{ storage_path: 'a1/e1/one.mp3' }]
    await (await load())('a1', 'e1')
    expect(removed).toEqual([])
  })

  it('makes no storage call when there is no audio', async () => {
    deletedRows = [{ id: 'e1' }]
    await (await load())('a1', 'e1')
    expect(removed).toEqual([])
  })

  it('still reports success when only the audio cleanup failed — the enquiry IS gone', async () => {
    deletedRows = [{ id: 'e1' }]
    attachments = [{ storage_path: 'a1/e1/one.mp3' }]
    removeError = { message: 'storage down' }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await (await load())('a1', 'e1')).toEqual({ ok: true })
    spy.mockRestore()
  })

  it('refuses a caller who does not own the artist, before touching anything', async () => {
    owns.mockResolvedValue({ ok: false, error: 'Not your artist.' })
    const res = await (await load())('a1', 'e1')
    expect(res).toEqual({ ok: false, error: 'Not your artist.' })
    expect(calls).toEqual([])
  })
})
