// @vitest-environment jsdom
// The Shopify connect panel: pressing Test connection shows the artist's own products
//   back, or names which door is shut and what to do about it.
/**
 * WHAT A MANAGER SEES, WHICH IS THE HALF THE ACTION CANNOT PROVE.
 *
 * `probeShopifyAction` decides; this pins what the panel does with the decision. Three
 * things live only here:
 *
 * 1. AN EMPTY CATALOGUE IS NOT AN ERROR. The API answers 200 with `[]` both when the store
 *    is genuinely empty and when its products are not published to this token's sales
 *    channel. The panel must say "connected" and name BOTH possibilities — guessing sends
 *    someone to fix a store that was never broken, and the sales-channel case is the one
 *    that will actually happen.
 * 2. A FAILURE SHOWS ITS FIX. "Could not connect" is the answer we are replacing.
 * 3. THE PREVIEW IS EVIDENCE. Their own Tour Tee, on the near-black ground the real site
 *    uses, beside the domain it came from.
 *
 * ON THE NO-INSTRUCTION-COPY RULE (2026-08-12, extended 2026-08-28): the connected and
 * disconnected views carry NO explanatory prose. The Shopify admin steps sit behind a
 * disclosure, and the fix text appears only when a test has actually failed — that is an
 * error message, not a caption, and it exists because the step it describes happens on
 * Shopify's screens, which no design of ours can make self-evident.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ShopifyPanel } from '@/app/artists/[id]/(dashboard)/merch/shopify-panel'
import type { ShopifyMerch } from '@/lib/merch'

const tee = (over: Partial<ShopifyMerch> = {}): ShopifyMerch => ({
  shopify_product_id: 'gid://shopify/Product/1',
  handle: 'tour-tee', title: 'Tour Tee', description: null,
  image_url: 'https://cdn.example/tee.png', images: [], price: '30.00', url: null,
  variants: [{ id: 'v1', title: 'M', available: true, price: '30.00', currency: 'USD' }],
  shippingEstimate: null, preorderNote: null, recordLabel: null, shippingDays: null,
  ...over,
})

const panel = (probe: () => Promise<unknown>, storeDomain: string | null = 'skeen.myshopify.com') =>
  render(
    <ShopifyPanel
      storeDomain={storeDomain}
      connectAction={vi.fn()}
      pullAction={vi.fn()}
      disconnectAction={vi.fn()}
      probeAction={probe as never}
    />,
  )

const test_ = () => fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

/** The RESULT block, not the panel. "Connected to …" appears twice on a connected panel —
 *  once as standing state and once as this test's outcome — so an unscoped query would
 *  pass on the header and prove nothing about the probe. */
const outcome = () => within(document.querySelector('[data-probe-result]') as HTMLElement)

describe('the preview is the proof', () => {
  it('CRITICAL: the artist’s own products come back, named, with the store', () => {
    // The claim "connected" is unfalsifiable from a tick. Their own merch on screen, beside
    // the domain, is the only thing that proves the token reaches the store they meant.
    panel(async () => ({ ok: true, products: [tee(), tee({ shopify_product_id: 'g2', title: 'The LP' })], storeDomain: 'skeen.myshopify.com' }))
    test_()
    return waitFor(() => {
      expect(screen.getByText('Tour Tee')).toBeTruthy()
      expect(screen.getByText('The LP')).toBeTruthy()
      expect(outcome().getByText(/skeen\.myshopify\.com/)).toBeTruthy()
    })
  })

  it('CRITICAL: product images render on the near-black ground the real site uses', () => {
    // Not decoration. Merch renders cut out on near-black, so a product shot with a white
    // box baked in (a flat JPG, which `preferredContentType: PNG` cannot fix) shows up AS a
    // white box here. Seeing it beats any check we could write.
    panel(async () => ({ ok: true, products: [tee()], storeDomain: 'skeen.myshopify.com' }))
    test_()
    return waitFor(() => {
      const img = screen.getByAltText('Tour Tee') as HTMLImageElement
      expect(img.src).toBe('https://cdn.example/tee.png')
      expect(img.closest('[data-cutout-ground]'), 'the preview tile is not on the dark ground').toBeTruthy()
    })
  })

  it('CRITICAL: a product with no variants is flagged as unbuyable', () => {
    // It renders on the site and then refuses to sell, because a cart line is built from a
    // variant id. Silent otherwise, and only visible at the moment someone tries to buy.
    panel(async () => ({ ok: true, products: [tee({ variants: [] })], storeDomain: 'skeen.myshopify.com' }))
    test_()
    return waitFor(() => expect(screen.getByText(/can’t be bought/i)).toBeTruthy())
  })
})

