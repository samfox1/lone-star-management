// Apple Music and Deezer pulls group songs into albums, EPs and singles — and every
// platform finds the release another one already made instead of making a second.
/**
 * Sam, 2026-09-28: "Songs pulled from Apple Music or Deezer never get grouped into albums,
 * EPs or singles. Only Spotify does that." → "Yes, group them", so an artist without
 * Spotify still gets a proper Music page.
 *
 * Real database (RLS-scoped writes as a signed-in manager), fake network: each platform's
 * REAL client runs against a fetch stub that answers with that API's JSON, so the mapping
 * from API shape to rows is exercised end to end and no live API is called. The fixture
 * catalog is Skeen's own shape (read-only, 2026-09-28): an album whose lead song was also
 * released as a single, so two rows share a title AND a length — the case that decides
 * whether a single's copy lands in the album or in its own release.
 *
 * Throwaway artist (AGENTS.md rule 6): created here, dropped here, so the absolute counts
 * below are about a table that genuinely starts empty.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncAppleTracks, syncDeezerTracks, syncSpotifyReleases, syncSpotifyTracks } from '@/lib/sync'
import { createAppleMusicClient } from '@/lib/apple'
import { createDeezerClient } from '@/lib/deezer'
import { createSpotifyClient } from '@/lib/spotify'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'

let artist: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = (await createThrowawayArtist(svc, 'Catalog releases', asA)).id
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artist)
})

afterEach(async () => {
  // Tracks reference releases — tracks first. Safe as a blanket wipe only because the
  // artist was created by this file.
  await svc.from('tracks').delete().eq('artist_id', artist)
  await svc.from('releases').delete().eq('artist_id', artist)
})

function json(body: unknown) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as unknown as Response
}

// ── The catalog, as each platform reports it ──────────────────────────────────────
// Album "Heatwaves" (Intro, Summer Sun, Home Again) and the single "Summer Sun".

/** iTunes lookup: the artist row, then songs. The single's copy is listed FIRST — the
 *  order that crosses the two same-length copies if nothing tells them apart. */
function appleLookup(durations: Partial<Record<string, number>> = {}) {
  const song = (id: number, name: string, ms: number, collectionId: number, collectionName: string, date: string) => ({
    wrapperType: 'track',
    kind: 'song',
    artistId: 42,
    trackId: id,
    trackName: name,
    collectionId,
    collectionName,
    collectionViewUrl: `https://music.apple.com/us/album/x/${collectionId}?i=${id}&uo=4`,
    artworkUrl100: `https://is1.mzstatic.com/image/thumb/${collectionId}/100x100bb.jpg`,
    trackViewUrl: `https://music.apple.com/us/album/x/${collectionId}?i=${id}`,
    trackTimeMillis: durations[name] ?? ms,
    releaseDate: `${date}T12:00:00Z`,
  })
  return {
    resultCount: 5,
    results: [
      { wrapperType: 'artist', artistId: 42, artistName: 'Skeen' },
      song(201, 'Summer Sun', 216_190, 901, 'Summer Sun - Single', '2025-03-21'),
      song(101, 'Intro', 38_160, 900, 'Heatwaves', '2025-05-09'),
      song(102, 'Summer Sun', 216_190, 900, 'Heatwaves', '2025-03-21'),
      song(103, 'Home Again', 200_323, 900, 'Heatwaves', '2025-04-18'),
    ],
  }
}

async function applePull(durations?: Partial<Record<string, number>>) {
  const fetchImpl = vi.fn(async () => json(appleLookup(durations)))
  const apple = createAppleMusicClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, country: 'us' })
  return syncAppleTracks(asA, artist, await apple.getArtistTracks('42'))
}

