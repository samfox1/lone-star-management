// @vitest-environment jsdom
/**
 * A SHOPIFY PRODUCT IS READ-ONLY WHERE SHOPIFY OWNS IT.
 *
 * Sam, 2026-09-09: "because the merch is read only given the storefront access token, how
 * much editing can we do? Can we really edit the price in the editor? If not, the editor
 * should be restricted."
 *
 * He is right, and the panel was offering all three. For a product with a
 * `shopify_product_id`, editing title / price / link is worse than useless:
 *
 *   - the SYNC overwrites title, price, url, image, description, handle and variants on
 *     every pull (src/lib/merch/sync.ts), so the edit is reverted the next time anyone
 *     refreshes the store;
 *   - and PRICE is overridden again at render — the site resolves it live from Shopify
 *     (`applyLive`), so the typed number never reaches a visitor at all.
 *
 * The dangerous case is the second one failing open. If the live lane is down or unwired,
 * the edited price DOES render — and Shopify still charges its own. A fan reads $30 and
 * pays $40. That is a price the site invented, on a page whose next click is checkout.
 *
 * What a manager genuinely owns on a Shopify product is what Shopify does not send:
 * whether it is on the site at all, their manual "sold out" override (which the live lane
 * is deliberately not allowed to reverse), and the order of the grid. Those stay.
 *
 * A MANUALLY ADDED product has no Shopify row behind it, so the manager owns everything —
 * that half is the witness here, not a nicety.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MerchEditor } from '@/app/artists/[id]/(dashboard)/editor/merch-editor'
import { updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'
import type { EditorMerch } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => import('@tests/helpers/editor-actions'))

const updateMock = vi.mocked(updateContentAction)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const product = (over: Partial<EditorMerch>): EditorMerch => ({
  id: 'p1', title: 'Tour Tee', price: '30', url: 'https://shop.example.com/tee',
  image_url: null, onSite: true, inStock: true, fromShopify: false, ...over,
})

const open = (over: Partial<EditorMerch>) =>
  render(<MerchEditor item={product(over)} artistId="a1" onBack={vi.fn()} onRemove={vi.fn()} />)

describe('a MANUALLY added product — the manager owns all of it', () => {
  it('CRITICAL: name, price and link are editable, and they save', async () => {
    // The planted witness. Without it every denial below passes on a panel that renders
    // no inputs at all.
    open({ fromShopify: false })
    fireEvent.change(screen.getByRole('textbox', { name: 'Price' }), { target: { value: '42' } })
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalled())
    expect(screen.getByRole('textbox', { name: 'Product name' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Product link' })).toBeTruthy()
  })
})

describe('a SHOPIFY product — Shopify owns what Shopify sends', () => {
  it('CRITICAL: the price is NOT an input', () => {
    // The one that matters. An editable price here is a number the site can show and the
    // checkout will not honour.
    open({ fromShopify: true })
    expect(screen.queryByRole('textbox', { name: 'Price' }), 'the price is still editable').toBeNull()
  })

  it('CRITICAL: nor the name or the link — the sync overwrites both', () => {
    open({ fromShopify: true })
    expect(screen.queryByRole('textbox', { name: 'Product name' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Product link' })).toBeNull()
  })

  it('CRITICAL: the values are still SHOWN — read-only, not hidden', () => {
    // A manager still has to be able to see what the product is called and costs. The
    // restriction is on changing it, not on knowing it.
    open({ fromShopify: true, title: 'Tour Tee', price: '30' })
    expect(screen.getByText('Tour Tee')).toBeTruthy()
    expect(screen.getByText(/30/)).toBeTruthy()
  })

  it('CRITICAL: and it says WHY, naming Shopify', () => {
    // Otherwise the panel reads as broken. A manager who cannot change a price needs to
    // know where to go and change it.
    open({ fromShopify: true })
    expect(screen.getByText(/shopify/i)).toBeTruthy()
  })

  it('CRITICAL: the SOLD OUT override still works — the live lane may not reverse it', () => {
    // Deliberately theirs (lib/merch applyLive: "a manager's explicit sold out WINS").
    // Restricting the panel must not take away the one stock decision they do own.
    open({ fromShopify: true })
    fireEvent.click(screen.getByRole('switch', { name: 'Out of stock' }))
    return vi.waitFor(() => expect(updateMock).toHaveBeenCalled())
  })

  it('CRITICAL: `fromShopify` is DERIVED from the row, not something a caller opts into', () => {
    // Mutation found this unwatched (2026-09-09): every test above builds an EditorMerch
    // by hand, so setting the mapping to a flat `false` left them all green while every
    // real product went back to being editable. The derivation lives in an async server
    // component, so it is pinned at the source — the same shape as the route-exists and
    // safelist checks elsewhere in this repo.
    // `resolve` from the repo root: `import.meta.url` is not a file URL under this
    // runner's transform, and the path has bracketed segments a URL would escape.
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/artists/[id]/(dashboard)/editor/page.tsx'),
      'utf8',
    ).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    expect(page, 'the editor no longer derives fromShopify from the row').toMatch(
      /fromShopify:\s*Boolean\(\s*r\.shopify_product_id/,
    )
  })

  /* The `edit()` writer also refuses a synced field outright — belt and braces beside the
   * read-only markup above. NO TEST HERE REACHES IT, and that is stated rather than
   * papered over (AGENTS.md: say so rather than leaving a reassuring green): with the
   * inputs gone there is no control to fire a change on, so a test that iterated the
   * panel's textboxes asserted nothing at all. It was written that way first and Stryker
   * caught it — deleting the gate changed no result. The gate stays because the markup
   * and the writer can drift, and the markup half IS pinned above. */

  it('removing it is still offered — taking it off the site is the manager’s call', () => {
    open({ fromShopify: true })
    expect(screen.getByRole('button', { name: /remove/i })).toBeTruthy()
  })
})
