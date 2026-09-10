// The Test connection probe: it reads one page from the store and says WHICH thing is
//   wrong when nothing comes back, because each cause has a different fix.
/**
 * WHY A PROBE AND NOT A TICK (MERCH_PLAN step 7).
 *
 * Connecting a store is the one step an artist's team does alone, and every way it can go
 * wrong looks identical from the dashboard: no products. A boolean "connected ✓" is worse
 * than nothing here — it is confidently wrong in four different ways.
 *
 * THE ONE THAT WILL ACTUALLY BITE is the last: a store full of products answers with an
 * EMPTY LIST when those products are not published to the sales channel the token belongs
 * to. That is not an error. Shopify returns 200 and `[]`, exactly as a genuinely empty
 * store does, and the API cannot tell them apart — so the probe must not guess. It reports
 * "connected, nothing published to this channel" and names both possibilities, because a
 * wrong guess sends someone to fix a store that was never broken.
 *
 * REACHING THE API IS THE PROOF. An empty list is `ok: true`: the domain resolved, the
 * token authenticated, the scope allowed the query. Modelling empty as a failure would
 * mean a brand-new store reads as broken.
 */
import { describe, expect, it, vi } from 'vitest'
import { probeShopify, probeAdvice, previewFlags, PROBE_FAILURES } from '@/lib/merch/probe'
import { ShopifyApiError } from '@/lib/merch/shopify'
import type { ShopifyMerch } from '@/lib/merch'

const product = (over: Partial<ShopifyMerch> = {}): ShopifyMerch => ({
  shopify_product_id: 'gid://shopify/Product/1',
  handle: 'tour-tee',
  title: 'Tour Tee',
  description: null,
  image_url: 'https://cdn.example/tee.png',
  images: [],
  price: '30.00',
  url: null,
  variants: [{ id: 'gid://shopify/ProductVariant/1', title: 'M', available: true, price: '30.00', currency: 'USD' }],
  shippingEstimate: null,
  preorderNote: null,
  recordLabel: null,
  shippingDays: null,
  ...over,
})

