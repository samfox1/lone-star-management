// The Test connection action: it reads the token back out of Vault, the same way a real
//   pull does, so a green test cannot pass on a store the sync would fail to reach.
/**
 * WHY IT TESTS THE STORED CREDENTIAL, NOT THE TYPED ONE (Sam, 2026-09-10, choosing A).
 *
 * The obvious design is to probe the pasted domain and token before saving them, so
 * nothing broken is ever stored. It is the wrong one. The thing a manager needs to know is
 * "will the pull work", and the pull reads from VAULT through `shopify_credentials`. A
 * probe that used the pasted values would exercise a different path than the one that
 * matters, and could go green while every sync failed — the exact shape AGENTS.md names:
 * a test that renders the consumer proves nothing about the producer.
 *
 * So connect SAVES first and the probe reads back. A bad token stored is harmless: the
 * next attempt overwrites it, and Disconnect exists. A green test beside a broken sync is
 * not harmless at all.
 *
 * THE TOKEN MUST NEVER COME BACK. This action holds the highest-value secret in the system
 * for the length of one call. What it returns is rendered in a browser.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const getFirstPage = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))
vi.mock('@/lib/merch', async (orig) => ({
  ...(await orig<typeof import('@/lib/merch')>()),
  createShopifyClient: () => ({ getFirstPage, getProducts: vi.fn() }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { probeShopifyAction } = await import('@/app/artists/[id]/(dashboard)/merch/actions')

const CREDS = [{ store_domain: 'skeen.myshopify.com', token: 'shpat_supersecret' }]

beforeEach(() => {
  rpc.mockReset()
  getFirstPage.mockReset()
})

describe('probeShopifyAction', () => {
  it('CRITICAL: it reads the token through the SAME door the sync uses', () => {
    // The whole argument for design A. If this ever stopped calling `shopify_credentials`,
    // the test would be proving something other than "the sync will work".
    rpc.mockResolvedValue({ data: CREDS, error: null })
    getFirstPage.mockResolvedValue([])
    return probeShopifyAction('a1').then(() => {
      expect(rpc).toHaveBeenCalledWith('shopify_credentials', { p_artist_id: 'a1' })
    })
  })

  it('CRITICAL: the token never appears in what comes back', () => {
    // This value is serialised into a page. Asserted over the WHOLE payload rather than
    // field by field, so a token riding home on a field added later is caught too.
    rpc.mockResolvedValue({ data: CREDS, error: null })
    getFirstPage.mockResolvedValue([
      { shopify_product_id: 'gid://1', handle: 'tee', title: 'Tee', description: null,
        image_url: null, images: [], price: '30', url: null, variants: [],
        shippingEstimate: null, preorderNote: null, recordLabel: null, shippingDays: null },
    ])
    return probeShopifyAction('a1').then((r) => {
      expect(JSON.stringify(r)).not.toContain('shpat_supersecret')
    })
  })

  it('CRITICAL: products reach the manager, with the store they came from', () => {
    // Naming the domain is what makes the preview EVIDENCE. Products alone prove some
    // store answered; products plus the domain prove it was the store they typed.
    rpc.mockResolvedValue({ data: CREDS, error: null })
    getFirstPage.mockResolvedValue([
      { shopify_product_id: 'gid://1', handle: 'tee', title: 'Tour Tee', description: null,
        image_url: 'https://cdn/x.png', images: [], price: '30', url: null,
        variants: [{ id: 'v1', title: 'M', available: true, price: '30', currency: 'USD' }],
        shippingEstimate: null, preorderNote: null, recordLabel: null, shippingDays: null },
    ])
    return probeShopifyAction('a1').then((r) => {
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('unreachable')
      expect(r.products.map((p) => p.title)).toEqual(['Tour Tee'])
      expect(r.storeDomain).toBe('skeen.myshopify.com')
    })
  })

  it('CRITICAL: no store saved is `not-connected`, and Shopify is never called', () => {
    // A probe with nothing to probe must not reach the network at all — a request with an
    // empty token is a pointless round trip that comes back as a confusing 401.
    rpc.mockResolvedValue({ data: [], error: null })
    return probeShopifyAction('a1').then((r) => {
      expect(r.ok === false && r.reason).toBe('not-connected')
      expect(getFirstPage, 'it called Shopify with no credentials').not.toHaveBeenCalled()
    })
  })

  it('a failure to read the credential is reported, not mistaken for a bad token', () => {
    // Our own database being unreachable is not the artist's Shopify setup being wrong,
    // and telling them to re-paste a good token would waste their afternoon.
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    return probeShopifyAction('a1').then((r) => {
      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.reason).toBe('unknown')
      expect(r.detail).toContain('connection reset')
    })
  })

  it('CRITICAL: a probe writes nothing — no merch rows, no revalidate', () => {
    // Test connection is meant to be safe to press repeatedly. If it pulled, a manager
    // checking their setup would be importing a catalogue over and over without asking.
    rpc.mockResolvedValue({ data: CREDS, error: null })
    getFirstPage.mockResolvedValue([])
    return probeShopifyAction('a1').then(async () => {
      const calls = rpc.mock.calls.map((c) => c[0])
      expect(calls).toEqual(['shopify_credentials'])
      const { revalidatePath } = await import('next/cache')
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })
})