/** Deezer: the albums list, then each album's tracks (seconds, not ms). */
async function deezerPull() {
  const albums = [
    { id: 701, title: 'Summer Sun', link: 'https://www.deezer.com/album/701', cover_big: 'https://dz/701.jpg', release_date: '2025-03-21', record_type: 'single' },
    { id: 700, title: 'Heatwaves', link: 'https://www.deezer.com/album/700', cover_big: 'https://dz/700.jpg', release_date: '2025-05-09', record_type: 'album' },
  ]
  const tracks: Record<string, unknown[]> = {
    '701': [{ id: 7201, title: 'Summer Sun', duration: 216, link: 'https://www.deezer.com/track/7201' }],
    '700': [
      { id: 7101, title: 'Intro', duration: 38, link: 'https://www.deezer.com/track/7101' },
      { id: 7102, title: 'Summer Sun', duration: 216, link: 'https://www.deezer.com/track/7102' },
      { id: 7103, title: 'Home Again', duration: 200, link: 'https://www.deezer.com/track/7103' },
    ],
  }
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.includes('/artist/42/albums')) return json({ data: albums, next: null })
    const m = /\/album\/(\d+)\/tracks/.exec(url)
    if (m) return json({ data: tracks[m[1]] ?? [], next: null })
    throw new Error(`unexpected Deezer request: ${url}`)
  })
  const deezer = createDeezerClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} })
  return syncDeezerTracks(asA, artist, await deezer.getArtistTracks('42'))
}

/** Spotify: token, the artist's albums, each album's tracks — then the same two steps
 *  the dashboard's pull runs (tracks, then releases). */
async function spotifyPull() {
  const albums = [
    { id: 'sp-alb', name: 'Heatwaves', album_type: 'album', release_date: '2025-05-09', total_tracks: 3, images: [{ url: 'https://sp/alb.jpg' }], external_urls: { spotify: 'https://open.spotify.com/album/sp-alb' } },
    { id: 'sp-sgl', name: 'Summer Sun', album_type: 'single', release_date: '2025-03-21', total_tracks: 1, images: [{ url: 'https://sp/sgl.jpg' }], external_urls: { spotify: 'https://open.spotify.com/album/sp-sgl' } },
  ]
  const tracks: Record<string, unknown[]> = {
    'sp-alb': [
      { id: 'sp-t-intro', name: 'Intro', duration_ms: 38_160, artists: [] },
      { id: 'sp-t-sun-alb', name: 'Summer Sun', duration_ms: 216_190, artists: [] },
      { id: 'sp-t-home', name: 'Home Again', duration_ms: 200_322, artists: [] },
    ],
    'sp-sgl': [{ id: 'sp-t-sun-sgl', name: 'Summer Sun', duration_ms: 216_190, artists: [] }],
  }
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.includes('accounts.spotify.com')) return json({ access_token: 'tok', expires_in: 3600 })
    if (url.includes('/artists/sp-artist/albums')) return json({ items: albums, next: null })
    const m = /\/albums\/([^/]+)\/tracks/.exec(url)
    if (m) return json({ items: tracks[m[1]] ?? [], next: null })
    throw new Error(`unexpected Spotify request: ${url}`)
  })
  const spotify = createSpotifyClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} })
  const { tracks: t, releases } = await spotify.getDiscography('sp-artist')
  const songs = await syncSpotifyTracks(asA, artist, t)
  const rel = await syncSpotifyReleases(asA, artist, releases)
  return { songs, rel }
}

// ── Reading the result back (service client: row STATE, never a return value) ─────

type ReleaseRow = {
  id: string
  title: string
  slug: string
  source: string
  release_type: string
  release_date: string | null
  cover_url: string | null
  spotify_id: string | null
  on_site: boolean
  links: { label: string; url: string }[]
}
type TrackRow = {
  id: string
  title: string
  release_id: string | null
  release_type: string
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
}

async function releases(): Promise<ReleaseRow[]> {
  const { data, error } = await svc
    .from('releases')
    .select('id, title, slug, source, release_type, release_date, cover_url, spotify_id, on_site, links')
    .eq('artist_id', artist)
    .order('title')
  if (error) throw new Error(error.message)
  return (data ?? []) as ReleaseRow[]
}

