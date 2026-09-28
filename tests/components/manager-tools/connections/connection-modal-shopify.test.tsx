// @vitest-environment jsdom
// The Shopify edit window: change the store domain and rotate the storefront token
// without disconnecting first.
/**
 * ConnectionModal, Shopify branch (found by docs review 2026-09-28). Once connected there
 * was no field for the store domain or the token — the only path was Remove then Connect
 * again, which orphans the old store's synced merch rows. What has to hold:
 *
 *   - the current store domain shows, read the same way the page already can;
 *   - the token field is ALWAYS EMPTY and type=password — the real token lives in Vault
 *     and is never sent to the browser, so there is nothing to prefill it with;
 *   - saving runs the SAME connect path as a first connect (connectOneAction /
 *     connectShopifyAction + the probe), sending the domain shown plus the new token;
 *   - a refused token shows the probe's error and does not claim success;
 *   - the token is never rendered back, before or after a save.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConnectionModal } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-modal'
import { connectOneAction, getShopifyDomainAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { connectionByKey, type ConnectionRow } from '@/lib/connections'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  updateContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true, message: '12 products found' })),
  getShopifyDomainAction: vi.fn(async () => 'skeen-store.myshopify.com'),
  disconnectConnectionAction: vi.fn(async () => ({})),
  pullConnectionAction: vi.fn(async () => ({ ok: true, message: '12 products' })),
  syncProfileAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ROW: ConnectionRow = { def: connectionByKey('shopify')!, key: 'shopify', label: 'Shopify', state: 'synced' }

function mount(row: ConnectionRow = ROW) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  render(<ConnectionModal artistId="a1" row={row} open onClose={onClose} onChange={onChange} />)
  return { dialog: screen.getByRole('dialog', { name: 'Shopify' }), onChange, onClose }
}

describe('the store domain', () => {
  it('shows the connected domain, read the way the page already can', async () => {
    const { dialog } = mount()
    await waitFor(() => expect(getShopifyDomainAction).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
  })
})

describe('the token field', () => {
  it('CRITICAL: starts empty and type=password — the real token never reaches the browser', async () => {
    const { dialog } = mount()
    await waitFor(() => expect(getShopifyDomainAction).toHaveBeenCalled())
    const token = within(dialog).getByLabelText(/token/i)
    expect(token).toHaveAttribute('type', 'password')
    expect(token).toHaveValue('')
  })

  it('CRITICAL: the token is never rendered back, even after a successful save', async () => {
    const { dialog } = mount()
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    const token = within(dialog).getByLabelText(/token/i)
    fireEvent.change(token, { target: { value: 'shpat_supersecret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /change token/i }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledTimes(1))
    expect(dialog).not.toHaveTextContent('shpat_supersecret')
    expect(within(dialog).getByLabelText(/token/i)).toHaveValue('')
  })
})

describe('saving', () => {
  it('CRITICAL: runs the same connect path as a first connect, with the shown domain and the new token', async () => {
    const { dialog } = mount()
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText(/token/i), { target: { value: 'shpat_new_token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /change token/i }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledWith('a1', 'shopify', { domain: 'skeen-store.myshopify.com', token: 'shpat_new_token' }))
    await waitFor(() => expect(dialog).toHaveTextContent('12 products found'))
  })

  it('a changed domain is sent along with the new token', async () => {
    const { dialog } = mount()
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText(/domain/i), { target: { value: 'new-store.myshopify.com' } })
    fireEvent.change(within(dialog).getByLabelText(/token/i), { target: { value: 'shpat_new_token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /change token/i }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledWith('a1', 'shopify', { domain: 'new-store.myshopify.com', token: 'shpat_new_token' }))
  })

  it('CRITICAL: a refused token shows the error and does not report success', async () => {
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'Shopify says the token is wrong.', detail: 'Check it was copied in full.' })
    const { dialog } = mount()
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText(/token/i), { target: { value: 'bad-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /change token/i }))
    await waitFor(() => expect(dialog).toHaveTextContent('Shopify says the token is wrong.'))
    expect(dialog).toHaveTextContent('Check it was copied in full.')
    expect(dialog).not.toHaveTextContent(/12 products found/)
    // The old connection stays intact — the row is still here, nothing removed it.
    expect(screen.getByRole('dialog', { name: 'Shopify' })).toBeInTheDocument()
  })

  it('CRITICAL: two fast clicks save once — the latch is a ref, not the disabled state', async () => {
    let release!: (v: { ok: boolean; message?: string }) => void
    vi.mocked(connectOneAction).mockImplementationOnce(() => new Promise((res) => { release = res }))
    const { dialog } = mount()
    await waitFor(() => expect(within(dialog).getByDisplayValue('skeen-store.myshopify.com')).toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText(/token/i), { target: { value: 'shpat_new_token' } })
    const btn = within(dialog).getByRole('button', { name: /change token/i })
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(connectOneAction).toHaveBeenCalledTimes(1)
    await act(async () => release({ ok: true, message: 'ok' }))
  })
})