describe('an empty catalogue is connected, not broken', () => {
  it('CRITICAL: it says connected, and names BOTH reasons for the empty list', () => {
    // The one that will actually bite. A store full of merch answers `[]` when nothing is
    // published to this token's sales channel — identical to a genuinely empty store, and
    // Shopify gives us no way to tell them apart. Picking one would be confidently wrong
    // half the time.
    panel(async () => ({ ok: true, products: [], storeDomain: 'skeen.myshopify.com' }))
    test_()
    return waitFor(() => {
      expect(outcome().getByText(/connected/i), 'an empty store was reported as a failure').toBeTruthy()
      expect(outcome().getByText(/sales channel/i)).toBeTruthy()
    })
  })
})

describe('a failure names its door and its fix', () => {
  it('CRITICAL: a missing scope prints the exact scope to tick', () => {
    // Buried three screens deep in Shopify's admin and impossible to guess. This one string
    // is the most useful thing in the feature.
    panel(async () => ({ ok: false, reason: 'scope-missing', detail: 'access denied', storeDomain: 'skeen.myshopify.com' }))
    test_()
    return waitFor(() => expect(screen.getByText(/unauthenticated_read_product_listings/)).toBeTruthy())
  })

  it('CRITICAL: a bad token and a wrong address do not read the same', () => {
    // Different screens fix them. One message for both puts us back where we started.
    const { unmount } = panel(async () => ({ ok: false, reason: 'bad-token', detail: '401', storeDomain: 'x.myshopify.com' }))
    test_()
    return waitFor(() => screen.getByText(/token was refused/i)).then(() => {
      unmount()
      panel(async () => ({ ok: false, reason: 'store-not-found', detail: '404', storeDomain: 'x.myshopify.com' }))
      test_()
      return waitFor(() => expect(screen.getByText(/no store at that address/i)).toBeTruthy())
    })
  })

  it('the raw message survives, so an unclassified failure is still actionable', () => {
    panel(async () => ({ ok: false, reason: 'unknown', detail: 'socket hang up', storeDomain: 'x.myshopify.com' }))
    test_()
    return waitFor(() => expect(screen.getByText(/socket hang up/)).toBeTruthy())
  })
})

describe('the panel stays quiet until it has something to say', () => {
  it('CRITICAL: no Shopify instructions are on screen by default', () => {
    // The standing rule (2026-08-12): the UI carries no explanatory prose. The admin steps
    // are reachable, not displayed — and the fix text appears only after a real failure.
    panel(async () => ({ ok: true, products: [], storeDomain: null }), null)
    expect(screen.queryByText(/unauthenticated_read_product_listings/)).toBeNull()
    expect(screen.queryByText(/Storefront API access scopes/)).toBeNull()
  })

  it('the admin steps are reachable when someone wants them', () => {
    // Not instructions on screen; instructions one click away, for the person who is
    // standing in Shopify's admin right now and cannot find the thing.
    panel(async () => ({ ok: true, products: [] }), null)
    fireEvent.click(screen.getByRole('button', { name: /where do I find/i }))
    expect(screen.getByText(/unauthenticated_read_product_listings/)).toBeTruthy()
  })

  it('CRITICAL: with no store connected there is nothing to test', () => {
    // A control that provably cannot work reads as the panel being broken (the same call
    // the Sync dialog made on 2026-09-09).
    panel(async () => ({ ok: true, products: [] }), null)
    expect(screen.queryByRole('button', { name: /test connection/i })).toBeNull()
  })
})
