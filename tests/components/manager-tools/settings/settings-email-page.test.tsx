// @vitest-environment jsdom
// Settings → Email renders: one row per kind, the resolved address, the count.
/**
 * `/artists/[id]/settings/email` — one render through the page's own data plumbing, the
 * same discipline enquiries-page.test.tsx exists for: a server page with no render test is
 * a page whose data-order bugs only the browser finds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import EmailSettingsPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/page'

vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Lone Pine' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions', () => ({
  addEnquiryKindAction: vi.fn(),
  renameEnquiryKindAction: vi.fn(),
  deleteEnquiryKindAction: vi.fn(),
  setEnquiryRecipientsAction: vi.fn(),
}))

const kinds = [
  { id: 'k1', slug: 'booking', label: 'Booking', sort_order: 0, enquiry_recipients: [] },
  {
    id: 'k2',
    slug: 'demo',
    label: 'Demo',
    sort_order: 1,
    enquiry_recipients: [{ id: 'r1', email: 'ar@example.com', label: 'A&R', created_at: '2026-09-22T09:00:00Z' }],
  },
  { id: 'k3', slug: 'other', label: 'Contact', sort_order: 2, enquiry_recipients: [] },
]

function queryStub(data: () => unknown[]) {
  const stub: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve({ data: data() }).then(res, rej)
          : () => stub,
    },
  )
  return stub
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => queryStub(() => (table === 'enquiry_kinds' ? kinds : [])),
    rpc: async () => ({ data: [{ to_email: 'booking@lonepine.example', recipient_source: 'link' }] }),
  }),
}))

afterEach(cleanup)

const renderPage = async () => {
  await act(async () => {
    render(await EmailSettingsPage({ params: Promise.resolve({ id: 'a1' }) }))
  })
}

describe('/artists/[id]/settings/email', () => {
  it('CRITICAL: renders one row per kind, in order', async () => {
    await renderPage()
    const rows = screen.getAllByRole('button', { name: /Booking|Demo|Contact/ })
    expect(rows.map((r) => r.textContent?.match(/Booking|Demo|Contact/)?.[0])).toEqual(['Booking', 'Demo', 'Contact'])
  })

  it('shows the resolved booking address on every kind, and the count where people are added', async () => {
    await renderPage()
    expect(screen.getAllByText('booking@lonepine.example')).toHaveLength(3)
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.queryByText('+0')).toBeNull()
  })

  it('offers Add kind', async () => {
    await renderPage()
    expect(screen.getByRole('button', { name: /Add kind/ })).toBeTruthy()
  })
})
