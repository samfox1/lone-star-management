// The Connections page tells the list ONE thing about the Shopify app — whether it is set up —
//   and turns the callback's return code into the words shown above the list.
/**
 * `page.tsx` is where the server-only credentials meet the browser, so this pins the seam:
 *
 *   - `shopifyApp` follows SHOPIFY_API_KEY + SHOPIFY_API_SECRET (both set → true, either
 *     blank → false), and neither value appears in anything handed to the client;
 *   - `?shopify=…&reason=…` becomes the notice's words, chosen here from the code.
 *
 * The page's data readers are faked; the element tree it returns is inspected directly
 * (a server component is a function returning JSX).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Skeen' })),
  getShopifyDomain: vi.fn(async () => null),
  dashboardDiff: vi.fn(async () => ({ link: { dirty: false } })),
}))
vi.mock('@/lib/content', async (importOriginal) => ({ ...(await importOriginal<object>()), listContent: vi.fn(async () => []) }))
vi.mock('@/lib/supabase/server', () => ({
  // The client is plain; the QUERY is the thenable (so `await createClient()` is the client).
  createClient: async () => {
    const query: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not']) query[m] = () => query
    query.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null })
    return { from: () => query }
  },
}))

import ConnectionsPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/page'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'
import { ShopifyReturnNotice } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/shopify-return'

const ENV = { key: process.env.SHOPIFY_API_KEY, secret: process.env.SHOPIFY_API_SECRET }
beforeEach(() => {
  process.env.SHOPIFY_API_KEY = 'client-id-VISIBLE?'
  process.env.SHOPIFY_API_SECRET = 'shpss_never_in_the_browser'
})
afterEach(() => {
  process.env.SHOPIFY_API_KEY = ENV.key
  process.env.SHOPIFY_API_SECRET = ENV.secret
})

async function renderPage(query: Record<string, string> = {}) {
  const el = (await ConnectionsPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve(query) })) as ReactElement<{ children: unknown }>
  const kids = ([] as unknown[]).concat(el.props.children).filter(Boolean) as ReactElement<Record<string, unknown>>[]
  return {
    list: kids.find((k) => k.type === ConnectionList)!,
    notice: kids.find((k) => k.type === ShopifyReturnNotice),
    kids,
  }
}

describe('the Connections page and the Shopify app', () => {
  it('CRITICAL: both credentials set → shopifyApp, and neither credential is in any prop', async () => {
    const { list, kids } = await renderPage({ shopify: 'connected' })
    expect(list.props.shopifyApp).toBe(true)
    const shipped = JSON.stringify(kids.map((k) => k.props))
    expect(shipped).not.toContain('shpss_never_in_the_browser')
    expect(shipped).not.toContain('client-id-VISIBLE?')
  })

  it('CRITICAL: either one blank → not set up, so the typed fields stay', async () => {
    expect((await renderPage()).list.props.shopifyApp).toBe(true) // witness
    process.env.SHOPIFY_API_SECRET = ''
    expect((await renderPage()).list.props.shopifyApp).toBe(false)
    process.env.SHOPIFY_API_SECRET = 'x'
    process.env.SHOPIFY_API_KEY = ''
    expect((await renderPage()).list.props.shopifyApp).toBe(false)
  })

  it('back from Shopify: the code becomes words above the list; no code, no line', async () => {
    const ok = await renderPage({ shopify: 'connected' })
    expect(ok.notice?.props).toEqual({ kind: 'success', message: 'Shopify connected.' })
    const bad = await renderPage({ shopify: 'failed', reason: 'scope' })
    expect(bad.notice?.props).toMatchObject({ kind: 'error' })
    expect(String(bad.notice?.props.message)).toMatch(/less access/)
    expect((await renderPage()).notice).toBeUndefined()
  })
})
