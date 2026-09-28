// A Shopify connect that stops says WHERE, as a code: the OAuth callback carries it back to
//   the page in the URL, and a code is the only thing that may travel there.
/**
 * `connectOneAction` for Shopify runs three steps in order — save (`connect_shopify`), probe
 * the saved token, first pull. The typed-token window shows the error text; the OAuth
 * callback cannot put text in a URL (anyone could put words on our page that way), so the
 * result also names the step: `connect`, `probe-<reason>`, `sync`. The callback test mocks
 * this action, so the codes are pinned HERE, against the real action.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectShopifyAction, probeShopifyAction, syncShopifyAction } from '@/app/artists/[id]/(dashboard)/merch/actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  addContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/integrations', () => ({ INTEGRATIONS: [] }))
vi.mock('@/app/artists/[id]/(dashboard)/merch/actions', () => ({
  connectShopifyAction: vi.fn(async () => ({})),
  disconnectShopifyAction: vi.fn(async () => ({})),
  probeShopifyAction: vi.fn(async () => ({ ok: true, products: [] })),
  syncShopifyAction: vi.fn(async () => ({ ok: true, message: 'Merch pulled: 3 added, 0 updated' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/sync-section-action', () => ({ syncSectionAction: vi.fn(async () => ({ results: [] })) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})) }))

const connect = async () => {
  const { connectOneAction } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions')
  return connectOneAction('a1', 'shopify', { domain: 'skeen-store.myshopify.com', token: 'sf_token' })
}

beforeEach(() => vi.clearAllMocks())

describe('connectOneAction(shopify) names the step it stopped at', () => {
  it('all three steps pass: ok, no reason (the witness that the steps below are reachable)', async () => {
    const res = await connect()
    expect(res).toMatchObject({ ok: true })
    expect(res.reason).toBeUndefined()
    expect(connectShopifyAction).toHaveBeenCalledTimes(1)
    expect(syncShopifyAction).toHaveBeenCalledTimes(1)
  })

  it('the save refused → connect', async () => {
    vi.mocked(connectShopifyAction).mockResolvedValueOnce({ error: 'invalid shopify domain' })
    expect(await connect()).toMatchObject({ ok: false, reason: 'connect' })
    expect(probeShopifyAction).not.toHaveBeenCalled()
  })

  it('the saved token did not read the store → probe-<the probe’s reason>', async () => {
    vi.mocked(probeShopifyAction).mockResolvedValueOnce({ ok: false, reason: 'scope-missing', detail: 'ACCESS_DENIED' })
    expect(await connect()).toMatchObject({ ok: false, reason: 'probe-scope-missing' })
    expect(syncShopifyAction).not.toHaveBeenCalled()
  })

  it('the first pull failed → sync', async () => {
    vi.mocked(syncShopifyAction).mockResolvedValueOnce({ ok: false, error: '1 product failed to save' })
    expect(await connect()).toMatchObject({ ok: false, reason: 'sync' })
  })
})
