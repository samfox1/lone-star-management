// @vitest-environment jsdom
// Connect with Shopify: when the app is set up, the manager types only the store address and
//   goes to Shopify; when it is not, today's domain + token fields stay exactly as they are.
/**
 * The Shopify app (Sam, 2026-09-28: "If they have their own connect portal … lets just prompt
 * that"). The page passes ONE server-made boolean, `shopifyApp` — never the key or the
 * secret. What has to hold, in both windows (Connect, and Shopify's own edit window):
 *
 *   - configured: a store-address field and a "Connect with Shopify" LINK to our install
 *     route, carrying the artist and the tidied address. No token field anywhere;
 *   - a bad address is caught before leaving: the link does not navigate, the reason shows;
 *   - Shopify is never sent through `connectOneAction` in this mode — the trip to Shopify is
 *     the connect;
 *   - not configured: today's two fields and today's buttons, unchanged;
 *   - back from Shopify, the page shows one line: the success, or the plain-words failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConnectModal } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal'
import { ConnectionModal } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-modal'
import { ShopifyReturnNotice } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/shopify-return'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'
import { connectOneAction, getShopifyDomainAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { connectionByKey, type ConnectionRow } from '@/lib/connections'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishEntityAction: vi.fn(async () => ({ ok: true })),
  updateContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true, message: 'found' })),
  getShopifyDomainAction: vi.fn(async () => 'skeen-store.myshopify.com'),
  disconnectConnectionAction: vi.fn(async () => ({})),
  pullConnectionAction: vi.fn(async () => ({ ok: true })),
  syncProfileAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const INSTALL = '/api/shopify/install?artist=a1&shop=skeen-store.myshopify.com'

/** Click a link and report whether the browser would have followed it. */
function clickFollows(link: HTMLElement): boolean {
  let prevented = true
  const spy = (e: Event) => {
    prevented = e.defaultPrevented
    e.preventDefault() // jsdom cannot navigate; stop it trying once we've read the verdict
  }
  document.addEventListener('click', spy)
  fireEvent.click(link)
  document.removeEventListener('click', spy)
  return !prevented
}

function openConnect(shopifyApp?: boolean) {
  render(<ConnectModal artistId="a1" taken={[]} onClose={vi.fn()} onDone={vi.fn()} shopifyApp={shopifyApp} />)
  return screen.getByRole('dialog', { name: 'Connect' })
}

