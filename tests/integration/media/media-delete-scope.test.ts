// deleteMediaAction must refuse a delete it isn't authorized for — honestly, not silently.
/**
 * `deleteMediaAction` (actions.ts) used to be `supabase.from('media').delete().eq('id',
 * mediaId)` with NO auth or ownership check at all. RLS (`media_rw`, is_manager_of on
 * the row's real artist_id) already stops a non-manager's DELETE from touching another
 * artist's row — but a row-filtered DELETE returns `{ error: null }` with zero rows
 * matched (AGENTS.md rule 3, "row-filtered writes lie"), so the action answered `{}`
 * (success) to the caller even though nothing happened. Sam's decision (2026-09-18):
 * every server action gets an explicit ownership check, so a blocked write is
 * distinguishable from a real one.
 *
 * This exercises the REAL action against the LIVE project (mirrors
 * tests/integration/music/track-delete-gc.test.ts's pattern: swap the action's client
 * for a real signed-in session), not just the raw table op — the bug lived in the
 * action's missing check, not in RLS, which was never actually broken.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// The action builds its client from request cookies; tests swap in whichever manager's
// REAL signed-in session should be "making the call" for that case.
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => activeClient }))

import { deleteMediaAction } from '@/app/artists/[id]/(dashboard)/actions'

let artistA: string
let asA: SupabaseClient
let asB: SupabaseClient
let activeClient: unknown
const svc = serviceClient()

/** Rows this file created — the only ones its teardown removes (the project is shared
 *  and live; a blanket delete-by-artist would erase other suites' fixtures — AGENTS
 *  rule 6). */
const createdMediaIds: string[] = []

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
})

afterAll(async () => {
  if (createdMediaIds.length) await svc.from('media').delete().in('id', createdMediaIds)
})

/** A media row belonging to artist A, planted via the service client — the witness
 *  that must exist before a denial assertion means anything (AGENTS rule 2). */
async function plantMediaForA(): Promise<{ id: string; storagePath: string }> {
  const storagePath = `${artistA}/gallery/delete-scope-fixture.jpg`
  const { data, error } = await svc
    .from('media')
    .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: storagePath })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('fixture insert failed')
  createdMediaIds.push(data.id)
  return { id: data.id, storagePath }
}

describe('deleteMediaAction: a non-manager cannot delete another artist\'s media', () => {
  it('CRITICAL: manager B calling on artist A gets an honest error, and the row survives', async () => {
    const { id, storagePath } = await plantMediaForA()

    // The witness must exist first, or the "still there" assertion below is vacuous.
    const before = await svc.from('media').select('id').eq('id', id).maybeSingle()
    expect(before.data, 'fixture missing before the denied delete').not.toBeNull()

    // Manager B is signed in but manages NEITHER this row NOR artist A.
    activeClient = asB
    const res = await deleteMediaAction(id, storagePath, artistA)

    // The action must SAY it failed — not answer `{}` while quietly doing nothing.
    expect(res.error, 'an unauthorized delete must not report success').toBeTruthy()

    // AGENTS rule 3: the return value can lie about a row-filtered write; the row's
    // actual state via the service client is the only thing that can't.
    const after = await svc.from('media').select('id').eq('id', id).maybeSingle()
    expect(after.data, 'the row was deleted despite the caller not owning it').not.toBeNull()
  })

  it('the legitimate owner can still delete their own media', async () => {
    const { id, storagePath } = await plantMediaForA()
    activeClient = asA
    const res = await deleteMediaAction(id, storagePath, artistA)
    expect(res.error).toBeUndefined()
    const after = await svc.from('media').select('id').eq('id', id).maybeSingle()
    expect(after.data).toBeNull()
    // Already gone — don't let teardown try to delete it again.
    createdMediaIds.splice(createdMediaIds.indexOf(id), 1)
  })
})
