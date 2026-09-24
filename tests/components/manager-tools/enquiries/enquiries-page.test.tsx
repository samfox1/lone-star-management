// @vitest-environment jsdom
// The per-artist Enquiries page renders — kinds above, inbox below, labels from the table.
/**
 * `/artists/[id]/enquiries` — one render, end to end through the page's own data plumbing.
 *
 * WHY THIS FILE EXISTS. On 2026-09-22 the page shipped with `labelFor` used inside a
 * `.map()` callback declared ABOVE the `const` that defined it. TypeScript only flags
 * use-before-declare for direct references — inside a closure it assumes the call may come
 * later — so `tsc` was clean, every component test was green (none rendered this page; the
 * roster inbox has one, this page did not), and the owner found it as a runtime error in the
 * browser. A single render of the real page is the test that would have gone red.
 *
 * The Supabase client is a query-builder stub (any chain resolves `{ data }` by table), the
 * same shape enquiries-inbox-page.test.tsx uses, so the page can add or reorder builder
 * calls without this mock having to know.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import EnquiriesPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/page'

vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Lone Pine' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/section-shell', () => ({
  SectionShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions', () => ({
  setEnquiryReadAction: vi.fn(async () => ({ ok: true })),
  signEnquiryAttachmentsAction: vi.fn(async () => []),
  addEnquiryKindAction: vi.fn(),
  renameEnquiryKindAction: vi.fn(),
  deleteEnquiryKindAction: vi.fn(),
  setEnquiryRecipientsAction: vi.fn(),
}))

const tables: Record<string, unknown[]> = {
  enquiries: [
    {
      id: 'e1',
      purpose: 'sync-licensing',
      name: 'Jamie Rowe',
      email: 'jamie@example.com',
      message: 'Can we license the single?',
      read_at: null,
      created_at: '2026-09-22T10:00:00Z',
      demo_url: null,
      status: 'sent',
    },
  ],
  enquiry_kinds: [
    { id: 'k1', slug: 'booking', label: 'Booking', sort_order: 0, enquiry_recipients: [] },
    {
      id: 'k2',
      slug: 'sync-licensing',
      label: 'Sync licensing',
      sort_order: 3,
      enquiry_recipients: [{ id: 'r1', email: 'pub@example.com', label: 'Publicist', created_at: '2026-09-22T09:00:00Z' }],
    },
  ],
  enquiry_attachments: [],
}

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
    from: (table: string) => queryStub(() => tables[table] ?? []),
    rpc: async () => ({ data: [{ to_email: 'booking@lonepine.example', recipient_source: 'link' }] }),
  }),
}))

afterEach(cleanup)

const renderPage = async () => {
  await act(async () => {
    render(await EnquiriesPage({ params: Promise.resolve({ id: 'a1' }) }))
  })
}

describe('/artists/[id]/enquiries', () => {
  it('CRITICAL: renders at all', async () => {
    // The whole reason for the file. A page that throws in its data plumbing throws here.
    await renderPage()
    expect(screen.getByText('Jamie Rowe')).toBeTruthy()
  })

  it("labels the inbox row with the kind's LABEL from the table, not the slug", async () => {
    await renderPage()
    expect(screen.getByText('Sync licensing')).toBeTruthy()
    expect(screen.queryByText('sync-licensing')).toBeNull()
  })

  it('is the inbox and nothing else — no kind rows, no Add kind', async () => {
    // Sam, 2026-09-22: "I want the enquiries to take up the whole space". The kind rows
    // and their pop-up moved to Settings → Email. Only the labels still come from here.
    await renderPage()
    expect(screen.queryByRole('button', { name: 'Add kind' })).toBeNull()
    expect(screen.queryByText('booking@lonepine.example')).toBeNull()
  })
})