async function tracks(): Promise<TrackRow[]> {
  const { data, error } = await svc
    .from('tracks')
    .select('id, title, release_id, release_type, spotify_id, apple_id, deezer_id')
    .eq('artist_id', artist)
  if (error) throw new Error(error.message)
  return (data ?? []) as TrackRow[]
}

/** Release title → the song titles filed under it (sorted), so a grouping reads at a glance. */
async function grouping(): Promise<Record<string, string[]>> {
  const rels = await releases()
  const byId = new Map(rels.map((r) => [r.id, r.title]))
  const out: Record<string, string[]> = {}
  for (const t of await tracks()) {
    const key = t.release_id ? (byId.get(t.release_id) ?? '?') : '(none)'
    ;(out[key] ??= []).push(t.title)
  }
  for (const k of Object.keys(out)) out[k].sort()
  return out
}

const EXPECTED_GROUPING = {
  Heatwaves: ['Home Again', 'Intro', 'Summer Sun'],
  'Summer Sun': ['Summer Sun'],
}

describe('an Apple-only artist gets real releases', () => {
  it('creates the album and the single, off-site, Apple-owned, with the songs filed under them', async () => {
    await applePull()

    const rels = await releases()
    expect(rels).toHaveLength(2)
    const [album, single] = rels
    expect(album).toMatchObject({
      title: 'Heatwaves',
      slug: 'heatwaves',
      source: 'apple',
      release_type: 'album',
      release_date: '2025-05-09', // the LATEST song's date: the album's own drop
      cover_url: 'https://is1.mzstatic.com/image/thumb/900/600x600bb.jpg',
      spotify_id: null,
      on_site: false,
    })
    expect(album.links).toEqual([{ label: 'Apple Music', url: 'https://music.apple.com/us/album/x/900' }])
    expect(single).toMatchObject({ title: 'Summer Sun', source: 'apple', release_type: 'single', release_date: '2025-03-21' })

    expect(await grouping()).toEqual(EXPECTED_GROUPING)
    // The type rides the song too (the Music page reads the song's tag).
    const ts = await tracks()
    expect(ts.filter((t) => t.release_id === album.id).every((t) => t.release_type === 'album')).toBe(true)
    expect(ts.find((t) => t.apple_id === '201')!.release_id).toBe(single.id) // the single's copy, in the single
  })

  it('a second pull finds the same releases — nothing new, nothing moved', async () => {
    await applePull()
    const before = await releases()
    const res = await applePull()
    expect(res.notes).toEqual([])
    const after = await releases()
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id))
    expect(await grouping()).toEqual(EXPECTED_GROUPING)
  })
})

describe('a Deezer-only artist gets real releases', () => {
  it('creates the album and the single, Deezer-owned, with the songs filed under them', async () => {
    await deezerPull()

    const rels = await releases()
    expect(rels.map((r) => [r.title, r.source, r.release_type])).toEqual([
      ['Heatwaves', 'deezer', 'album'],
      ['Summer Sun', 'deezer', 'single'],
    ])
    expect(rels[0]).toMatchObject({ release_date: '2025-05-09', cover_url: 'https://dz/700.jpg', on_site: false })
    expect(rels[0].links).toEqual([{ label: 'Deezer', url: 'https://www.deezer.com/album/700' }])
    expect(await grouping()).toEqual(EXPECTED_GROUPING)
  })

  it('a second pull adds nothing', async () => {
    await deezerPull()
    await deezerPull()
    expect(await releases()).toHaveLength(2)
    expect(await tracks()).toHaveLength(4)
  })
})

