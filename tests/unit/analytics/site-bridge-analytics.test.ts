// @vitest-environment jsdom
// The bridge's fan-side reporter: what goes on the wire, and what never does.
// `@samfox1/site-bridge/analytics` is the ONE way a connected site reports a fan action.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENTITY_KINDS as TS_KINDS, EVENT_TYPES as TS_TYPES } from '@/lib/events'
import {
  ENTITY_KINDS,
  EVENT_TYPES,
  createAnalytics,
  eventBody,
  isAnalyticsConfigured,
  isEditShell,
  readTrackAttrs,
  trackAttrs,
  type AnalyticsDeps,
  type EventType,
} from '../../../packages/site-bridge/src/analytics'

const CONFIG = { supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon-key', slug: 'skeen' }
const LOC = { href: 'https://skeenmusic.com/tour?utm_source=ig#dates', pathname: '/tour' }

/** A reporter wired to a spy instead of the network, with a browser-shaped location. */
function wired(over: Partial<AnalyticsDeps> = {}, config: Partial<typeof CONFIG> | null = CONFIG) {
  const fetchSpy = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null, { status: 204 })))
  const a = createAnalytics(config, {
    fetch: fetchSpy as unknown as typeof fetch,
    location: LOC,
    referrer: () => 'https://l.instagram.com/',
    ...over,
  })
  const sent = () => fetchSpy.mock.calls.map(([url, init]) => ({
    url,
    init,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  }))
  return { a, fetchSpy, sent }
}

describe('the pinned contract mirrors src/lib/events.ts', () => {
  it('event types', () => {
    expect([...EVENT_TYPES].sort()).toEqual(TS_TYPES.map((e) => e.type).sort())
  })
  it('entity kinds', () => {
    expect([...ENTITY_KINDS].sort()).toEqual([...TS_KINDS].sort())
  })
})

describe('what goes on the wire', () => {
  it('CRITICAL: a page view posts to the door with the full href, the referrer and no entity', () => {
    const { a, sent } = wired()
    a.pageview()
    expect(sent()).toHaveLength(1)
    const [call] = sent()
    expect(call.url).toBe('https://proj.supabase.co/functions/v1/event')
    expect(call.body).toEqual({
      slug: 'skeen',
      type: 'view',
      // The WHOLE href: the door takes the path, the UTM tags and the site's own host from
      // it, so a site never parses its own URL and cannot disagree with the door.
      url: 'https://skeenmusic.com/tour?utm_source=ig#dates',
      referrer: 'https://l.instagram.com/',
    })
    expect(call.init.method).toBe('POST')
    expect(call.init.headers).toMatchObject({
      'Content-Type': 'application/json',
      apikey: 'anon-key',
      Authorization: 'Bearer anon-key',
    })
  })

  it('CRITICAL: keepalive is set — a click on an outbound link would otherwise be cancelled by the navigation', () => {
    const { a, sent } = wired()
    a.track('ticket_click', { entity: { kind: 'tour_date', id: 'aa-bb', label: 'Navy Pier' } })
    expect(sent()[0].init.keepalive).toBe(true)
  })

  it('an entity rides along, label included only when there is one', () => {
    const { a, sent } = wired()
    a.track('play', { entity: { kind: 'track', id: 't-1', label: 'Navy Pier' } })
    a.track('buy_click', { entity: { kind: 'merch', id: 'm-1' } })
    a.track('link_click', { label: 'TikTok' })
    expect(sent().map((c) => ({ entity: c.body.entity, label: c.body.label }))).toEqual([
      // An entity's own label is lifted to the top level too, so `target` is one column.
      { entity: { kind: 'track', id: 't-1', label: 'Navy Pier' }, label: 'Navy Pier' },
      { entity: { kind: 'merch', id: 'm-1' }, label: undefined },
      // CRITICAL: no row to point at, but the click still has a name. Skeen's social icons,
      // mailto links and checkout button are all of this shape.
      { entity: undefined, label: 'TikTok' },
    ])
  })

  it('every registered event type can be reported', () => {
    const { a, sent } = wired()
    for (const { type } of TS_TYPES) a.track(type as EventType)
    expect(sent().map((c) => c.body.type)).toEqual(TS_TYPES.map((e) => e.type))
  })

  it('a trailing slash on the project URL does not become a double slash', () => {
    const { a, sent } = wired({}, { ...CONFIG, supabaseUrl: 'https://proj.supabase.co/' })
    a.pageview()
    expect(sent()[0].url).toBe('https://proj.supabase.co/functions/v1/event')
  })

  it('a missing referrer is sent as an empty string, never undefined', () => {
    const { a, sent } = wired({ referrer: () => '' })
    a.pageview()
    expect(sent()[0].body.referrer).toBe('')
  })
})

describe('what never goes on the wire', () => {
  it('CRITICAL: the editor shell reports nothing — a manager editing their own site is not a visit', () => {
    for (const pathname of ['/edit', '/edit/tour']) {
      const { a, fetchSpy } = wired({ location: { href: `https://skeenmusic.com${pathname}`, pathname } })
      a.pageview()
      a.track('play', { entity: { kind: 'track', id: 't-1' } })
      expect(fetchSpy, pathname).not.toHaveBeenCalled()
    }
  })

  it('/editorial is a real page, not the editor', () => {
    const { a, fetchSpy } = wired({ location: { href: 'https://skeenmusic.com/editorial', pathname: '/editorial' } })
    a.pageview()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: a site with no config renders and reports nothing instead of throwing', () => {
    for (const config of [null, {}, { slug: 'skeen' }, { supabaseUrl: 'x', anonKey: '' , slug: 's' }]) {
      const { a, fetchSpy } = wired({}, config as Partial<typeof CONFIG>)
      expect(() => {
        a.pageview()
        a.track('play')
        a.listen(document)()
      }, JSON.stringify(config)).not.toThrow()
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  })

  it('CRITICAL: a rejected or blocked send never reaches the fan — no throw, no unhandled rejection', async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error('blocked by the client')))
    const a1 = createAnalytics(CONFIG, { fetch: rejecting as unknown as typeof fetch, location: LOC, referrer: () => '' })
    expect(() => a1.pageview()).not.toThrow()
    const throwing = vi.fn(() => { throw new Error('CSP') })
    const a2 = createAnalytics(CONFIG, { fetch: throwing as unknown as typeof fetch, location: LOC, referrer: () => '' })
    expect(() => a2.pageview()).not.toThrow()
    await Promise.resolve()
  })
})

