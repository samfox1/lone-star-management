/**
 * The Connections page tells the browser only whether the Eventbrite app is set up and whether a
 * sign-in is stored (never the credentials or the token), and turns the sign-in's return code
 * into words.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/connections/page.tsx (with
 *           shopify-return.tsx's EventbriteReturnNotice)
 * Feature:  Connections page: Connect with Eventbrite
 * Tier:     STRICT (AGENTS.md "Test depth"): security. page.tsx is where the server-only
 *           credentials meet the browser.
 * Covers:   • `eventbriteApp` is true only with both credentials set, and neither credential is in
 *             anything handed to the browser
 *           • a stored sign-in makes the Eventbrite row a synced source; with the app on and
 *             nothing stored it offers Sync; with the app off it is a plain link
 *           • `?eventbrite=…&reason=…` becomes the notice above the list; no code, no notice
 * Not here: the buttons themselves (tests/components/manager-tools/connections/eventbrite-connect.test.tsx);
 *           the words for each code (eventbrite-oauth.test.ts).
 * Fixtures: the page's data loaders and the database client are mocked; the page is rendered as
 *           a server component and its children's props are read.
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
  // Both credentials set: the list is told "on", and neither credential appears in any prop sent
  // to the browser.
  it('CRITICAL: both credentials set → eventbriteApp, and neither credential is in any prop', async () => {
    const { list, kids } = await renderPage({ eventbrite: 'connected' })
    expect(list.props.eventbriteApp).toBe(true)
    const shipped = JSON.stringify(kids.map((k) => k.props))
    expect(shipped).not.toContain('EB-SECRET-never-in-the-browser')
    expect(shipped).not.toContain('EB-KEY-not-for-the-browser')
  })

  // Either credential blank: the list is told "off", so the button is hidden.
  it('CRITICAL: either one blank → the button is hidden', async () => {
    expect((await renderPage()).list.props.eventbriteApp).toBe(true) // witness
    process.env.EVENTBRITE_CLIENT_SECRET = ''
    expect((await renderPage()).list.props.eventbriteApp).toBe(false)
    process.env.EVENTBRITE_CLIENT_SECRET = 'x'
    process.env.EVENTBRITE_CLIENT_ID = ''
    expect((await renderPage()).list.props.eventbriteApp).toBe(false)
  })

  // A stored sign-in makes the row synced; not stored, it offers Sync when the app is on and
  // is a plain link when it is off (no Sync chip that cannot work).
  it('CRITICAL: a stored sign-in is a synced source; not stored → "Sync" when the app is on, a plain social when off', async () => {
    data.stored = true
    expect((await renderPage()).eb?.state).toBe('synced')
    data.stored = false
    expect((await renderPage()).eb?.state).toBe('connect')
    process.env.EVENTBRITE_CLIENT_ID = ''
    expect((await renderPage()).eb?.state).toBe('none')
  })

  // Back from Eventbrite, the code becomes the notice above the list; without a code there is none.
  it('back from Eventbrite: the code becomes words above the list; no code, no line', async () => {
    expect((await renderPage({ eventbrite: 'connected' })).notice?.props).toEqual({ kind: 'success', message: 'Eventbrite connected.' })
    const several = await renderPage({ eventbrite: 'failed', reason: 'several' })
    expect(several.notice?.props).toMatchObject({ kind: 'error' })
    expect(String(several.notice?.props.message)).toMatch(/organizer link/)
    expect((await renderPage()).notice).toBeUndefined()
  })
})