describe('probeShopify — what came back, or which door is shut', () => {
  it('CRITICAL: products come back as a preview, not just a count', () => {
    // The whole point of the step. "Connected" is a claim; the artist's own Tour Tee on
    // screen is evidence, and it is the only thing that proves the token reaches the
    // store THEY meant rather than some other store that also authenticates.
    return probeShopify(async () => [product(), product({ shopify_product_id: 'gid://shopify/Product/2', title: 'LP' })])
      .then((r) => {
        expect(r.ok).toBe(true)
        if (!r.ok) throw new Error('unreachable')
        expect(r.products.map((p) => p.title)).toEqual(['Tour Tee', 'LP'])
      })
  })

  it('CRITICAL: an EMPTY store is connected, not broken', () => {
    // A store with nothing published to this sales channel answers 200 with []. So does a
    // brand-new store. Both are successfully connected; treating either as an error would
    // send someone hunting a fault that is not there.
    return probeShopify(async () => []).then((r) => {
      expect(r.ok, 'an empty catalogue was reported as a failure').toBe(true)
      if (!r.ok) throw new Error('unreachable')
      expect(r.products).toEqual([])
    })
  })

  it('CRITICAL: a bad token is not reported as an empty store', () => {
    // The distinction the whole file exists for. Both end with nothing on screen; only one
    // is fixed by pasting a new token.
    return probeShopify(async () => { throw new ShopifyApiError('Shopify API error 401 for x.myshopify.com', 401) })
      .then((r) => {
        expect(r.ok).toBe(false)
        if (r.ok) throw new Error('unreachable')
        expect(r.reason).toBe('bad-token')
      })
  })

  it('CRITICAL: a wrong store domain and a missing scope are told apart', () => {
    // Different fixes: retype the domain, versus go back into Shopify and tick a scope.
    // A single "could not connect" would send the reader down the wrong one half the time.
    return Promise.all([
      probeShopify(async () => { throw new ShopifyApiError('Shopify API error 404 for nope.myshopify.com', 404) }),
      probeShopify(async () => { throw new ShopifyApiError('Shopify GraphQL error: access denied', undefined, 'ACCESS_DENIED') }),
      probeShopify(async () => { throw new Error('Invalid Shopify store domain: "my-store.com"') }),
    ]).then(([notFound, scope, domain]) => {
      expect(notFound.ok === false && notFound.reason).toBe('store-not-found')
      expect(scope.ok === false && scope.reason).toBe('scope-missing')
      expect(domain.ok === false && domain.reason).toBe('bad-domain')
    })
  })

  it('a store with no credentials saved is its own reason', () => {
    return probeShopify(async () => { throw new Error('Shopify store not configured (missing domain or token).') })
      .then((r) => expect(r.ok === false && r.reason).toBe('not-connected'))
  })

  it('a throttle that outlasts its retries is not a bad token', () => {
    // Retrying later fixes it. Telling someone to re-paste a working token does not.
    return probeShopify(async () => { throw new ShopifyApiError('Shopify API rate-limited after 3 retries: x.myshopify.com') })
      .then((r) => expect(r.ok === false && r.reason).toBe('rate-limited'))
  })

  it('CRITICAL: 403 is a bad token too, not just 401', () => {
    // Shopify answers 401 for a token it does not recognise and 403 for one it recognises
    // and refuses. Same fix, and testing only 401 left the second half of the condition
    // unwatched — Stryker deleted it and nothing noticed.
    return probeShopify(async () => { throw new ShopifyApiError('Shopify API error 403 for x.myshopify.com', 403) })
      .then((r) => expect(r.ok === false && r.reason).toBe('bad-token'))
  })

  it('CRITICAL: only OUR typed error is trusted to carry a status', () => {
    // `instanceof ShopifyApiError` is the gate, and without this nothing pinned it: a
    // random thrown object with a `status` of 404 on it — a fetch failure, a library's own
    // error shape — must NOT be read as "no store at that address". It is a wrong,
    // confident answer that sends someone to retype a domain that was always correct.
    const impostor = Object.assign(new Error('upstream proxy failed'), { status: 404, code: 'ACCESS_DENIED' })
    return probeShopify(async () => { throw impostor }).then((r) => {
      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.reason, 'a foreign error was trusted to name the failure').toBe('unknown')
    })
  })

  it('an unrecognised failure is `unknown`, and carries its message', () => {
    // Never swallowed. An unclassified error with its text on screen is still actionable;
    // a generic "something went wrong" is not, and hides the one clue there was.
    return probeShopify(async () => { throw new Error('socket hang up') }).then((r) => {
      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.reason).toBe('unknown')
      expect(r.detail).toContain('socket hang up')
    })
  })

  it('CRITICAL: the probe reads ONE page, not the whole catalogue', () => {
    // Proving a token works must not drag 500 products over the wire. The caller passes a
    // single-page reader; this pins that the probe calls it exactly once and never loops.
    const read = vi.fn(async () => [product()])
    return probeShopify(read).then(() => expect(read).toHaveBeenCalledTimes(1))
  })
})

describe('previewFlags — the one thing a preview must flag', () => {
  it('CRITICAL: a product WITH variants is buyable, one without is not', () => {
    // Both directions. Only asserting the warning meant `buyable` could be hard-coded false
    // and every test still passed — Stryker did exactly that and survived, which would put
    // "can't be bought" under every product in a perfectly healthy store.
    expect(previewFlags(product()).buyable).toBe(true)
    expect(previewFlags(product({ variants: [] })).buyable).toBe(false)
  })
})

describe('probeAdvice — every failure says what to do about it', () => {
  it('CRITICAL: every reason in the registry has advice, derived not hand-listed', () => {
    // AGENTS.md rule 4. A reason added to the union without a sentence here would reach a
    // manager as a blank panel, and a hand-written list would silently omit it.
    for (const reason of PROBE_FAILURES) {
      const advice = probeAdvice(reason)
      expect(advice.title, `${reason} has no title`).toBeTruthy()
      expect(advice.fix, `${reason} does not say what to do`).toBeTruthy()
    }
  })

  it('the scope advice names the actual scope to tick', () => {
    // The single most useful string in this feature: it is buried three screens deep in
    // Shopify's admin and is impossible to guess.
    expect(probeAdvice('scope-missing').fix).toContain('unauthenticated_read_product_listings')
  })

  it('no two reasons share a title', () => {
    // Two doors that read identically are one door as far as the reader is concerned,
    // which puts us back at "could not connect".
    const titles = PROBE_FAILURES.map((r) => probeAdvice(r).title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
