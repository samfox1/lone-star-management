/**
 * Eventbrite's events become tour dates only when they are public and upcoming, with the right
 * local date, a safe ticket link and a truthful place; and the token never leaks.
 *
 * Code:     src/lib/eventbrite.ts (showFromEvent, createEventbriteClient: listUpcomingShows,
 *           listOrganizations, listOrganizers)
 * Feature:  Connect with Eventbrite: shows pull into Tour as drafts (Sam, 2026-09-28: "users
 *           redirected to the artist's event information via eventbrite")
 * Tier:     STRICT (AGENTS.md "Test depth"): a parser of outside data whose output reaches the
 *           live site and URLs, and it carries a sign-in token.
 * Covers:   • only PUBLIC, UPCOMING events land: live or started, listed, not invite-only, no
 *             password; draft, cancelled, ended and completed never do
 *           • the date is the show's own LOCAL date (9pm in Los Angeles is not "tomorrow")
 *           • the ticket link is the event's https Eventbrite page, or the event is not used
 *           • an online event reads "Online"; no venue yet means no place, not a guess; the
 *             country is written out and a state only counts inside the US
 *           • every id that goes into a path is digits, checked before any request is built
 *           • the client asks for the right events, follows pages to a cap, and says "sign in
 *             again" for a refused token; the token rides in the header only, never a URL or error
 *           • the organizations and organizer pages a signed-in account can pick from
 * Not here: what a pull WRITES to the tour table (tour-pull.test.ts, eventbrite-sync.test.ts); the
 *           sign-in trip (tests/unit/manager-tools/connections/eventbrite-oauth*.test.ts).
 * Fixtures: one realistic Eventbrite event, changed per test; Eventbrite's API is a mocked fetch
 *           that records every request. Nothing leaves the machine.
 */
import { describe, expect, it, vi } from 'vitest'
import { EventbriteApiError, createEventbriteClient, showFromEvent } from '@/lib/eventbrite'

const TOKEN = 'EVENTBRITE-PRIVATE-TOKEN-must-not-leak'
const API = 'https://www.eventbriteapi.com/v3'

const event = (over: Record<string, unknown> = {}) => ({
  id: '801234567890',
  name: { text: 'Skeen live' },
  url: 'https://www.eventbrite.com/e/skeen-live-tickets-801234567890',
  start: { timezone: 'America/Chicago', local: '2026-11-05T20:00:00', utc: '2026-11-06T02:00:00Z' },
  status: 'live',
  listed: true,
  invite_only: false,
  online_event: false,
  venue: {
    name: 'Mohawk',
    latitude: '30.2700',
    longitude: '-97.7400',
    address: { city: 'Austin', region: 'TX', country: 'US', latitude: '30.2700', longitude: '-97.7400' },
  },
  ...over,
})

