// @vitest-environment jsdom
/**
 * Settings › Email renders through its own data plumbing: one row per kind, each with its own
 * addresses, confirmed or waiting.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/page.tsx
 * Feature:  Settings › Email (`/artists/[id]/settings/email`)
 * Tier:     LIGHT (AGENTS.md "Test depth"): the page is still being designed. One render through
 *           the page's own reads, the same discipline enquiries-page.test.tsx exists for: a server
 *           page with no render test is a page whose data-order bugs only the browser finds.
 * Covers:   • one row per kind, in the kinds' order
 *           • each row shows its own kind's addresses (the embedded select reached the rows)
 *           • each kind's description, and no line for one without
 *           • an address the status call says is waiting shows as waiting
 *           • a + on every kind
 * Not here: what the rows do when clicked (kind-rows.test.tsx, email-confirm.test.tsx); how a
 *           failed status read reads (tests/unit/manager-tools/enquiries/email-confirm.test.ts).
 * Fixtures: the ownership gate and every server action are mocked; a fake client answers the kinds
 *           query and email_confirmation_status (every address confirmed unless a test says not).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import EmailSettingsPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/page'

vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Lone Pine' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/actions', () => ({
  addEnquiryKindAction: vi.fn(),
  saveEnquiryKindAction: vi.fn(),
  deleteEnquiryKindAction: vi.fn(),
  setEnquiryRecipientsAction: vi.fn(),
  sendEmailCodeAction: vi.fn(),
  confirmEmailCodeAction: vi.fn(),
}))

const kinds = [
  {
    id: 'k1',
    slug: 'booking',
    label: 'Booking',
    description: 'Booking line',
    sort_order: 0,
    enquiry_recipients: [{ id: 'r0', email: 'agent@example.com', label: null, created_at: '2026-09-22T08:00:00Z' }],
  },
  {
    id: 'k2',
    slug: 'demo',
    label: 'Demo',
    description: 'Demo line',
    sort_order: 1,
    enquiry_recipients: [{ id: 'r1', email: 'ar@example.com', label: 'A&R', created_at: '2026-09-22T09:00:00Z' }],
  },
  { id: 'k3', slug: 'other', label: 'Contact', description: null, sort_order: 2, enquiry_recipients: [] },
]

function queryStub(answer: () => { data: unknown[] | null }) {
  const stub: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej)
          : () => stub,
    },
  )
  return stub
}
/** What email_confirmation_status answers: every address confirmed unless a test says not. */
let statusAnswer: { data: unknown; error: { code: string } | null }
beforeEach(() => {
  statusAnswer = {
    data: [
      { email: 'agent@example.com', confirmed: true, waiting: false },
      { email: 'ar@example.com', confirmed: true, waiting: false },
    ],
    error: null,
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => queryStub(() => ({ data: table === 'enquiry_kinds' ? kinds : [] })),
    rpc: (fn: string) => queryStub(() => (fn === 'email_confirmation_status' ? statusAnswer : { data: null, error: null }) as { data: unknown[] | null }),
  }),
}))

afterEach(cleanup)

const renderPage = async () => {
  await act(async () => {
    render(await EmailSettingsPage({ params: Promise.resolve({ id: 'a1' }) }))
  })
}

describe('/artists/[id]/settings/email', () => {
  // The kinds arrive in the manager's order, one row each.
  it('CRITICAL: renders one row per kind, in order', async () => {
    await renderPage()
    const rows = [...document.querySelectorAll('[data-kind]')].map((r) => r.getAttribute('data-kind'))
    expect(rows).toEqual(['booking', 'demo', 'other'])
  })

  // Each row gets its own kind's addresses from the one embedded query.
  it('CRITICAL: each row shows its own kind’s addresses, every one clickable', async () => {
    await renderPage()
    const row = (slug: string) => document.querySelector<HTMLElement>(`[data-kind="${slug}"]`)!
    // The embedded select reached the rows: without it every kind would look empty.
    expect(within(row('booking')).getByRole('button', { name: 'agent@example.com' })).toBeTruthy()
    expect(within(row('demo')).getByRole('button', { name: 'ar@example.com' })).toBeTruthy()
    expect(within(row('demo')).queryByText('agent@example.com')).toBeNull()
  })

  // The description column reaches the rows; a kind without one shows no line.
  it('shows each kind’s own description, and no line for one without', async () => {
    await renderPage()
    expect(document.querySelector('[data-kind="booking"]')!.textContent).toContain('Booking line')
    expect(document.querySelector('[data-kind="other"]')!.textContent).not.toContain('For everything else')
  })

  // The status call decides which addresses wait for a code; the rest stay ordinary.
  it('an address the status call says is waiting shows as waiting (blue, the code window), the rest as before', async () => {
    statusAnswer = { data: [{ email: 'agent@example.com', confirmed: true, waiting: false }, { email: 'ar@example.com', confirmed: false, waiting: true }], error: null }
    await renderPage()
    const row = (slug: string) => document.querySelector<HTMLElement>(`[data-kind="${slug}"]`)!
    expect(within(row('demo')).getByRole('button', { name: 'ar@example.com: enter the code' })).toBeTruthy()
    expect(within(row('booking')).getByRole('button', { name: 'agent@example.com' })).toBeTruthy()
  })

  // Every kind can take one more address.
  it('offers a + on every kind', async () => {
    await renderPage()
    for (const label of ['Booking', 'Demo', 'Contact']) expect(screen.getByRole('button', { name: `Add email to ${label}` })).toBeTruthy()
  })
})
