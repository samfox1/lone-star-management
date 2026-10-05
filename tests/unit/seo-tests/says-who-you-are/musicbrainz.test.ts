/**
 * Proves the "MusicBrainz knows you" test passes only for a MusicBrainz page under the artist's
 * own name, and that the lookup behind it asks MusicBrainz politely, reads its answers
 * carefully, and says "couldn't check" (never "doesn't know you") when it couldn't ask.
 *
 * Code:     src/lib/seo-tests/who.ts (`mb`), src/lib/seo-tests/musicbrainz.ts
 *           (`lookupMusicBrainz`, `musicBrainzForms`)
 * Feature:  SEO test `mb` · Test tab "Says who you are"
 * Tier:     STRICT (AGENTS.md "Test depth"): it calls an outside service with addresses taken
 *           from the artist's data and parses the answer; a wrong answer is advice to create a
 *           page on another site.
 * Covers:   • the test: a page found passes; none is a fail with a pre-filled create link; a
 *             page under another name, or a Connections link that goes nowhere, fails;
 *             couldn't ask is unknown; a visual artist is `na`
 *           • the lookup: each link spelled the way MusicBrainz stores it; ONE request for the
 *             site and the three strongest profiles, with a real User-Agent; a connected
 *             MusicBrainz link is opened instead
 *           • MusicBrainz's rules kept: one request a second, one retry after 503 / 429
 *             (Retry-After honoured, capped)
 *           • odd answers, a thrown fetch, a private site or nothing to ask: `looked: false`
 * Not here: the create-page link builder (tests/unit/manager-tools/connections/musicbrainz-seed.test.ts);
 *           a hostile profile link timed (tests/unit/safe-fetching/slow-parsers.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (`known`, `evidence`); `mbFetch` fakes MusicBrainz's replies in
 *           order and records what was asked; `noWait` makes the one-a-second gate instant.
 *           Nothing reaches the network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupMusicBrainz, musicBrainzForms, resetMusicBrainzGate } from '@/lib/seo-tests/musicbrainz'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import type { SeoEvidence, SeoKnown } from '@/lib/seo-tests/types'
import { evidence, expectPlainWords, known, rowOf } from '@tests/helpers/seo/page-fixture'

const MBID = 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d'
const OTHER = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3'
const rel = (id: string, name: string, targetType = 'artist') => ({ 'target-type': targetType, type: 'free streaming', direction: 'backward', [targetType]: { id, name } })

type Reply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | Error
function mbFetch(...replies: Reply[]) {
  const queue = [...replies]
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const r = queue.shift()
    if (!r) throw new Error(`no more replies (asked ${String(input)})`)
    if (r instanceof Error) throw r
    const body = r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json))
    return new Response(body, { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.headers } })
  })
}
const asked = (f: ReturnType<typeof mbFetch>, call = 0) => new URL(String(f.mock.calls[call][0]))
const noWait = { now: () => 0, sleep: vi.fn(async () => {}) }

beforeEach(() => resetMusicBrainzGate())

describe('the MusicBrainz test', () => {
  const m = WHO_TESTS.mb
  const found = (over: Partial<SeoEvidence['musicbrainz']> = {}): SeoEvidence['musicbrainz'] => ({ looked: true, artistUrl: `https://musicbrainz.org/artist/${MBID}`, matchedOn: 'https://www.example-artist.com/', artistName: 'Skeen', ...over })

  // The one exact-wording check: a page under your name passes, and the details show the page and which address found it.
  it('passes when MusicBrainz has a page under your name', () => {
    const r = m(evidence({ musicbrainz: found() }))
    expect(r.status).toBe('pass')
    expect(r.sentence).toBe('MusicBrainz has a page for you.')
    expect(rowOf(r, 'MusicBrainz page')).toMatch(/musicbrainz\.org\/artist\/b10bbbfc/)
    expect(rowOf(r, 'found by')).toMatch(/example-artist\.com/)
    expectPlainWords(r)
  })

  // An answer that came from the manager's own Connections link is labelled as Tapir's, not as a lookup.
  it('labels an answer from the Connections link as Digital Tapir’s', () => {
    const r = m(evidence({ musicbrainz: found({ matchedOn: 'your MusicBrainz link in Connections', fromConnections: true }) }))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'in Digital Tapir: found by')).toMatch(/Connections/)
  })

  // MusicBrainz answered and knows no artist: a fail with a create link on musicbrainz.org, pre-filled with the name.
  it('fails with no page, offering a pre-filled create link', () => {
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: null, matchedOn: null, asked: ['https://www.example-artist.com/'] } }))
    expect(r.status).toBe('fail')
    expect(r.action?.kind).toBe('outside')
    const href = r.action && r.action.kind === 'outside' ? r.action.href : ''
    expect(href).toMatch(/^https:\/\/musicbrainz\.org\/artist\/create\?/)
    expect(new URL(href).searchParams.get('edit-artist.name')).toBe('Skeen')
    expectPlainWords(r)
  })

  // A page linked to your addresses under ANOTHER name is not "a page for you", and the sentence names it. (verify-found M1)
  it('fails a page under another name', () => {
    const r = m(evidence({ musicbrainz: found({ artistUrl: 'https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711', matchedOn: 'https://open.spotify.com/artist/x', artistName: 'Radiohead' }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/Radiohead/)
  })

  // A Connections link MusicBrainz has no artist for fails, and points back to Connections to fix the link. (verify-found M2)
  it('fails a Connections link that goes nowhere', () => {
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: null, matchedOn: 'your MusicBrainz link in Connections', fromConnections: true } }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('link goes nowhere')
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'connections' }))
  })

  // Could not ask (MusicBrainz busy): "couldn't check" with the reason, never a fail.
  it('is unknown when we could not ask, saying why', () => {
    const r = m(evidence({ musicbrainz: { looked: false, artistUrl: null, matchedOn: null, error: 'MusicBrainz was busy (503)' } }))
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/busy/)
  })

  // CRITICAL: MusicBrainz lists people who make music, so for a visual artist the test does not apply, and never offers "Create the page".
  it('does not apply to a visual artist', () => {
    const person = known({}, { artistType: 'Person' })
    for (const musicbrainz of [{ looked: true, artistUrl: null, matchedOn: null }, { looked: false, artistUrl: null, matchedOn: null, error: 'x' }]) {
      const r = m(evidence({ known: person, musicbrainz }))
      expect(r.status).toBe('na')
      expect(r.sentence).toMatch(/visual artist/)
      expect(r.action).toBeUndefined()
    }
  })
})

describe('spelling a link the way MusicBrainz stores it', () => {
  // MusicBrainz looks a link up by its exact spelling: each platform is cleaned the way its own editor stores it, or the lookup misses a real page.
  it('cleans each platform the way MusicBrainz’s own editor does', () => {
    expect(musicBrainzForms('https://open.spotify.com/intl-de/artist/26KxuQlgIw8VP8YX2IkMWR?si=abc')[0]).toBe('https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR')
    expect(musicBrainzForms('https://instagram.com/skeeeeeeen?igsh=x')[0]).toBe('https://www.instagram.com/skeeeeeeen/')
    expect(musicBrainzForms('https://music.apple.com/no/artist/skeen/1754431714')[0]).toBe('https://music.apple.com/no/artist/1754431714')
    expect(musicBrainzForms('https://music.apple.com/artist/skeen/1754431714')[0]).toBe('https://music.apple.com/us/artist/1754431714')
    expect(musicBrainzForms('https://www.soundcloud.com/user-818426052/')[0]).toBe('https://soundcloud.com/user-818426052')
    expect(musicBrainzForms('https://x.com/Skeenmusic')[0]).toBe('https://twitter.com/Skeenmusic')
    expect(musicBrainzForms('https://tiktok.com/@skeen200?lang=en')[0]).toBe('https://www.tiktok.com/@skeen200')
    expect(musicBrainzForms('https://youtube.com/@Sskeen/videos')[0]).toBe('https://www.youtube.com/@Sskeen')
    expect(musicBrainzForms('https://skeen.bandcamp.com/music')[0]).toBe('https://skeen.bandcamp.com/')
    expect(musicBrainzForms('https://deezer.com/us/artist/123')[0]).toBe('https://www.deezer.com/artist/123')
  })

  // A homepage is stored as the editor typed it, so every common spelling of the site is asked about.
  it('asks for a site with and without www, http and https, and the trailing slash', () => {
    const forms = musicBrainzForms('https://www.example-artist.com', { site: true })
    expect(forms).toEqual(expect.arrayContaining(['https://www.example-artist.com/', 'https://example-artist.com/', 'http://www.example-artist.com/', 'https://www.example-artist.com']))
  })

  // Junk and script links give nothing to ask about, never a request.
  it('gives nothing for junk', () => {
    expect(musicBrainzForms('not a url')).toEqual([])
    expect(musicBrainzForms('javascript:alert(1)')).toEqual([])
  })
})

describe('a MusicBrainz link from Connections is opened, not trusted', () => {
  /** A MusicBrainz artist link the manager connected (upper-case id, trailing slash: how people paste it). */
  const connected = () => known({}, { links: [...known().published!.links, { label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${MBID.toUpperCase()}/`, onSite: false }] })

  // A connected artist link is opened once, at MusicBrainz's artist address, and the name there is reported for the test to compare: it used to pass unopened, a made-up id too. (verify-found M2)
  it('opens a connected artist link once and reports the name there', async () => {
    const f = mbFetch({ json: { id: MBID, name: 'Skeen', type: 'Person' } })
    expect(await lookupMusicBrainz(connected(), { fetcher: f, ...noWait })).toEqual({
      looked: true, artistUrl: `https://musicbrainz.org/artist/${MBID}`, matchedOn: 'your MusicBrainz link in Connections', artistName: 'Skeen', fromConnections: true,
    })
    expect(f).toHaveBeenCalledTimes(1)
    const u = asked(f)
    expect(u.origin + u.pathname).toBe(`https://musicbrainz.org/ws/2/artist/${MBID}`)
    expect(u.searchParams.get('fmt')).toBe('json')
  })

  // A connected link MusicBrainz has no artist for (404) is "no page", marked as coming from Connections. (verify-found M2)
  it('answers "no page" for a connected link MusicBrainz doesn’t have', async () => {
    const r = await lookupMusicBrainz(connected(), { fetcher: mbFetch({ status: 404, json: { error: 'Not Found' } }), ...noWait })
    expect(r).toEqual(expect.objectContaining({ looked: true, artistUrl: null, fromConnections: true }))
  })

  // Could not open the connected link (thrown, busy twice, an odd answer) is "could not ask", never a pass. (verify-found M2)
  it('says "could not ask" when the connected link can’t be opened', async () => {
    expect((await lookupMusicBrainz(connected(), { fetcher: mbFetch(new Error('down')), ...noWait })).looked).toBe(false)
    resetMusicBrainzGate()
    expect((await lookupMusicBrainz(connected(), { fetcher: mbFetch({ status: 503, text: '' }, { status: 503, text: '' }), ...noWait })).looked).toBe(false)
    resetMusicBrainzGate()
    expect((await lookupMusicBrainz(connected(), { fetcher: mbFetch({ json: { hello: 1 } }), ...noWait })).looked).toBe(false)
  })

  // A MusicBrainz link to a release is not an artist page: it is not opened, and the normal lookup runs instead.
  it('ignores a MusicBrainz link that is not an artist page', async () => {
    const k = known({}, { links: [{ label: 'MusicBrainz', url: `https://musicbrainz.org/release/${MBID}`, onSite: false }] })
    const f = mbFetch({ status: 404, json: { error: 'Not Found' } })
    expect((await lookupMusicBrainz(k, { fetcher: f, ...noWait })).matchedOn).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('asking about the site and profiles', () => {
  // ONE request covers the site and the three strongest profiles (Instagram and TikTok rank lower, a mailto is not a link), with the User-Agent MusicBrainz asks for.
  it('asks once, for the site and the three strongest profiles, with a real User-Agent', async () => {
    const f = mbFetch({ status: 404, json: { error: 'Not Found' } })
    const k = known({}, {
      links: [
        { label: 'TikTok', url: 'https://tiktok.com/@skeen200', onSite: true },
        { label: 'Instagram', url: 'https://instagram.com/skeeeeeeen', onSite: true },
        { label: 'Spotify', url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', onSite: true },
        { label: 'Apple Music', url: 'https://music.apple.com/no/artist/skeen/1754431714', onSite: false },
        { label: 'Bandcamp', url: 'https://skeen.bandcamp.com/', onSite: false },
        { label: 'Booking', url: 'mailto:x@example.com', onSite: true },
      ],
    })
    const r = await lookupMusicBrainz(k, { fetcher: f, ...noWait })
    expect(f).toHaveBeenCalledTimes(1)
    const u = asked(f)
    expect(u.origin + u.pathname).toBe('https://musicbrainz.org/ws/2/url')
    expect(u.searchParams.get('inc')).toBe('artist-rels')
    expect(u.searchParams.get('fmt')).toBe('json')
    const resources = u.searchParams.getAll('resource')
    expect(resources).toContain('https://www.example-artist.com/')
    expect(resources).toContain('https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR')
    expect(resources).toContain('https://music.apple.com/no/artist/1754431714')
    expect(resources).toContain('https://skeen.bandcamp.com/')
    expect(resources.some((x) => /instagram|tiktok/.test(x))).toBe(false)
    expect(resources.length).toBeLessThanOrEqual(100)
    const ua = new Headers((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('user-agent')
    expect(ua).toMatch(/^\S+\/\d[\d.]* \(.+\)$/)
    expect(r).toEqual(expect.objectContaining({ looked: true, artistUrl: null }))
    expect(r.asked).toEqual(expect.arrayContaining(['https://www.example-artist.com/', 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR']))
  })

  // The artist a profile links to is found, with the link that found it.
  it('finds the artist a profile links to, and says which link found it', async () => {
    const f = mbFetch({ json: { 'url-count': 1, urls: [{ resource: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', relations: [rel(MBID, 'Skeen')] }] } })
    expect(await lookupMusicBrainz(known(), { fetcher: f, ...noWait })).toEqual(expect.objectContaining({
      looked: true, artistUrl: `https://musicbrainz.org/artist/${MBID}`, matchedOn: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', artistName: 'Skeen',
    }))
  })

  // When several artists come back, the site beats a profile and the artist with your name beats another.
  it('prefers the site over a profile, and an artist with the same name over another', async () => {
    const f = mbFetch({
      json: {
        urls: [
          { resource: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', relations: [rel(OTHER, 'Someone Else')] },
          { resource: 'https://www.example-artist.com/', relations: [rel(OTHER, 'Label Person'), rel(MBID, 'SKEEN')] },
        ],
      },
    })
    const r = await lookupMusicBrainz(known(), { fetcher: f, ...noWait })
    expect(r.artistUrl).toBe(`https://musicbrainz.org/artist/${MBID}`)
    expect(r.matchedOn).toBe('https://www.example-artist.com/')
  })

  // One link asked gets a different answer shape: it is read too.
  it('reads the single-link answer shape too', async () => {
    const k = known({ siteUrl: null }, { links: [{ label: 'Spotify', url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', onSite: true }] })
    const f = mbFetch({ json: { resource: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', relations: [rel(MBID, 'Skeen')] } })
    expect((await lookupMusicBrainz(k, { fetcher: f, ...noWait })).artistUrl).toBe(`https://musicbrainz.org/artist/${MBID}`)
  })

  // A release, a label, or an id that is not a MusicBrainz id is not an artist found.
  it('ignores links to releases and labels, and ids that are not MusicBrainz ids', async () => {
    const odd = { 'target-type': 'release', type: 'download for free', release: { id: MBID }, artist: { id: MBID, name: 'Skeen' } }
    const f = mbFetch({ json: { urls: [{ resource: 'https://www.example-artist.com/', relations: [rel(MBID, 'OutWest', 'release'), rel(MBID, 'Label', 'label'), rel('not-an-id', 'Skeen'), odd] }] } })
    expect(await lookupMusicBrainz(known(), { fetcher: f, ...noWait })).toEqual(expect.objectContaining({ looked: true, artistUrl: null }))
  })

  // A 404 and an empty list both mean MusicBrainz looked and knows no artist: `looked` stays true.
  it('answers "not known" to a 404 and to an empty list', async () => {
    expect(await lookupMusicBrainz(known(), { fetcher: mbFetch({ status: 404, json: { error: 'Not Found' } }), ...noWait })).toEqual(expect.objectContaining({ looked: true, artistUrl: null, matchedOn: null }))
    expect(await lookupMusicBrainz(known(), { fetcher: mbFetch({ json: { 'url-count': 0, 'url-offset': 0, urls: [] } }), ...noWait })).toEqual(expect.objectContaining({ looked: true, artistUrl: null }))
  })
})

describe('MusicBrainz’s rules: one request a second, one retry', () => {
  // Busy (503): wait at least a second, ask once more, then give up as "could not ask" with the reason.
  it('waits and asks once more when MusicBrainz is busy (503), then gives up as "could not ask"', async () => {
    const sleep = vi.fn(async () => {})
    const f = mbFetch({ status: 503, text: 'busy' }, { status: 503, text: 'busy' })
    const r = await lookupMusicBrainz(known(), { fetcher: f, now: () => 0, sleep })
    expect(f).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(expect.any(Number))
    expect(Math.max(...sleep.mock.calls.map((c) => (c as unknown as [number])[0]))).toBeGreaterThanOrEqual(1000)
    expect(r).toEqual(expect.objectContaining({ looked: false, artistUrl: null }))
    expect(r.error).toMatch(/busy/)
  })

  // A second try that answers is used.
  it('recovers when the second try answers', async () => {
    const f = mbFetch({ status: 503, text: 'busy' }, { json: { urls: [{ resource: 'https://www.example-artist.com/', relations: [rel(MBID, 'Skeen')] }] } })
    expect((await lookupMusicBrainz(known(), { fetcher: f, ...noWait })).artistUrl).toBe(`https://musicbrainz.org/artist/${MBID}`)
  })

  // Retry-After on a 429 is honoured, but capped at 5 seconds so one answer can't stall a run for an hour.
  it('honours Retry-After on a 429, capped', async () => {
    const sleep = vi.fn(async () => {})
    const f = mbFetch({ status: 429, text: 'slow down', headers: { 'retry-after': '2' } }, { status: 404, json: {} })
    await lookupMusicBrainz(known(), { fetcher: f, now: () => 0, sleep })
    expect(sleep).toHaveBeenCalledWith(2000)
    resetMusicBrainzGate()
    const sleep2 = vi.fn(async () => {})
    await lookupMusicBrainz(known(), { fetcher: mbFetch({ status: 429, text: '', headers: { 'retry-after': '3600' } }, { status: 404, json: {} }), now: () => 0, sleep: sleep2 })
    expect(Math.max(...sleep2.mock.calls.map((c) => (c as unknown as [number])[0]))).toBeLessThanOrEqual(5000)
  })

  // Two lookups in a row wait a second between them: MusicBrainz's limit for everyone on this server.
  it('keeps to one request a second across lookups', async () => {
    let t = 10_000
    const sleep = vi.fn(async (ms: number) => {
      t += ms
    })
    const f = mbFetch({ status: 404, json: {} }, { status: 404, json: {} })
    await lookupMusicBrainz(known(), { fetcher: f, now: () => t, sleep })
    await lookupMusicBrainz(known(), { fetcher: f, now: () => t, sleep })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect((sleep.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(1000)
  })
})

describe('could not ask is never “doesn’t know you”', () => {
  // An answer we can't read, a 500, or a thrown fetch: "could not ask" with a reason, so the test says "couldn't check".
  it('says "could not ask" for odd answers, a thrown fetch, and other errors', async () => {
    for (const reply of [{ text: 'not json' }, { json: { hello: 'world' } }, { json: [1, 2, 3] }, { status: 500, text: 'oops' }, new Error('network down')] as Reply[]) {
      resetMusicBrainzGate()
      const r = await lookupMusicBrainz(known(), { fetcher: mbFetch(reply, reply), ...noWait })
      expect(r.looked, JSON.stringify(reply)).toBe(false)
      expect(r.error).toBeTruthy()
    }
  })

  // Nothing to ask about, or a site on a private address: no request at all.
  it('does not ask with nothing to ask about, or a site that is not public', async () => {
    const f = mbFetch()
    const none: SeoKnown = known({ siteUrl: null }, { links: [] })
    expect(await lookupMusicBrainz(none, { fetcher: f, ...noWait })).toEqual(expect.objectContaining({ looked: false, artistUrl: null }))
    const local: SeoKnown = known({ siteUrl: 'http://localhost:3004' }, { links: [] })
    expect((await lookupMusicBrainz(local, { fetcher: f, ...noWait })).looked).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  // A run that has already given up (aborted) asks nothing.
  it('does not start when the run has already given up', async () => {
    const f = mbFetch()
    const r = await lookupMusicBrainz(known(), { fetcher: f, ...noWait, signal: AbortSignal.abort() })
    expect(r.looked).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  // CRITICAL: an artist published as a visual artist asks MusicBrainz nothing; the `mb` test does not apply to them.
  it('asks nothing for a visual artist', async () => {
    const f = mbFetch()
    const out = await lookupMusicBrainz(known({}, { artistType: 'Person' }), { fetcher: f, ...noWait })
    expect(f).not.toHaveBeenCalled()
    expect(out.looked).toBe(false)
    expect(out.error).toMatch(/visual artist/)
  })
})