describe('showFromEvent — which events land, and how', () => {
  // The normal case, in full: a public upcoming event becomes a show with its venue, place, pin
  // and its own Eventbrite page as the ticket link.
  it('CRITICAL: a public upcoming event becomes a show whose ticket link is its Eventbrite page', () => {
    expect(showFromEvent(event())).toEqual({
      externalId: '801234567890',
      values: {
        date: '2026-11-05',
        venue: 'Mohawk',
        city: 'Austin',
        state: 'TX',
        country: 'United States',
        ticket_url: 'https://www.eventbrite.com/e/skeen-live-tickets-801234567890',
        latitude: 30.27,
        longitude: -97.74,
      },
    })
  })

  // Only events that are on sale or under way land; drafts, cancelled and finished events never do.
  it('CRITICAL: draft, cancelled, ended and completed events never land; a started one does', () => {
    for (const status of ['draft', 'canceled', 'cancelled', 'ended', 'completed', '', undefined]) {
      expect(showFromEvent(event({ status })), String(status)).toBeNull()
    }
    expect(showFromEvent(event({ status: 'started' }))).not.toBeNull()
  })

  // A private event (unlisted, invite-only or behind a password) never reaches a public site.
  it('CRITICAL: a private event never lands — unlisted, invite-only, or behind a password', () => {
    expect(showFromEvent(event({ listed: false }))).toBeNull()
    expect(showFromEvent(event({ invite_only: true }))).toBeNull()
    expect(showFromEvent(event({ password: 'letmein' }))).toBeNull()
    // An empty password is no password.
    expect(showFromEvent(event({ password: '' }))).not.toBeNull()
    // Absent flags are the public default.
    expect(showFromEvent(event({ listed: undefined, invite_only: undefined }))).not.toBeNull()
  })

  // The date is the show's own local day, whether Eventbrite sends the local time or only UTC
  // and a timezone: a 9pm show in Los Angeles is not listed on the next day.
  it('CRITICAL: the date is the show’s own local date, not UTC’s', () => {
    const la = event({ start: { timezone: 'America/Los_Angeles', local: '2026-11-05T21:00:00', utc: '2026-11-06T05:00:00Z' } })
    expect(showFromEvent(la)!.values.date).toBe('2026-11-05')
    // No local time sent: worked out from UTC in the event's own timezone.
    const utcOnly = event({ start: { timezone: 'America/Los_Angeles', utc: '2026-11-06T05:00:00Z' } })
    expect(showFromEvent(utcOnly)!.values.date).toBe('2026-11-05')
    const tokyo = event({ start: { timezone: 'Asia/Tokyo', utc: '2026-11-05T16:00:00Z' } })
    expect(showFromEvent(tokyo)!.values.date).toBe('2026-11-06')
    // The local start is Eventbrite's own word for the day, and needs no timezone to read.
    expect(showFromEvent(event({ start: { local: '2026-11-05T23:30:00', utc: '2026-11-06T05:30:00Z' } }))!.values.date).toBe('2026-11-05')
  })

  // An event with no start, or an impossible date, is left out: a show without a date is nothing.
  it('an event with no readable start is not used (a date is what a show is)', () => {
    expect(showFromEvent(event({ start: undefined }))).toBeNull()
    expect(showFromEvent(event({ start: { local: 'soon' } }))).toBeNull()
    expect(showFromEvent(event({ start: { local: '2026-13-40T20:00:00' } }))).toBeNull()
    for (const local of ['2026-00-10T20:00:00', '2026-11-00T20:00:00', '2026-11-32T20:00:00', '2026-11-4xT20:00:00', 'on 2026-11-05T20:00:00']) {
      expect(showFromEvent(event({ start: { local, utc: '2026-11-06T02:00:00Z', timezone: 'America/Chicago' } })), local).toBeNull()
    }
    expect(showFromEvent(event({ start: { timezone: 'Not/AZone', utc: '2026-11-06T05:00:00Z' } }))).toBeNull()
  })

  // The ticket link must be an https Eventbrite page (any country's); a look-alike host, plain http
  // or a script link drops the event, because the link goes on the live site.
  it('CRITICAL: the ticket link must be the event’s https Eventbrite page', () => {
    expect(showFromEvent(event({ url: 'https://www.eventbrite.co.uk/e/skeen-live-tickets-1' }))!.values.ticket_url).toBe('https://www.eventbrite.co.uk/e/skeen-live-tickets-1')
    for (const url of ['http://www.eventbrite.com/e/1', 'https://evil.example/eventbrite.com/e/1', 'https://eventbrite.com.evil.net/e/1', 'javascript:alert(1)', '', undefined, 42]) {
      expect(showFromEvent(event({ url })), String(url)).toBeNull()
    }
  })

  // An online event says "Online" and has no city or map pin.
  it('CRITICAL: an online event reads "Online", with no place and no pin', () => {
    const online = showFromEvent(event({ online_event: true, venue: null, venue_id: null }))!
    expect(online.values).toMatchObject({ venue: 'Online', city: null, state: null, country: null, latitude: null, longitude: null })
  })

  // An event whose venue is not set yet has no place at all, rather than a guessed one.
  it('CRITICAL: an event with no venue yet has no place — nothing guessed', () => {
    const tba = showFromEvent(event({ venue: null, venue_id: null }))!
    expect(tba.values).toMatchObject({ venue: null, city: null, state: null, country: null, latitude: null, longitude: null })
    const bare = showFromEvent(event({ venue: { name: '  ', address: null } }))!
    expect(bare.values).toMatchObject({ venue: null, city: null, country: null })
  })

  // Outside the US the country is written out and the state is empty (Western Australia's "WA"
  // is not Washington); a US region that is not a state code is left out too.
  it('outside the US the country is written out and there is no state', () => {
    const london = showFromEvent(event({ venue: { name: 'Lexington', address: { city: 'London', region: 'LND', country: 'GB' } } }))!
    expect(london.values).toMatchObject({ city: 'London', state: null, country: 'United Kingdom' })
    // A US region that is not a state code is not written into the state column (a CHECK).
    const odd = showFromEvent(event({ venue: { name: 'X', address: { city: 'Austin', region: 'Texas', country: 'US' } } }))!
    expect(odd.values.state).toBeNull()
    // Western Australia is "WA" too: a state code only counts inside the US.
    const perth = showFromEvent(event({ venue: { name: 'Rosemount', address: { city: 'Perth', region: 'WA', country: 'AU' } } }))!
    expect(perth.values).toMatchObject({ state: null, country: 'Australia' })
  })

  // The map pin comes from the venue, or from its address when the venue has none; no numbers, no pin.
  it('the pin comes from the venue, or from its address when the venue has none', () => {
    const fromAddress = showFromEvent(event({ venue: { name: 'Mohawk', address: { city: 'Austin', country: 'US', latitude: '30.1', longitude: '-97.1' } } }))!
    expect(fromAddress.values).toMatchObject({ latitude: 30.1, longitude: -97.1 })
    const none = showFromEvent(event({ venue: { name: 'Mohawk', latitude: '', address: { city: 'Austin', country: 'US' } } }))!
    expect(none.values).toMatchObject({ latitude: null, longitude: null })
  })

  // An event id must be digits (it becomes part of a path); anything else, or no event at all, is dropped.
  it('an id that is not digits is not used', () => {
    expect(showFromEvent(event({ id: '../../users/me' }))).toBeNull()
    expect(showFromEvent(event({ id: 801234567890 }))!.externalId).toBe('801234567890')
    expect(showFromEvent(null)).toBeNull()
    expect(showFromEvent('nope')).toBeNull()
  })
})