describe('data attributes, the seam for server-rendered elements', () => {
  it('round-trip: what trackAttrs writes, readTrackAttrs reads back', () => {
    const entity = { kind: 'video' as const, id: 'v-1', label: 'Live at the Pier' }
    expect(trackAttrs('video_click', { entity })).toEqual({
      'data-track': 'video_click',
      'data-entity-kind': 'video',
      'data-entity-id': 'v-1',
      'data-label': 'Live at the Pier',
    })
    // The DOM presents them camel-cased on `dataset`.
    expect(readTrackAttrs({ track: 'video_click', entityKind: 'video', entityId: 'v-1', label: 'Live at the Pier' }))
      .toEqual({ type: 'video_click', opts: { entity, label: 'Live at the Pier' } })
  })
  it('an event with no entity writes only the type, or the type and a label', () => {
    expect(trackAttrs('link_click')).toEqual({ 'data-track': 'link_click' })
    expect(readTrackAttrs({ track: 'link_click' })).toEqual({ type: 'link_click', opts: {} })
    expect(trackAttrs('link_click', { label: 'TikTok' })).toEqual({ 'data-track': 'link_click', 'data-label': 'TikTok' })
    expect(readTrackAttrs({ track: 'link_click', label: 'TikTok' })).toEqual({ type: 'link_click', opts: { label: 'TikTok' } })
  })
  it('CRITICAL: a malformed attribute is dropped, never guessed into a mystery row', () => {
    expect(readTrackAttrs({})).toBeNull()
    expect(readTrackAttrs({ track: 'pageview' })).toBeNull() // not a registered type
    // A half-written entity degrades to a site-level event rather than inventing an id —
    // the door rejects a non-uuid, and a reader could never explain an invented one.
    expect(readTrackAttrs({ track: 'play', entityKind: 'track' })).toEqual({ type: 'play', opts: {} })
    expect(readTrackAttrs({ track: 'play', entityId: 't-1' })).toEqual({ type: 'play', opts: {} })
    expect(readTrackAttrs({ track: 'play', entityKind: 'artist', entityId: 't-1' })).toEqual({ type: 'play', opts: {} })
    // …but its label survives, so the click is still named.
    expect(readTrackAttrs({ track: 'play', entityKind: 'artist', entityId: 't-1', label: 'Navy Pier' }))
      .toEqual({ type: 'play', opts: { label: 'Navy Pier' } })
  })
})

describe('the delegated listener', () => {
  // A detached document has no defaultView, so these use the ambient one and clear it after.
  afterEach(() => { document.body.innerHTML = '' })
  const click = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

  it('reports a click on a tracked element, from the element itself or from a child, and stops when unsubscribed', () => {
    const { a, sent } = wired()
    const attrs = Object.entries(trackAttrs('ticket_click', { entity: { kind: 'tour_date', id: 'd-1', label: 'Navy Pier' } }))
      .map(([k, v]) => `${k}="${v}"`).join(' ')
    document.body.innerHTML = `<a id="outer" ${attrs}><span id="inner">Tickets</span></a><button id="untracked">Menu</button>`
    const stop = a.listen(document)

    click('inner')
    click('untracked')
    expect(sent(), 'an untracked element reported, or a click on a child did not').toHaveLength(1)
    expect(sent()[0].body).toMatchObject({ type: 'ticket_click', entity: { kind: 'tour_date', id: 'd-1', label: 'Navy Pier' } })

    click('outer')
    expect(sent()).toHaveLength(2)

    stop()
    click('outer')
    expect(sent(), 'the returned unsubscribe did not remove the listener').toHaveLength(2)
  })

  it('CRITICAL: a handler calling stopPropagation still gets counted — the listener is capture-phase', () => {
    const { a, sent } = wired()
    document.body.innerHTML = `<div id="carousel"><a id="link" data-track="link_click">Instagram</a></div>`
    document.getElementById('carousel')!.addEventListener('click', (e) => e.stopPropagation())
    const stop = a.listen(document)
    click('link')
    expect(sent()).toHaveLength(1)
    stop()
  })
})

describe('helpers', () => {
  it('isEditShell', () => {
    expect(isEditShell('/edit')).toBe(true)
    expect(isEditShell('/edit/music')).toBe(true)
    expect(isEditShell('/editorial')).toBe(false)
    expect(isEditShell('/')).toBe(false)
  })
  it('isAnalyticsConfigured needs all three', () => {
    expect(isAnalyticsConfigured(CONFIG)).toBe(true)
    expect(isAnalyticsConfigured({ ...CONFIG, slug: '' })).toBe(false)
    expect(isAnalyticsConfigured({ ...CONFIG, anonKey: '' })).toBe(false)
    expect(isAnalyticsConfigured(null)).toBe(false)
  })
  it('eventBody omits the entity key entirely when there is none', () => {
    expect(eventBody('s', 'view', {}, { href: 'https://a/b' }, 'r')).toEqual({
      slug: 's', type: 'view', url: 'https://a/b', referrer: 'r',
    })
  })
})
