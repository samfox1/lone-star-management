// @vitest-environment jsdom
// The dashboard's merch modal on the modal kit: a manual product's rows save one field each;
//   a Shopify product shows its name, price, link and image but does not let you retype them.
/**
 * MerchCard on modal-kit (prototype G, Sam, 2026-09-11), keeping THE SAME RULE THE EDITOR
 * GOT ON 2026-09-09 (1f95083): read-only where Shopify owns the field.
 *
 * Why an editable price is the sharp one, in the editor's own words: nothing typed here
 * can reach Shopify, the next sync overwrites these columns, and the site prices the
 * product LIVE at render — so with the live lane down the typed price would render and
 * Shopify would still charge its own.
 *
 * What is pinned:
 *   - a manual product: Title / Price / Link / Image rows turn into inputs and each saves
 *     ITS field alone through updateContentAction('merch');
 *   - a Shopify product: those four rows never become inputs, the values are still shown,
 *     a Source row says they are edited in Shopify, the buy page still opens;
 *   - Stock is the manager's on every product (the sync never writes it) and saves as a
 *     boolean string the action understands;
 *   - no Save button anywhere; Done, Delete, Analytics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MerchCard, type MerchItem } from '@/app/artists/[id]/(dashboard)/merch/merch-card'
import { updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteContentAction: vi.fn(),
  updateContentAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const base: MerchItem = {
  id: 'p1', title: 'Tour Tee', price: '30', url: 'https://x.myshopify.com/products/tee',
  image_url: 'https://cdn/x.png', source: 'manual', on_site: true, in_stock: true,
}

function openCard(item: MerchItem) {
  render(<MerchCard item={item} artistId="a1" selected={false} onToggleSelect={() => {}} />)
  // The tile is the button that opens the modal; its name is its visible text.
  fireEvent.click(screen.getByRole('button', { name: /Tour Tee/ }))
  return screen.getByRole('dialog', { name: 'Tour Tee' })
}

/** The row carrying this label (the label span's row box). */
function rowOf(scope: HTMLElement, label: string): HTMLElement {
  const lab = within(scope).getAllByText(label, { selector: 'span' }).find((el) => el.closest('.group'))!
  return lab.closest('.group') as HTMLElement
}

describe('a MANUAL product — the manager owns all of it', () => {
  it('every row turns into an input and saves its own field', async () => {
    const dialog = openCard(base)
    fireEvent.click(within(rowOf(dialog, 'Price')).getByRole('button'))
    const input = within(dialog).getByLabelText('Price')
    fireEvent.change(input, { target: { value: '35' } })
    fireEvent.blur(input)
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const [type, id, artistId, fd] = vi.mocked(updateContentAction).mock.calls[0]
    expect([type, id, artistId]).toEqual(['merch', 'p1', 'a1'])
    expect([...(fd as FormData).keys()]).toEqual(['price'])
    expect((fd as FormData).get('price')).toBe('35')
    for (const label of ['Title', 'Link', 'Image']) expect(within(rowOf(dialog, label)).getByRole('button')).toBeInTheDocument()
  })

  it('Stock is a choice that saves as a boolean the action understands', async () => {
    const dialog = openCard(base)
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Stock' }))
    fireEvent.click(within(dialog).getByRole('option', { name: 'Sold out' }))
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const fd = vi.mocked(updateContentAction).mock.calls[0][3] as FormData
    expect([...fd.keys()]).toEqual(['in_stock'])
    expect(fd.get('in_stock')).toBe('false')
  })

  it('has no Save button; Done, Delete and Analytics are there', () => {
    const dialog = openCard(base)
    expect(within(dialog).queryByRole('button', { name: /^Save$/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Delete/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/artists/a1')
  })
})

describe('a SHOPIFY product — Shopify owns what Shopify sends', () => {
  const shopify: MerchItem = { ...base, source: 'shopify' }

  it('CRITICAL: title, price, link and image never become inputs', () => {
    const dialog = openCard(shopify)
    for (const label of ['Title', 'Price', 'Link', 'Image']) {
      const row = rowOf(dialog, label)
      expect(within(row).queryByRole('button'), `${label} is still editable`).toBeNull()
      fireEvent.click(within(row).getAllByText(/./, { selector: 'span' }).at(-1)!)
    }
    expect(within(dialog).queryByRole('textbox'), 'a click opened an input').toBeNull()
    expect(within(dialog).queryByRole('button', { name: /^Save$/ })).toBeNull()
  })

  it('CRITICAL: the values are still SHOWN — read-only is not invisible', () => {
    // The manager still has to see what the product is. Hiding the fields would read as
    // the card being broken, not as Shopify owning them.
    const dialog = openCard(shopify)
    expect(within(dialog).getAllByText('Tour Tee').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('$30')).toBeInTheDocument()
    expect(within(dialog).getByText('https://x.myshopify.com/products/tee')).toBeInTheDocument()
  })

  it('says WHY, and where to change it instead', () => {
    // A control that refuses without saying so reads as broken (the editor's own rule).
    const dialog = openCard(shopify)
    expect(within(dialog).getByText(/in Shopify/i)).toBeInTheDocument()
  })

  it('the buy page link survives — it is the one thing worth clicking', () => {
    const dialog = openCard(shopify)
    expect(within(dialog).getByRole('link', { name: /Open buy page/ })).toHaveAttribute('href', 'https://x.myshopify.com/products/tee')
  })

  it('Stock stays the manager’s even here', () => {
    const dialog = openCard(shopify)
    expect(within(dialog).getByRole('combobox', { name: 'Stock' })).toBeInTheDocument()
  })
})
