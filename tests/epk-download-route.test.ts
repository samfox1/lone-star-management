/**
 * The EPK download route — the only place the readiness gate is actually ENFORCED.
 *
 * The dashboard's disabled button is cosmetic: a URL can be typed. Everything the page
 * promises is re-checked here, and until this file existed a refactor could drop the
 * route's own `epkReadiness` re-check or its RLS-scoped ownership read and every suite
 * stayed green.
 *
 * `buildEpkPdf` is mocked — its real behaviour (bytes, encodings, merge failures) is
 * covered by epk-pdf.test.ts against real PDFs. What this file pins is the route's
 * DECISIONS: who gets a PDF at all, and what travels in the headers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteData } from '@/lib/site'

const maybeSingleMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
    rpc: rpcMock,
  }),
}))

const downloadMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ storage: { from: () => ({ download: downloadMock }) } }),
}))

const getPublishedSiteMock = vi.fn()
vi.mock('@/lib/site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/site')>()),
  getPublishedSite: (...args: unknown[]) => getPublishedSiteMock(...args),
}))

const buildEpkPdfMock = vi.fn()
vi.mock('@/lib/epk-pdf', () => ({
  buildEpkPdf: (...args: unknown[]) => buildEpkPdfMock(...args),
}))

import { GET } from '@/app/artists/[id]/(dashboard)/epk/download/route'

function site(artist: Partial<SiteData['artist']> = {}): SiteData {
  return {
    artist: {
      id: 'a1',
      slug: 'lone-pine',
      name: 'Lone Pine',
      bio: 'Dusty alt-country out of West Texas.',
      hero_image_url: null,
      template: 'classic',
      spotify_artist_id: null,
      stage_plot_path: null,
      tech_rider_path: null,
      ...artist,
    },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [{ id: 'l1', label: 'Booking', url: 'mailto:book@example.com', sort_order: 0 }] as never,
    videos: [],
    media: [{ purpose: 'profile_photo', url: 'https://img.example/p.jpg' }] as never,
    site_content: {},
    styles: {},
    fonts: [],
    font_slots: {},
  } as SiteData
}

const call = () => GET(new Request('http://x/'), { params: Promise.resolve({ id: 'a1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  maybeSingleMock.mockResolvedValue({ data: { slug: 'lone-pine' } })
  rpcMock.mockResolvedValue({ data: [{ title: 'EP', release_date: '2024-03-01' }] })
  getPublishedSiteMock.mockResolvedValue(site())
  buildEpkPdfMock.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), skipped: [] })
  downloadMock.mockResolvedValue({ data: null })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9]))))
})

describe('EPK download route — who gets a PDF', () => {
  it('CRITICAL: an artist the caller cannot see is a 404, and no PDF is ever built', async () => {
    // RLS scopes the artist read, so "not yours" and "does not exist" are the same
    // answer on purpose — the 404 must not leak which one it was.
    maybeSingleMock.mockResolvedValue({ data: null })
    const res = await call()
    expect(res.status).toBe(404)
    expect(buildEpkPdfMock).not.toHaveBeenCalled()
  })

  it('CRITICAL: the gate is re-checked server-side — an unready artist gets 409, not a half-empty PDF', async () => {
    // The page disables the button, but a URL can be typed. This is the enforcement.
    getPublishedSiteMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.missing).toHaveLength(4)
    expect(buildEpkPdfMock).not.toHaveBeenCalled()
  })

  it('a missing single requirement 409s and NAMES it', async () => {
    getPublishedSiteMock.mockResolvedValue(site({ bio: '' }))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).missing).toEqual(['A bio'])
  })

  it('a ready artist gets a fresh PDF download, never cached', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="lone-pine-press-kit.pdf"')
    // Built on click, fresh (Sam's decision): caching would defeat not storing it.
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('EPK download route — what travels in the headers', () => {
  it('surfaces skipped attachments in x-epk-skipped so the page can warn the manager', async () => {
    buildEpkPdfMock.mockResolvedValue({ bytes: new Uint8Array([1]), skipped: ['Tech rider'] })
    const res = await call()
    expect(res.headers.get('x-epk-skipped')).toBe('Tech rider')
  })

  it('omits the header entirely when nothing was skipped', async () => {
    const res = await call()
    expect(res.headers.get('x-epk-skipped')).toBeNull()
  })
})

describe('EPK download route — press documents', () => {
  it('loads stage plot before rider and passes only the objects that still exist', async () => {
    getPublishedSiteMock.mockResolvedValue(
      site({ stage_plot_path: 'a1/documents/plot.pdf', tech_rider_path: 'a1/documents/rider.pdf' }),
    )
    // The rider object was deleted behind the row's back: skipped, not fatal — the
    // press kit is still worth sending without it.
    downloadMock.mockImplementation(async (path: string) =>
      path.includes('plot') ? { data: new Blob([new Uint8Array([7])]) } : { data: null },
    )
    const res = await call()
    expect(res.status).toBe(200)
    expect(downloadMock.mock.calls.map((c) => c[0])).toEqual([
      'a1/documents/plot.pdf',
      'a1/documents/rider.pdf',
    ])
    const attachments = buildEpkPdfMock.mock.calls[0][0].attachments
    expect(attachments.map((a: { label: string }) => a.label)).toEqual(['Stage plot'])
  })
})