// ── The client ──────────────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function client(routes: (url: URL) => Response) {
  const calls: { url: URL; init: RequestInit }[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init: init ?? {} })
    return routes(url)
  })
  return { eb: createEventbriteClient({ fetchImpl: fetchImpl as unknown as typeof fetch }), calls }
}

describe('listUpcomingShows', () => {
  // The request asks for exactly this organizer's upcoming, on-sale events, venue included,
  // with the token in the Authorization header only and redirects not followed.
  it('CRITICAL: asks for this organization’s upcoming events by this organizer, venue expanded, token in the header only', async () => {
    const { eb, calls } = client(() => json({ events: [event()], pagination: { has_more_items: false } }))
    const shows = await eb.listUpcomingShows(TOKEN, '111', '222')
    expect(shows.map((s) => s.externalId)).toEqual(['801234567890'])
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(`${url.origin}${url.pathname}`).toBe(`${API}/organizations/111/events/`)
    expect(url.searchParams.get('organizer_filter')).toBe('222')
    expect(url.searchParams.get('time_filter')).toBe('current_future')
    expect(url.searchParams.get('status')).toBe('live,started')
    expect(url.searchParams.get('expand')).toBe('venue')
    expect(url.searchParams.get('order_by')).toBe('start_asc')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
    expect(url.toString()).not.toContain(TOKEN)
    expect(init.redirect).toBe('manual')
  })

  // It reads every page Eventbrite offers and still drops the events that should not land.
  it('CRITICAL: follows the continuation to the last page, and drops what should not land', async () => {
    const { eb, calls } = client((url) =>
      url.searchParams.get('continuation') === 'page2'
        ? json({ events: [event({ id: '3' }), event({ id: '4', status: 'canceled' })], pagination: { has_more_items: false } })
        : json({ events: [event({ id: '1' }), event({ id: '2', listed: false })], pagination: { has_more_items: true, continuation: 'page2' } }),
    )
    const shows = await eb.listUpcomingShows(TOKEN, '111', '222')
    expect(shows.map((s) => s.externalId)).toEqual(['1', '3'])
    expect(calls).toHaveLength(2)
  })

  // A page with no events list, or a broken continuation, ends the list quietly instead of looping.
  it('a page with no events list, or a continuation that is not a string, ends the list quietly', async () => {
    const { eb, calls } = client(() => json({ events: null, pagination: { has_more_items: true, continuation: 42 } }))
    expect(await eb.listUpcomingShows(TOKEN, '111', '222')).toEqual([])
    expect(calls).toHaveLength(1)
  })

  // A maintenance page instead of JSON is reported as a shape error, not a crash.
  it('an answer that is not JSON is a shape error, not a crash', async () => {
    const { eb } = client(() => new Response('<html>maintenance</html>', { status: 200 }))
    await expect(eb.listUpcomingShows(TOKEN, '111', '222')).rejects.toMatchObject({ kind: 'shape' })
  })

  // It stops at 20 pages even if Eventbrite keeps saying there is more.
  it('stops at the page cap even if Eventbrite keeps saying there is more', async () => {
    const { eb, calls } = client(() => json({ events: [], pagination: { has_more_items: true, continuation: 'again' } }))
    await eb.listUpcomingShows(TOKEN, '111', '222')
    expect(calls.length).toBeLessThanOrEqual(20)
  })

  // An organization or organizer id that is not digits is refused before any request is sent.
  it('CRITICAL: an id that is not digits never reaches a URL', async () => {
    const { eb, calls } = client(() => json({ events: [] }))
    await expect(eb.listUpcomingShows(TOKEN, '1/../../users/me', '222')).rejects.toBeInstanceOf(EventbriteApiError)
    await expect(eb.listUpcomingShows(TOKEN, '111', '2?x=1')).rejects.toBeInstanceOf(EventbriteApiError)
    expect(calls).toHaveLength(0)
  })

  // A refused token tells the manager to connect again, and the error never contains the token.
  it('CRITICAL: a refused token says "sign in again", and no error ever carries the token', async () => {
    const { eb } = client(() => json({ error: 'INVALID_AUTH', error_description: `bad token ${TOKEN}`, status_code: 400 }, 400))
    const err = await eb.listUpcomingShows(TOKEN, '111', '222').catch((e) => e)
    expect(err).toBeInstanceOf(EventbriteApiError)
    expect(err.kind).toBe('auth')
    expect(err.message).toMatch(/Connect with Eventbrite again/)
    expect(String(err.message)).not.toContain(TOKEN)
  })

  // Other refusals say the HTTP status and Eventbrite's own UPPER_CASE code and nothing else
  // (never the token, never odd text from the answer); 401 and NO_AUTH mean "sign in again".
  it('other refusals name the status and Eventbrite’s own code, nothing more', async () => {
    const { eb } = client(() => json({ error: 'NOT_AUTHORIZED', error_description: `no ${TOKEN}` }, 403))
    const err = await eb.listUpcomingShows(TOKEN, '111', '222').catch((e) => e)
    expect(err.kind).toBe('http')
    expect(err.message).toContain('403')
    expect(err.message).toContain('NOT_AUTHORIZED')
    expect(err.message).not.toContain(TOKEN)
    const rate = await client(() => json({ error: 'HIT_RATE_LIMIT' }, 429)).eb.listUpcomingShows(TOKEN, '111', '222').catch((e) => e)
    expect(rate.kind).toBe('rate')
    // A bare 401, and a 400 NO_AUTH, are the sign-in too.
    expect((await client(() => new Response('', { status: 401 })).eb.listUpcomingShows(TOKEN, '111', '222').catch((e) => e)).kind).toBe('auth')
    expect((await client(() => json({ error: 'NO_AUTH' }, 400)).eb.listUpcomingShows(TOKEN, '111', '222').catch((e) => e)).kind).toBe('auth')
    // An error field that is not an UPPER_CASE code is not echoed.
    const odd = await client(() => json({ error: 'Bad <b>thing</b>' }, 500)).eb.listUpcomingShows(TOKEN, '111', '222').catch((e) => e)
    expect(odd.message).toBe('Eventbrite refused the request (HTTP 500).')
    const lower = await client(() => json({ error: 'x_NOT_AUTHORIZED_y' }, 500)).eb.listUpcomingShows(TOKEN, '111', '222').catch((e) => e)
    expect(lower.message).toBe('Eventbrite refused the request (HTTP 500).')
  })
})