describe('one release per album, whichever platform arrives first', () => {
  it('Spotify then Apple: Apple joins the Spotify releases instead of making its own', async () => {
    await spotifyPull()
    const before = await releases()
    await applePull()

    const after = await releases()
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)) // no new release
    expect(after.every((r) => r.source === 'spotify')).toBe(true) // still Spotify's
    expect(await tracks()).toHaveLength(4) // every Apple song stamped onto its Spotify twin
    expect(await grouping()).toEqual(EXPECTED_GROUPING)
    // And each copy went to its OWN twin: the single's Apple copy sits in the single.
    const ts = await tracks()
    expect(ts.find((t) => t.apple_id === '201')!.spotify_id).toBe('sp-t-sun-sgl')
    expect(ts.find((t) => t.apple_id === '102')!.spotify_id).toBe('sp-t-sun-alb')
  })

  it('Apple then Spotify: Spotify finds the Apple releases and stamps its album ids on them', async () => {
    await applePull()
    const before = await releases()
    const { rel } = await spotifyPull()

    const after = await releases()
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id))
    expect(rel).toMatchObject({ added: 0 })
    expect(after.map((r) => [r.title, r.source, r.spotify_id])).toEqual([
      ['Heatwaves', 'apple', 'sp-alb'],
      ['Summer Sun', 'apple', 'sp-sgl'],
    ])
    expect(await tracks()).toHaveLength(4)
    expect(await grouping()).toEqual(EXPECTED_GROUPING)

    // …and a later Spotify pull finds them by that id, still without a second copy.
    await spotifyPull()
    expect((await releases()).map((r) => r.id)).toEqual(before.map((r) => r.id))
  })

  it('Spotify then Deezer: one release per album', async () => {
    await spotifyPull()
    const before = await releases()
    await deezerPull()
    expect((await releases()).map((r) => r.id)).toEqual(before.map((r) => r.id))
    expect(await tracks()).toHaveLength(4)
    expect(await grouping()).toEqual(EXPECTED_GROUPING)
  })

  it('Deezer then Apple: neither has a release id column, and they still meet on the songs', async () => {
    await deezerPull()
    const before = await releases()
    await applePull()
    expect((await releases()).map((r) => r.id)).toEqual(before.map((r) => r.id))
    expect(await tracks()).toHaveLength(4)
    expect(await grouping()).toEqual(EXPECTED_GROUPING)
  })

  it("the joining platform never rewrites the release another platform made", async () => {
    await spotifyPull()
    // The manager renamed Spotify's single; Apple's pull must not "correct" it to its own.
    await svc.from('releases').update({ title: 'Summer Sun (Single)' }).eq('artist_id', artist).eq('spotify_id', 'sp-sgl')
    await applePull()
    const single = (await releases()).find((r) => r.spotify_id === 'sp-sgl')!
    expect(single).toMatchObject({ title: 'Summer Sun (Single)', source: 'spotify', release_type: 'single', cover_url: 'https://sp/sgl.jpg' })
    expect(single.links).toEqual([{ label: 'Spotify', url: 'https://open.spotify.com/album/sp-sgl' }])
  })
})

