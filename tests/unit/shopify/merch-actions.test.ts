/**
 * `syncShopifyAction` — the Pull merch button's server half.
 *
 * `syncShopifyMerch` returns a `SyncResult` with a per-row `errors[]`, and the action
 * threw it away (REVIEW_2026-09-03 M7). That was survivable while per-row failures were
 * unreachable; `merch_handle_uniq` (20260902120000) made them reachable. Reconnect an
 * artist to a different Shopify store while the old rows still hold the handles and
 * EVERY colliding insert fails into `errors[]` — and the manager reads "Merch pulled",
 * with nothing flagged, on a pull that imported nothing.
 *
 * `syncShopifyMerch` and the Shopify client are both mocked: the sync's real behaviour
 * is pinned against the live DB by sync.shopify.test.ts and the client by
 * shopify.test.ts. What this file pins is the ACTION's reporting — the one thing
 * neither of those can see.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncResult } from '@/lib/sync'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getProducts: vi.fn(),
  sync: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}))
vi.mock('@/lib/merch', () => ({
  createShopifyClient: () => ({ getProducts: mocks.getProducts }),
  syncShopifyMerch: mocks.sync,
}))

import { syncShopifyAction } from '@/app/artists/[id]/(dashboard)/merch/actions'

const ARTIST = 'a1'
const CREDS = [{ store_domain: 'lone-pine.myshopify.com', token: 'tok' }]

/**
 * Built from the `SyncResult` TYPE, not hand-copied from a sample: every counter is
 * named here, so a new one added to the contract is a compile error in this fixture
 * rather than a field the action silently stops reporting (AGENTS.md rule 4).
 */
function result(over: Partial<SyncResult> = {}): SyncResult {
  return { added: 0, updated: 0, skipped: 0, merged: 0, failed: 0, errors: [], ...over }
}

const COLLISION = 'duplicate key value violates unique constraint "merch_handle_uniq"'

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.getProducts.mockReset()
  mocks.sync.mockReset()
  mocks.revalidatePath.mockReset()
  mocks.rpc.mockResolvedValue({ data: CREDS, error: null })
  mocks.getProducts.mockResolvedValue([])
  mocks.sync.mockResolvedValue(result({ added: 3 }))
})

describe('syncShopifyAction reports what the sync actually did', () => {
  it('CRITICAL: per-row failures are surfaced, not reported as a clean pull', async () => {
    // The handle-collision shape: the whole pull "succeeds" and imports nothing.
    mocks.sync.mockResolvedValue(
      result({
        failed: 2,
        errors: [
          { externalId: 'gid://p1', op: 'insert', message: COLLISION },
          { externalId: 'gid://p2', op: 'insert', message: COLLISION },
        ],
      }),
    )

    const res = await syncShopifyAction(ARTIST)

    expect(res.ok).toBe(false)
    // The count, so a manager can tell one bad row from a pull that landed nothing…
    expect(res.error).toContain('2')
    // …and the reason, which is the only thing that says WHY (a handle already taken).
    expect(res.error).toContain(COLLISION)
  })

  it('a single failure among many successes is still flagged', async () => {
    mocks.sync.mockResolvedValue(
      result({
        added: 9,
        failed: 1,
        errors: [{ externalId: 'gid://p9', op: 'update', message: 'numeric field overflow' }],
      }),
    )
    const res = await syncShopifyAction(ARTIST)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('numeric field overflow')
  })

  it('still revalidates on a partial failure — the rows that landed are real', async () => {
    mocks.sync.mockResolvedValue(
      result({ added: 4, failed: 1, errors: [{ externalId: 'gid://p9', op: 'insert', message: COLLISION }] }),
    )
    await syncShopifyAction(ARTIST)
    // Returning early without this leaves the manager staring at a stale merch list
    // while the toast tells them something went wrong — two contradictory signals.
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/artists/${ARTIST}`, 'layout')
  })

  it('a clean pull says what landed instead of a fixed string', async () => {
    mocks.sync.mockResolvedValue(result({ added: 2, updated: 5, skipped: 1 }))
    const res = await syncShopifyAction(ARTIST)
    expect(res.ok).toBe(true)
    expect(res.error).toBeUndefined()
    // Counts, not "Merch pulled": a pull that skipped everything because the rows are
    // manual looks identical to one that imported the catalogue otherwise.
    const message = (res as { message?: string }).message ?? ''
    expect(message).toMatch(/2/)
    expect(message).toMatch(/5/)
  })
})

describe('the pre-existing failure paths still hold', () => {
  it('refuses when no store is connected, without calling Shopify', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const res = await syncShopifyAction(ARTIST)
    expect(res).toEqual({ ok: false, error: 'Connect a Shopify store first.' })
    expect(mocks.getProducts).not.toHaveBeenCalled()
  })

  it('surfaces a Shopify network failure and never reaches the sync', async () => {
    mocks.getProducts.mockRejectedValue(new Error('Shopify API error 401 for lone-pine.myshopify.com'))
    const res = await syncShopifyAction(ARTIST)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('401')
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('surfaces a credentials RPC error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const res = await syncShopifyAction(ARTIST)
    expect(res).toEqual({ ok: false, error: 'permission denied' })
  })
})