describe('the artist’s organizations and organizer pages', () => {
  // It lists the account's organizations, keeping only those with digit ids.
  it('lists the organizations the signed-in account belongs to', async () => {
    const { eb, calls } = client(() =>
      json({ organizations: [{ id: '111', name: 'Skeen' }, { id: 'bad/id', name: 'x' }, { id: 112 }, { id: '113x', name: 'y' }], pagination: { has_more_items: false } }),
    )
    expect(await eb.listOrganizations(TOKEN)).toEqual([
      { id: '111', name: 'Skeen' },
      { id: '112', name: '' },
    ])
    expect(calls[0].url.pathname).toBe('/v3/users/me/organizations/')
  })

  // It lists an organization's organizer pages with their public link, dropping bad ids.
  it('lists an organization’s organizer pages, with their public link', async () => {
    const { eb, calls } = client(() =>
      json({ organizers: [{ id: '222', name: 'Skeen', url: 'https://www.eventbrite.com/o/skeen-222' }, { id: 'x', name: 'bad' }], pagination: { has_more_items: false } }),
    )
    expect(await eb.listOrganizers(TOKEN, '111')).toEqual([{ organizationId: '111', id: '222', name: 'Skeen', url: 'https://www.eventbrite.com/o/skeen-222' }])
    expect(calls[0].url.pathname).toBe('/v3/organizations/111/organizers/')
  })

  // An organizer link that is not an https Eventbrite page is replaced by the plain
  // eventbrite.com/o/<id> page, so a hostile link never reaches the Connections page.
  it('an organizer link that is not an https Eventbrite page becomes the plain /o/<id> page', async () => {
    const { eb } = client(() =>
      json({ organizers: [{ id: '222', name: 'Skeen', url: 'https://evil.example/o/222' }, { id: 333, name: 'B' }, { id: '444', url: 'http://www.eventbrite.com/o/444' }, { id: '4x' }] }),
    )
    expect((await eb.listOrganizers(TOKEN, '111')).map((o) => [o.id, o.url])).toEqual([
      ['222', 'https://www.eventbrite.com/o/222'],
      ['333', 'https://www.eventbrite.com/o/333'],
      ['444', 'https://www.eventbrite.com/o/444'],
    ])
  })
})