describe('when the songs cannot meet, the release title still can', () => {
  it('Apple songs too different to merge still land in the Spotify album — and the pull says so', async () => {
    await spotifyPull()
    const before = await releases()
    // Apple's masters run 10s long: the song merge rightly refuses them (a different
    // length is evidence, not missing evidence), so they arrive as new rows.
    const res = await applePull({ Intro: 48_160, 'Summer Sun': 226_190, 'Home Again': 210_323 })

    expect((await releases()).map((r) => r.id)).toEqual(before.map((r) => r.id)) // no second "Heatwaves"
    const g = await grouping()
    expect(g.Heatwaves).toEqual(['Home Again', 'Home Again', 'Intro', 'Intro', 'Summer Sun', 'Summer Sun'])
    // Two releases were joined on their titles alone: named, never silent.
    expect(res.notes).toEqual(
      expect.arrayContaining([
        { title: 'Heatwaves', kind: 'merged-by-title' },
        { title: 'Summer Sun', kind: 'merged-by-title' },
      ]),
    )
  })

  it("a hand-made release is never taken by its title alone — only through its songs", async () => {
    // A manager's own "Heatwaves" with no songs: nothing but a name ties it to Apple's.
    await svc.from('releases').insert({ artist_id: artist, title: 'Heatwaves', slug: 'heatwaves', source: 'manual' })
    await applePull()
    const rels = await releases()
    const named = rels.filter((r) => r.title === 'Heatwaves')
    expect(named.map((r) => [r.source, r.slug]).sort()).toEqual([
      ['apple', 'heatwaves-2'],
      ['manual', 'heatwaves'],
    ])
  })

  it('a hand-made release whose songs the pull merged into IS the release', async () => {
    // Hand-added songs (no lengths) filed under a manual release; Apple's copies merge
    // onto them by title, so the songs themselves say which release this is.
    const { data: manual } = await svc
      .from('releases')
      .insert({ artist_id: artist, title: 'My Heatwaves', slug: 'my-heatwaves', source: 'manual' })
      .select('id')
      .single()
    await svc.from('tracks').insert([
      { artist_id: artist, title: 'Intro', source: 'manual', release_id: manual!.id },
      { artist_id: artist, title: 'Home Again', source: 'manual', release_id: manual!.id },
    ])
    await applePull()
    const rels = await releases()
    expect(rels.map((r) => r.title)).toEqual(['My Heatwaves', 'Summer Sun']) // no Apple "Heatwaves"
    const mine = rels.find((r) => r.id === manual!.id)!
    expect(mine).toMatchObject({ source: 'manual', title: 'My Heatwaves' }) // still the manager's
    expect(mine.links).toEqual([])
    expect((await grouping())['My Heatwaves']).toEqual(['Home Again', 'Intro', 'Summer Sun'])
  })
})

describe("a manager's edits survive a re-pull", () => {
  it('on-site, slug, links, released, order, a locked type, a moved song and a re-tagged song all stay', async () => {
    await applePull()
    const { data: other } = await svc
      .from('releases')
      .insert({ artist_id: artist, title: 'B-sides', slug: 'b-sides', source: 'manual' })
      .select('id')
      .single()
    const rels = await releases()
    const album = rels.find((r) => r.title === 'Heatwaves')!
    const single = rels.find((r) => r.title === 'Summer Sun')!
    const ts = await tracks()
    const intro = ts.find((t) => t.apple_id === '101')!
    const home = ts.find((t) => t.apple_id === '103')!

    // The manager curates: album on the site under their own slug, their own links in
    // place of the seeded one, marked released and dragged first; the single locked as a
    // remix; Intro moved to B-sides; Home Again re-tagged as a live set.
    await svc
      .from('releases')
      .update({ on_site: true, slug: 'heatwaves-lp', links: [{ label: 'Bandcamp', url: 'https://skeen.bandcamp.com/heatwaves' }], released: true, sort_order: 7 })
      .eq('id', album.id)
    await svc.from('releases').update({ release_type: 'remix', release_type_locked: true }).eq('id', single.id)
    await svc.from('tracks').update({ release_id: other!.id }).eq('id', intro.id)
    await svc.from('tracks').update({ release_type: 'live' }).eq('id', home.id)

    await applePull()

    const { data: a } = await svc.from('releases').select('on_site, slug, links, released, sort_order').eq('id', album.id).single()
    expect(a).toEqual({
      on_site: true,
      slug: 'heatwaves-lp',
      links: [{ label: 'Bandcamp', url: 'https://skeen.bandcamp.com/heatwaves' }], // the Apple link is NOT re-added
      released: true,
      sort_order: 7,
    })
    const { data: s } = await svc.from('releases').select('release_type, release_type_locked').eq('id', single.id).single()
    expect(s).toEqual({ release_type: 'remix', release_type_locked: true })
    const after = await tracks()
    expect(after.find((t) => t.id === intro.id)!.release_id).toBe(other!.id) // the move stands
    expect(after.find((t) => t.id === home.id)!.release_type).toBe('live') // the re-tag stands
    expect((await releases()).length).toBe(3) // nothing duplicated either
  })
})