function pick(dialog: HTMLElement, ...names: string[]) {
  for (const n of names) fireEvent.click(within(dialog).getByRole('button', { name: n }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
}

describe('the Connect window', () => {
  it('CRITICAL: configured — the store address alone, and Connect with Shopify goes to the install route', () => {
    const dialog = openConnect(true)
    pick(dialog, 'Shopify')
    const domain = within(dialog).getByRole('textbox', { name: 'Shopify store domain' })
    expect(within(dialog).queryByLabelText('Shopify storefront token')).toBeNull()
    expect(dialog.querySelector('input[type="password"]')).toBeNull()
    fireEvent.change(domain, { target: { value: '  Skeen-Store.myshopify.com ' } })
    const link = within(dialog).getByRole('link', { name: 'Connect with Shopify' })
    expect(link).toHaveAttribute('href', INSTALL)
    // The plain Connect button is gone — there is nothing else to run.
    expect(within(dialog).queryByRole('button', { name: /^Connect/ })).toBeNull()
    expect(clickFollows(link)).toBe(true)
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: a pasted admin link becomes the store address', () => {
    const dialog = openConnect(true)
    pick(dialog, 'Shopify')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Shopify store domain' }), { target: { value: 'https://admin.shopify.com/store/skeen-store/products' } })
    expect(within(dialog).getByRole('link', { name: 'Connect with Shopify' })).toHaveAttribute('href', INSTALL)
  })

  it('CRITICAL: a bad address does not leave, and says why', () => {
    const dialog = openConnect(true)
    pick(dialog, 'Shopify')
    const domain = within(dialog).getByRole('textbox', { name: 'Shopify store domain' })
    // Witness: a good address is followed.
    fireEvent.change(domain, { target: { value: 'skeen-store.myshopify.com' } })
    expect(clickFollows(within(dialog).getByRole('link', { name: 'Connect with Shopify' }))).toBe(true)
    fireEvent.change(domain, { target: { value: 'skeenmusic.com' } })
    expect(clickFollows(within(dialog).getByRole('link', { name: 'Connect with Shopify' }))).toBe(false)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/myshopify\.com/)
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: with other picks, Connect runs THEM (never Shopify), then Connect with Shopify is offered', async () => {
    const dialog = openConnect(true)
    pick(dialog, 'Bandsintown', 'Shopify')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Bandsintown Bandsintown artist name' }), { target: { value: 'Skeen' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Shopify store domain' }), { target: { value: 'skeen-store.myshopify.com' } })
    // One at a time: the link waits until the others have run.
    expect(within(dialog).queryByRole('link', { name: 'Connect with Shopify' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledTimes(1))
    expect(vi.mocked(connectOneAction).mock.calls[0]).toEqual(['a1', 'bandsintown', { id: 'Skeen' }])
    const link = await within(dialog).findByRole('link', { name: 'Connect with Shopify' })
    expect(link).toHaveAttribute('href', INSTALL)
    expect(vi.mocked(connectOneAction).mock.calls.some((c) => c[1] === 'shopify')).toBe(false)
    // Shopify was not RUN and refused either (the typed-token rule would say "enter the
    // token"): it waits for its own trip, and the tally counts only what ran.
    expect(within(dialog).getByLabelText('waiting')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('1 connected')
    expect(dialog).not.toHaveTextContent(/didn’t|storefront token/)
  })

  it('CRITICAL: not configured — today’s domain + token fields and Connect, unchanged', () => {
    const dialog = openConnect()
    pick(dialog, 'Shopify')
    expect(within(dialog).getByRole('textbox', { name: 'Shopify store domain' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Shopify storefront token')).toHaveAttribute('type', 'password')
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Connect with Shopify' })).toBeNull()
  })
})

describe('Shopify’s edit window', () => {
  const ROW: ConnectionRow = { def: connectionByKey('shopify')!, key: 'shopify', label: 'Shopify', state: 'synced' }
  function openEdit(shopifyApp?: boolean) {
    render(<ConnectionModal artistId="a1" row={ROW} open onClose={vi.fn()} onChange={vi.fn()} shopifyApp={shopifyApp} />)
    return screen.getByRole('dialog', { name: 'Shopify' })
  }

  it('CRITICAL: configured — the store address and Connect with Shopify; no token field, no Change token', async () => {
    const dialog = openEdit(true)
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    expect(within(dialog).queryByLabelText(/token/i)).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /change token/i })).toBeNull()
    const link = within(dialog).getByRole('link', { name: 'Connect with Shopify' })
    expect(link).toHaveAttribute('href', INSTALL)
    fireEvent.change(within(dialog).getByLabelText('Store domain'), { target: { value: 'new-store.myshopify.com' } })
    expect(link).toHaveAttribute('href', '/api/shopify/install?artist=a1&shop=new-store.myshopify.com')
    expect(getShopifyDomainAction).toHaveBeenCalledWith('a1')
  })

  it('CRITICAL: configured — a bad address does not leave, and says why', async () => {
    const dialog = openEdit(true)
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    expect(clickFollows(within(dialog).getByRole('link', { name: 'Connect with Shopify' }))).toBe(true) // witness
    fireEvent.change(within(dialog).getByLabelText('Store domain'), { target: { value: 'nope' } })
    expect(clickFollows(within(dialog).getByRole('link', { name: 'Connect with Shopify' }))).toBe(false)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/myshopify\.com/)
  })

  it('CRITICAL: not configured — today’s token field and Change token, no link', async () => {
    const dialog = openEdit()
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    expect(within(dialog).getByLabelText('New storefront token')).toHaveAttribute('type', 'password')
    expect(within(dialog).getByRole('button', { name: /change token/i })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Connect with Shopify' })).toBeNull()
  })
})

describe('the list hands the flag to both windows', () => {
  const SHOPIFY_ROW: ConnectionRow = { def: connectionByKey('shopify')!, key: 'shopify', label: 'Shopify', state: 'synced' }

  it('CRITICAL: configured — Connect and the Shopify row both offer Connect with Shopify', async () => {
    render(<ConnectionList artistId="a1" rows={[]} shopifyApp />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const dialog = screen.getByRole('dialog', { name: 'Connect' })
    pick(dialog, 'Shopify')
    expect(within(dialog).getByRole('link', { name: 'Connect with Shopify' })).toBeInTheDocument()
    cleanup()

    render(<ConnectionList artistId="a1" rows={[SHOPIFY_ROW]} shopifyApp />)
    fireEvent.click(screen.getByRole('button', { name: 'Shopify' }))
    const edit = screen.getByRole('dialog', { name: 'Shopify' })
    await waitFor(() => expect(within(edit).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    expect(within(edit).getByRole('link', { name: 'Connect with Shopify' })).toBeInTheDocument()
  })

  it('not configured (the default) — neither does', async () => {
    render(<ConnectionList artistId="a1" rows={[SHOPIFY_ROW]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shopify' }))
    const edit = screen.getByRole('dialog', { name: 'Shopify' })
    await waitFor(() => expect(within(edit).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    expect(within(edit).queryByRole('link', { name: 'Connect with Shopify' })).toBeNull()
  })
})

describe('back from Shopify', () => {
  it('success is one quiet line, and the flag leaves the address bar', () => {
    window.history.replaceState(null, '', '/artists/a1/connections?shopify=connected')
    render(<ShopifyReturnNotice kind="success" message="Shopify connected." />)
    expect(screen.getByRole('status')).toHaveTextContent('Shopify connected.')
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/artists/a1/connections')
  })

  it('a failure is one red line that says what happened, and can be dismissed', () => {
    window.history.replaceState(null, '', '/artists/a1/connections?shopify=failed&reason=hmac&keep=1')
    render(<ShopifyReturnNotice kind="error" message="Shopify’s reply couldn’t be checked, so nothing was saved. Try again." />)
    expect(screen.getByRole('alert')).toHaveTextContent('nothing was saved')
    // Only our two params go; anything else in the address stays.
    expect(window.location.search).toBe('?keep=1')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
