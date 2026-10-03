// @vitest-environment jsdom
// Settings → Email renders: one row per kind, each with its own addresses.
/**
 * `/artists/[id]/settings/email` — one render through the page's own data plumbing, the
 * same discipline enquiries-page.test.tsx exists for: a server page with no render test is
 * a page whose data-order bugs only the browser finds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import EmailSettingsPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/page'

vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Lone Pine' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions', () => ({
  addEnquiryKindAction: vi.fn(),
  saveEnquiryKindAction: vi.fn(),
  deleteEnquiryKindAction: vi.fn(),
  setEnquiryRecipientsAction: vi.fn(),
}))

const kinds = [
  {
    id: 'k1',
    slug: 'booking',
    label: 'Booking',
    sort_order: 0,
    enquiry_recipients: [{ id: 'r0', email: 'agent@example.com', label: null, created_at: '2026-09-22T08:00:00Z' }],
  },
  {
    id: 'k2',
    slug: 'demo',
    label: 'Demo',
    sort_order: 1,
    enquiry_recipients: [{ id: 'r1', email: 'ar@example.com', label: 'A&R', created_at: '2026-09-22T09:00:00Z' }],
  },
  { id: 'k3', slug: 'other', label: 'Contact', sort_order: 2, enquiry_recipients: [] },
]

/** Is `enquiry_kinds.description` there? False plays the hosted project before 20261002220000:
 *  a select naming it is a 42703, as PostgREST answers. */
let columnLive = true
/** What the page selected from enquiry_kinds, in order. */
let selects: string[] = []

function queryStub(answer: (columns: string) => { data: unknown[] | null; error?: { code: string } }) {
  let columns = ''
  const stub: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(answer(columns)).then(res, rej)
          : prop === 'select'
            ? (c: string) => ((columns = c), selects.push(c), stub)
            : () => stub,
    },
  )
  return stub
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) =>
      queryStub((columns) => {
        if (table !== 'enquiry_kinds') return { data: [] }
        if (/\bdescription\b/.test(columns)) {
          return columnLive
            ? { data: kinds.map((k) => ({ ...k, description: k.slug === 'other' ? null : `${k.label} line` })) }
            : { data: null, error: { code: '42703' } }
        }
        return { data: kinds }
      }),
  }),
}))

beforeEach(() => {
  columnLive = true
  selects = []
})

afterEach(cleanup)

const renderPage = async () => {
  await act(async () => {
    render(await EmailSettingsPage({ params: Promise.resolve({ id: 'a1' }) }))
  })
}

describe('/artists/[id]/settings/email', () => {
  it('CRITICAL: renders one row per kind, in order', async () => {
    await renderPage()
    const rows = [...document.querySelectorAll('[data-kind]')].map((r) => r.getAttribute('data-kind'))
    expect(rows).toEqual(['booking', 'demo', 'other'])
  })

  it('CRITICAL: each row shows its own kind’s addresses, every one clickable', async () => {
    await renderPage()
    const row = (slug: string) => document.querySelector<HTMLElement>(`[data-kind="${slug}"]`)!
    // The embedded select reached the rows: without it every kind would look empty.
    expect(within(row('booking')).getByRole('button', { name: 'agent@example.com' })).toBeTruthy()
    expect(within(row('demo')).getByRole('button', { name: 'ar@example.com' })).toBeTruthy()
    expect(within(row('demo')).queryByText('agent@example.com')).toBeNull()
  })

  it('shows each kind’s own description, and no line for one without', async () => {
    await renderPage()
    expect(document.querySelector('[data-kind="booking"]')!.textContent).toContain('Booking line')
    expect(document.querySelector('[data-kind="other"]')!.textContent).not.toContain('For everything else')
  })

  it('before the column exists, still shows every kind with the fixed lines (DELETE at push time)', async () => {
    columnLive = false
    await renderPage()
    expect(selects).toHaveLength(2)
    expect([...document.querySelectorAll('[data-kind]')].map((r) => r.getAttribute('data-kind'))).toEqual(['booking', 'demo', 'other'])
    expect(document.querySelector('[data-kind="other"]')!.textContent).toContain('For everything else')
  })

  it('offers a + on every kind', async () => {
    await renderPage()
    for (const label of ['Booking', 'Demo', 'Contact']) expect(screen.getByRole('button', { name: `Add email to ${label}` })).toBeTruthy()
  })
})
