// The Connections page tells the list ONE thing about the Eventbrite app — whether it is set up —
//   reads whether a sign-in is stored (never the token), and turns the callback's code into words.
/**
 * `page.tsx` is where the server-only credentials meet the browser, so this pins the seam:
 *
 *   - `eventbriteApp` follows EVENTBRITE_CLIENT_ID + EVENTBRITE_CLIENT_SECRET (both set → true,
 *     either blank → false: the button is hidden), and neither value is in anything handed to
 *     the client;
 *   - a stored sign-in makes the Eventbrite row a synced source; with the app off and nothing
 *     stored, a pasted Eventbrite link is a plain social (no Sync chip that cannot work);
 *   - `?eventbrite=…&reason=…` becomes the notice's words, chosen here from the code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const data = vi.hoisted(() => ({ stored: false }))
vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: 'a1', name: 'Skeen' })),
  getShopifyDomain: vi.fn(async () => null),
  getEventbriteSignedIn: vi.fn(async () => data.stored),
  dashboardDiff: vi.fn(async () => ({ link: { dirty: false } })),
}))
vi.mock('@/lib/content', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listContent: vi.fn(async () => [{ id: 'l-eb', label: 'Eventbrite', url: 'https://www.eventbrite.com/o/skeen-222', on_site: false, role: null }]),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const query: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not']) query[m] = () => query
    query.single = async () => ({ data: null, error: null })
    query.then = (resolve: (v: unknown) => unknown) => resolve({ count: 2, error: null })
    return { from: () => query }
  },
}))

import ConnectionsPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/page'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'
import { EventbriteReturnNotice } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/shopify-return'
import type { ConnectionRow } from '@/lib/connections'

const ENV = { id: process.env.EVENTBRITE_CLIENT_ID, secret: process.env.EVENTBRITE_CLIENT_SECRET }
beforeEach(() => {
  process.env.EVENTBRITE_CLIENT_ID = 'EB-KEY-not-for-the-browser'
  process.env.EVENTBRITE_CLIENT_SECRET = 'EB-SECRET-never-in-the-browser'
  data.stored = false
})
afterEach(() => {
  process.env.EVENTBRITE_CLIENT_ID = ENV.id
  process.env.EVENTBRITE_CLIENT_SECRET = ENV.secret
})

async function renderPage(query: Record<string, string> = {}) {
  const el = (await ConnectionsPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve(query) })) as ReactElement<{ children: unknown }>
  const kids = ([] as unknown[]).concat(el.props.children).filter(Boolean) as ReactElement<Record<string, unknown>>[]
  const list = kids.find((k) => k.type === ConnectionList)!
  const eb = (list.props.rows as ConnectionRow[]).find((r) => r.key === 'eventbrite')
  return { list, eb, notice: kids.find((k) => k.type === EventbriteReturnNotice), kids }
}

describe('the Connections page and the Eventbrite app', () => {
  it('CRITICAL: both credentials set → eventbriteApp, and neither credential is in any prop', async () => {
    const { list, kids } = await renderPage({ eventbrite: 'connected' })
    expect(list.props.eventbriteApp).toBe(true)
    const shipped = JSON.stringify(kids.map((k) => k.props))
    expect(shipped).not.toContain('EB-SECRET-never-in-the-browser')
    expect(shipped).not.toContain('EB-KEY-not-for-the-browser')
  })

  it('CRITICAL: either one blank → the button is hidden', async () => {
    expect((await renderPage()).list.props.eventbriteApp).toBe(true) // witness
    process.env.EVENTBRITE_CLIENT_SECRET = ''
    expect((await renderPage()).list.props.eventbriteApp).toBe(false)
    process.env.EVENTBRITE_CLIENT_SECRET = 'x'
    process.env.EVENTBRITE_CLIENT_ID = ''
    expect((await renderPage()).list.props.eventbriteApp).toBe(false)
  })

  it('CRITICAL: a stored sign-in is a synced source; not stored → "Sync" when the app is on, a plain social when off', async () => {
    data.stored = true
    expect((await renderPage()).eb?.state).toBe('synced')
    data.stored = false
    expect((await renderPage()).eb?.state).toBe('connect')
    process.env.EVENTBRITE_CLIENT_ID = ''
    expect((await renderPage()).eb?.state).toBe('none')
  })

  it('back from Eventbrite: the code becomes words above the list; no code, no line', async () => {
    expect((await renderPage({ eventbrite: 'connected' })).notice?.props).toEqual({ kind: 'success', message: 'Eventbrite connected.' })
    const several = await renderPage({ eventbrite: 'failed', reason: 'several' })
    expect(several.notice?.props).toMatchObject({ kind: 'error' })
    expect(String(several.notice?.props.message)).toMatch(/organizer link/)
    expect((await renderPage()).notice).toBeUndefined()
  })
})
