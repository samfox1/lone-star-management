// The Connections page tells the list ONE thing about the Google app — whether it is set up —
//   and turns the YouTube callback's return code into the words shown above the list.
/**
 * `page.tsx` is where the server-only credentials meet the browser, so this pins the seam:
 *
 *   - `youtubeApp` follows GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET (both set →
 *     true, either blank → false, so the button is hidden), and neither value appears in
 *     anything handed to the client;
 *   - `?youtube=…&reason=…` becomes the notice's words, chosen here from the code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Skeen' })),
  getShopifyDomain: vi.fn(async () => null),
  getEventbriteSignedIn: vi.fn(async () => false),
  dashboardDiff: vi.fn(async () => ({ link: { dirty: false } })),
}))
vi.mock('@/lib/content', async (importOriginal) => ({ ...(await importOriginal<object>()), listContent: vi.fn(async () => []) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const query: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not']) query[m] = () => query
    query.single = async () => ({ data: null, error: null })
    query.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null })
    return { from: () => query }
  },
}))

import ConnectionsPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/page'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'
import { YouTubeReturnNotice } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/shopify-return'

const ENV = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }
beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id-NOT-for-the-browser.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'GOCSPX-never_in_the_browser'
})
afterEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = ENV.id
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = ENV.secret
})

async function renderPage(query: Record<string, string> = {}) {
  const el = (await ConnectionsPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve(query) })) as ReactElement<{ children: unknown }>
  const kids = ([] as unknown[]).concat(el.props.children).filter(Boolean) as ReactElement<Record<string, unknown>>[]
  return { list: kids.find((k) => k.type === ConnectionList)!, notice: kids.find((k) => k.type === YouTubeReturnNotice), kids }
}

describe('the Connections page and the Google app', () => {
  it('CRITICAL: both credentials set → youtubeApp, and neither credential is in any prop', async () => {
    const { list, kids } = await renderPage({ youtube: 'connected' })
    expect(list.props.youtubeApp).toBe(true)
    const shipped = JSON.stringify(kids.map((k) => k.props))
    expect(shipped).not.toContain('GOCSPX-never_in_the_browser')
    expect(shipped).not.toContain('client-id-NOT-for-the-browser')
  })

  it('CRITICAL: either one blank → the button is hidden', async () => {
    expect((await renderPage()).list.props.youtubeApp).toBe(true) // witness
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = ''
    expect((await renderPage()).list.props.youtubeApp).toBe(false)
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'x'
    process.env.GOOGLE_OAUTH_CLIENT_ID = ''
    expect((await renderPage()).list.props.youtubeApp).toBe(false)
  })

  it('back from Google: the code becomes words above the list; no code, no line', async () => {
    expect((await renderPage({ youtube: 'connected' })).notice?.props).toEqual({ kind: 'success', message: 'YouTube connected.' })
    const none = await renderPage({ youtube: 'failed', reason: 'none' })
    expect(none.notice?.props).toMatchObject({ kind: 'error' })
    expect(String(none.notice?.props.message)).toMatch(/^No YouTube channel on that Google account/)
    expect((await renderPage()).notice).toBeUndefined()
  })
})
