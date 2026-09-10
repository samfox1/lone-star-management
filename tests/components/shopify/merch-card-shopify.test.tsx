// @vitest-environment jsdom
// The dashboard's merch card: a Shopify product shows its name, price and link but does
//   not let you retype them, because the next pull would overwrite the edit anyway.
/**
 * THE SAME RULE THE EDITOR GOT ON 2026-09-09, NOW ON THE DASHBOARD TOO.
 *
 * `1f95083` made the EDITOR's merch panel read-only where Shopify owns the field. The
 * dashboard's own card — the one on /artists/[id]/merch, opened by clicking a tile —
 * still offered title, price, buy URL and image URL as inputs for every product. The
 * review found it (2026-09-10).
 *
 * Why an editable price here is the sharp one, in the editor's own words: nothing typed
 * here can reach Shopify, the next sync overwrites these columns, and the site prices the
 * product LIVE at render — so with the live lane down the typed price would render and
 * Shopify would still charge its own.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MerchCard, type MerchItem } from '@/app/artists/[id]/(dashboard)/merch/merch-card'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteContentAction: vi.fn(),
  updateContentAction: vi.fn(),
}))
vi.mock('@/app/artists/[id]/(dashboard)/entity-sparkline', () => ({ EntitySparkline: () => null }))

const base: MerchItem = {
  id: 'p1', title: 'Tour Tee', price: '30', url: 'https://x.myshopify.com/products/tee',
  image_url: 'https://cdn/x.png', source: 'manual', on_site: true,
}

function openCard(item: MerchItem) {
  render(<MerchCard item={item} artistId="a1" selected={false} onToggleSelect={() => {}} />)
  // The tile is the button that opens the modal; its name is its visible text.
  fireEvent.click(screen.getByRole('button', { name: /Tour Tee/ }))
}

describe('a MANUAL product — the manager owns all of it', () => {
  it('offers every field as an input', () => {
    openCard(base)
    expect(screen.getByPlaceholderText('Item name')).toBeTruthy()
    expect(screen.getByPlaceholderText('Price')).toBeTruthy()
    expect(screen.getByPlaceholderText('Buy URL')).toBeTruthy()
    expect(screen.getByPlaceholderText('Image URL')).toBeTruthy()
  })
})

describe('a SHOPIFY product — Shopify owns what Shopify sends', () => {
  const shopify: MerchItem = { ...base, source: 'shopify' }

  it('CRITICAL: title, price, URL and image are NOT inputs', () => {
    openCard(shopify)
    expect(screen.queryByPlaceholderText('Item name'), 'the title is still editable').toBeNull()
    expect(screen.queryByPlaceholderText('Price'), 'the price is still editable').toBeNull()
    expect(screen.queryByPlaceholderText('Buy URL'), 'the URL is still editable').toBeNull()
    expect(screen.queryByPlaceholderText('Image URL'), 'the image URL is still editable').toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' }), 'a Save button with nothing to save').toBeNull()
  })

  it('CRITICAL: the values are still SHOWN — read-only is not invisible', () => {
    // The manager still has to see what the product is. Hiding the fields would read as
    // the card being broken, not as Shopify owning them.
    openCard(shopify)
    expect(screen.getAllByText('Tour Tee').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$30').length).toBeGreaterThan(0)
  })

  it('says WHY, and where to change it instead', () => {
    // A control that refuses without saying so reads as broken (the editor's own rule).
    openCard(shopify)
    expect(screen.getByText(/in Shopify/i)).toBeTruthy()
  })

  it('the buy page link survives — it is the one thing worth clicking', () => {
    openCard(shopify)
    const a = screen.getByRole('link', { name: /Open buy page/ })
    expect(a.getAttribute('href')).toBe('https://x.myshopify.com/products/tee')
  })
})
