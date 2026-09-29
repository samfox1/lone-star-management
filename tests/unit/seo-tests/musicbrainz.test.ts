/**
 * MusicBrainz: "which artist links to this site / these profiles". One request to their
 * public API (many `resource` params at once), their rules kept (a User-Agent with contact,
 * ≤ 1 request a second). Could not ask = `looked: false`, so the test says "couldn't check"
 * and never "MusicBrainz doesn't know you".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupMusicBrainz, musicBrainzForms, resetMusicBrainzGate } from '@/lib/seo-tests/musicbrainz'
import type { SeoKnown } from '@/lib/seo-tests/types'
import { known } from './_page-fixture'

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

describe('musicBrainzForms: the spellings MusicBrainz stores a link under', () => {
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
  it('asks for a site with and without www, http and https, and the trailing slash', () => {
    const forms = musicBrainzForms('https://www.example-artist.com', { site: true })
    expect(forms).toEqual(expect.arrayContaining(['https://www.example-artist.com/', 'https://example-artist.com/', 'http://www.example-artist.com/', 'https://www.example-artist.com']))
  })
  it('gives nothing for junk', () => {
    expect(musicBrainzForms('not a url')).toEqual([])
    expect(musicBrainzForms('javascript:alert(1)')).toEqual([])
  })
})

describe('lookupMusicBrainz', () => {
  it('takes a connected MusicBrainz artist link as the answer, without asking', async () => {
    const k = known({}, { links: [...known().published!.links, { label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${MBID.toUpperCase()}/`, onSite: false }] })
    const f = mbFetch()
    expect(await lookupMusicBrainz(k, { fetcher: f, ...noWait })).toEqual({ looked: true, artistUrl: `https://musicbrainz.org/artist/${MBID}`, matchedOn: 'your MusicBrainz link in Connections', artistName: null })
    expect(f).not.toHaveBeenCalled()
  })
  it('ignores a MusicBrainz link that is not an artist page', async () => {
    const k = known({}, { links: [{ label: 'MusicBrainz', url: `https://musicbrainz.org/release/${MBID}`, onSite: false }] })
    const f = mbFetch({ status: 404, json: { error: 'Not Found' } })
    expect((await lookupMusicBrainz(k, { fetcher: f, ...noWait })).matchedOn).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })
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
  it('finds the artist a profile links to, and says which link found it', async () => {
    const f = mbFetch({ json: { 'url-count': 1, urls: [{ resource: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', relations: [rel(MBID, 'Skeen')] }] } })
    expect(await lookupMusicBrainz(known(), { fetcher: f, ...noWait })).toEqual(expect.objectContaining({
      looked: true, artistUrl: `https://musicbrainz.org/artist/${MBID}`, matchedOn: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', artistName: 'Skeen',
    }))
  })
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
  it('reads the single-link answer shape too', async () => {
    const k = known({ siteUrl: null }, { links: [{ label: 'Spotify', url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', onSite: true }] })
    const f = mbFetch({ json: { resource: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', relations: [rel(MBID, 'Skeen')] } })
    expect((await lookupMusicBrainz(k, { fetcher: f, ...noWait })).artistUrl).toBe(`https://musicbrainz.org/artist/${MBID}`)
  })
  it('ignores links to releases and labels, and ids that are not MusicBrainz ids', async () => {
    const odd = { 'target-type': 'release', type: 'download for free', release: { id: MBID }, artist: { id: MBID, name: 'Skeen' } }
    const f = mbFetch({ json: { urls: [{ resource: 'https://www.example-artist.com/', relations: [rel(MBID, 'OutWest', 'release'), rel(MBID, 'Label', 'label'), rel('not-an-id', 'Skeen'), odd] }] } })
    expect(await lookupMusicBrainz(known(), { fetcher: f, ...noWait })).toEqual(expect.objectContaining({ looked: true, artistUrl: null }))
  })
  it('answers "not known" to a 404 and to an empty list', async () => {
    expect(await lookupMusicBrainz(known(), { fetcher: mbFetch({ status: 404, json: { error: 'Not Found' } }), ...noWait })).toEqual(expect.objectContaining({ looked: true, artistUrl: null, matchedOn: null }))
    expect(await lookupMusicBrainz(known(), { fetcher: mbFetch({ json: { 'url-count': 0, 'url-offset': 0, urls: [] } }), ...noWait })).toEqual(expect.objectContaining({ looked: true, artistUrl: null }))
  })
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
  it('recovers when the second try answers', async () => {
    const f = mbFetch({ status: 503, text: 'busy' }, { json: { urls: [{ resource: 'https://www.example-artist.com/', relations: [rel(MBID, 'Skeen')] }] } })
    expect((await lookupMusicBrainz(known(), { fetcher: f, ...noWait })).artistUrl).toBe(`https://musicbrainz.org/artist/${MBID}`)
  })
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
  it('says "could not ask" for odd answers, a thrown fetch, and other errors', async () => {
    for (const reply of [{ text: 'not json' }, { json: { hello: 'world' } }, { json: [1, 2, 3] }, { status: 500, text: 'oops' }, new Error('network down')] as Reply[]) {
      resetMusicBrainzGate()
      const r = await lookupMusicBrainz(known(), { fetcher: mbFetch(reply, reply), ...noWait })
      expect(r.looked, JSON.stringify(reply)).toBe(false)
      expect(r.error).toBeTruthy()
    }
  })
  it('does not ask with nothing to ask about, or a site that is not public', async () => {
    const f = mbFetch()
    const none: SeoKnown = known({ siteUrl: null }, { links: [] })
    expect(await lookupMusicBrainz(none, { fetcher: f, ...noWait })).toEqual(expect.objectContaining({ looked: false, artistUrl: null }))
    const local: SeoKnown = known({ siteUrl: 'http://localhost:3004' }, { links: [] })
    expect((await lookupMusicBrainz(local, { fetcher: f, ...noWait })).looked).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
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
  it('does not start when the run has already given up', async () => {
    const f = mbFetch()
    const r = await lookupMusicBrainz(known(), { fetcher: f, ...noWait, signal: AbortSignal.abort() })
    expect(r.looked).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('a visual artist is not looked up', () => {
  it('CRITICAL: an artist published as a visual artist asks MusicBrainz nothing (the `mb` test does not apply)', async () => {
    const f = mbFetch()
    const out = await lookupMusicBrainz(known({}, { artistType: 'Person' }), { fetcher: f, ...noWait })
    expect(f).not.toHaveBeenCalled()
    expect(out.looked).toBe(false)
    expect(out.error).toMatch(/visual artist/)
  })
})
