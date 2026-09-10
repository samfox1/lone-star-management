// Where the pure Released/Unreleased rules meet real database columns.
/**
 * The MUSIC PAGE's classification WIRING — the seam where the pure rules in
 * lib/music.ts meet real DB rows.
 *
 * lib/music.ts is well covered, but every one of those tests hands the rules a
 * hand-built object with the right field names already in place. The page is what
 * copies ~14 columns off a `tracks` / `releases` row into those inputs, and NOTHING
 * covered it: mistype a column, or forget one that isn't part of the card type
 * (`provider_url` and `released` are read straight off the row and never stored on
 * MusicSong), and the rule is simply handed `undefined`. It doesn't throw — the song
 * quietly classifies Unreleased and drops off the public site. Same for a dropped
 * `parent_release_id`: the song just stops appearing in its album's tracklist.
 *
 * So this asserts the WIRING, not the rules. The per-column tests give a row exactly
 * ONE piece of platform evidence: if that column doesn't reach the rule, the song
 * lands in the wrong bucket and the case fails on its own.
 *
 * The page is an async Server Component, so it is CALLED, not rendered — the returned
 * element tree carries MusicBrowser's props, which is the whole output of this layer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { listContent } from '@/lib/content'
import { entityCounts, type EntityCounts } from '@/lib/analytics'
import type { ReleaseSong } from '@/app/artists/[id]/(dashboard)/releases/release-card'
import { LOOSE, type MusicSong, type UnreleasedSong } from '@/app/artists/[id]/(dashboard)/music/music-browser'

const ARTIST = 'a1'

type Row = Record<string, unknown>
let releaseRows: Row[] = []
let trackRows: Row[] = []
let counts: EntityCounts = new Map()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})) }))

// _data calls unstable_cache at module scope, so it is replaced outright.
vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({
  requireArtist: vi.fn(async () => ({ id: ARTIST, slug: 'lone-pine', drive_folder_id: null })),
  dashboardDiff: vi.fn(async () => ({ release: { dirty: false }, track: { dirty: false } })),
}))

vi.mock('@/lib/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content')>()),
  listContent: vi.fn(),
}))

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  // Only the DB call is faked; metricValue / daysAgo stay REAL, because which
  // events roll up into a release's stat is part of the wiring under test.
  entityCounts: vi.fn(),
}))

type BrowserProps = {
  releases: (ReleaseSong[] extends never ? never : Record<string, unknown>)[]
  unreleasedReleases: Record<string, unknown>[]
  orphanSingles: (MusicSong & { bucket: string })[]
  unreleasedSongs: UnreleasedSong[]
  releaseOptions: { id: string; title: string }[]
  dirty: boolean
}

/** Call the Server Component and read the props it hands MusicBrowser. */
async function musicProps(): Promise<BrowserProps> {
  vi.mocked(listContent).mockImplementation(async (_sb, type) =>
    (type === 'release' ? releaseRows : trackRows) as never,
  )
  vi.mocked(entityCounts).mockResolvedValue(counts)
  const { default: MusicPage } = await import('@/app/artists/[id]/(dashboard)/music/page')
  const shell = (await MusicPage({ params: Promise.resolve({ id: ARTIST }) })) as ReactElement<{
    children: ReactElement<BrowserProps>
  }>
  return shell.props.children.props
}

/** A `tracks` row with every column the page reads present and inert. */
function track(over: Row = {}): Row {
  return {
    id: 't1',
    title: 'Song',
    source: 'manual',
    cover_url: null,
    stream_url: null,
    audio_path: null,
    release_id: null,
    parent_release_id: null,
    on_site: false,
    spotify_id: null,
    apple_id: null,
    deezer_id: null,
    provider_url: null,
    apple_url: null,
    soundcloud_url: null,
    deezer_url: null,
    release_date: null,
    created_at: '2026-01-01T00:00:00Z',
    release_type: null,
    released: false,
    featured_artists: null,
    ...over,
  }
}

/** A `releases` row with no platform evidence — Unreleased until a column says otherwise. */
function release(over: Row = {}): Row {
  return {
    id: 'r1',
    title: 'Release',
    slug: 'release',
    source: 'manual',
    spotify_id: null,
    links: [],
    released: false,
    cover_url: null,
    release_date: null,
    release_type: null,
    on_site: true,
    ...over,
  }
}

beforeEach(() => {
  releaseRows = []
  trackRows = []
  counts = new Map()
})

describe('track provenance columns reach trackBucket', () => {
  // Each entry is the ONLY platform evidence on an otherwise manual, unlinked song.
  // Drop that column from the page's mapping and the rule sees undefined → Unreleased.
  const EVIDENCE: [string, Row][] = [
    ['source (a synced row)', { source: 'spotify' }],
    ['spotify_id', { spotify_id: 'sp1' }],
    ['apple_id', { apple_id: 'ap1' }],
    ['deezer_id', { deezer_id: 'dz1' }],
    ['provider_url', { provider_url: 'https://youtu.be/x' }],
    ['stream_url', { stream_url: 'https://open.spotify.com/track/x' }],
    ['apple_url', { apple_url: 'https://music.apple.com/x' }],
    ['deezer_url', { deezer_url: 'https://deezer.com/track/x' }],
    ['the manual released flag', { released: true }],
  ]

  // soundcloud_url is NOT in this table any more (Sam, 2026-09-10): a SoundCloud link no
  // longer decides the bucket. It still has to REACH the rule — see the inverse case below,
  // which proves the column is mapped by showing the flag, not the link, is what counts.
  it.each(EVIDENCE)('%s alone classifies the song Released', async (_label, evidence) => {
    trackRows = [track(evidence)]
    const props = await musicProps()
    expect(props.orphanSingles.map((s) => s.id)).toEqual(['t1'])
    expect(props.unreleasedSongs).toEqual([])
  })

  it('CRITICAL: soundcloud_url alone classifies the song UNRELEASED — the flag decides, not the link', async () => {
    // The column still reaches the rule (it feeds badges and links); it just stopped
    // implying release. released:false is the fixture default, so this is Unreleased.
    trackRows = [track({ soundcloud_url: 'https://soundcloud.com/x' })]
    const props = await musicProps()
    expect(props.orphanSingles.map((s) => s.id)).toEqual([])
    expect(props.unreleasedSongs.map((s) => s.id)).toEqual(['t1'])
  })

  it('soundcloud_url + released:true classifies the song Released', async () => {
    trackRows = [track({ soundcloud_url: 'https://soundcloud.com/x', released: true })]
    const props = await musicProps()
    expect(props.orphanSingles.map((s) => s.id)).toEqual(['t1'])
  })

  it('a song with no platform evidence at all stays Unreleased', async () => {
    // The control: without it every case above would pass on a page that hardcoded
    // 'released'.
    trackRows = [track()]
    const props = await musicProps()
    expect(props.orphanSingles).toEqual([])
    expect(props.unreleasedSongs.map((s) => s.id)).toEqual(['t1'])
  })
})

describe('release provenance columns reach releaseBucket', () => {
  const EVIDENCE: [string, Row][] = [
    ['source (a synced row)', { source: 'spotify' }],
    ['spotify_id', { spotify_id: 'sp1' }],
    ['links (non-empty)', { links: [{ label: 'Spotify', url: 'https://open.spotify.com/album/x' }] }],
    ['the manual released flag', { released: true }],
  ]

  it.each(EVIDENCE)('%s alone puts the release in the Released half', async (_label, evidence) => {
    releaseRows = [release(evidence)]
    const props = await musicProps()
    expect(props.releases.map((r) => r.id)).toEqual(['r1'])
    expect(props.unreleasedReleases).toEqual([])
  })

  it('a manual release with no links lands in the Unreleased half', async () => {
    releaseRows = [release()]
    const props = await musicProps()
    expect(props.releases).toEqual([])
    expect(props.unreleasedReleases.map((r) => r.id)).toEqual(['r1'])
  })

  it('release_id inherits the release bucket, so an unlinked song on a Released album is Released', async () => {
    releaseRows = [release({ id: 'r1', spotify_id: 'sp1' })]
    trackRows = [track({ id: 't1', release_id: 'r1' })]
    const props = await musicProps()
    // Parented, so it belongs to the album's tracklist — never a standalone single.
    expect(props.orphanSingles).toEqual([])
    expect(props.unreleasedSongs).toEqual([])
    expect((props.releases[0].songs as ReleaseSong[]).map((s) => s.id)).toEqual(['t1'])
  })
})

describe('orphanSingles — Released AND parentless', () => {
  it('keeps only released songs with no release_id', async () => {
    releaseRows = [release({ id: 'r1', spotify_id: 'sp1' })]
    trackRows = [
      track({ id: 'orphan', stream_url: 'https://open.spotify.com/track/x' }),
      track({ id: 'parented', release_id: 'r1' }),
      track({ id: 'demo' }),
    ]
    const props = await musicProps()
    expect(props.orphanSingles.map((s) => s.id)).toEqual(['orphan'])
  })
})

describe('songsByRelease — union of release_id and parent_release_id, deduped', () => {
  it('files a song under BOTH its home release and its parent', async () => {
    releaseRows = [
      release({ id: 'single', slug: 'single', spotify_id: 'sp1' }),
      release({ id: 'album', slug: 'album', spotify_id: 'sp2' }),
    ]
    trackRows = [track({ id: 't1', release_id: 'single', parent_release_id: 'album' })]
    const props = await musicProps()
    const byId = Object.fromEntries(props.releases.map((r) => [r.id as string, r.songs as ReleaseSong[]]))
    expect(byId.single.map((s) => s.id)).toEqual(['t1'])
    expect(byId.album.map((s) => s.id)).toEqual(['t1'])
  })

  it('CRITICAL: files it ONCE when home and parent are the same release', async () => {
    // A duplicate here double-renders the tracklist row AND double-counts its listens,
    // because the release stat sums over its songs.
    releaseRows = [release({ id: 'r1', spotify_id: 'sp1' })]
    trackRows = [track({ id: 't1', release_id: 'r1', parent_release_id: 'r1' })]
    const props = await musicProps()
    expect((props.releases[0].songs as ReleaseSong[]).map((s) => s.id)).toEqual(['t1'])
  })

  it('a null parent_release_id files nothing under a null key', async () => {
    releaseRows = [release({ id: 'r1', spotify_id: 'sp1' })]
    trackRows = [track({ id: 'loose', stream_url: 'https://x' })]
    const props = await musicProps()
    expect(props.releases[0].songs).toEqual([])
  })
})

describe('column mapping onto the cards', () => {
  it('maps every ReleaseSong field off the row, defaulting featured_artists to []', async () => {
    releaseRows = [release({ id: 'r1', spotify_id: 'sp-al' })]
    trackRows = [
      track({
        id: 't1',
        title: 'Cut',
        release_id: 'r1',
        featured_artists: ['Guest'],
        stream_url: 'https://stream',
        spotify_id: 'sp1',
        apple_id: 'ap1',
        deezer_id: 'dz1',
        apple_url: 'https://apple',
        soundcloud_url: 'https://sc',
        deezer_url: 'https://dz',
        audio_path: 'a1/audio/x.mp3',
      }),
      track({ id: 't2', release_id: 'r1' }),
    ]
    const props = await musicProps()
    const songs = props.releases[0].songs as ReleaseSong[]
    expect(songs[0]).toMatchObject({
      id: 't1',
      title: 'Cut',
      featured_artists: ['Guest'],
      stream_url: 'https://stream',
      spotify_id: 'sp1',
      apple_id: 'ap1',
      deezer_id: 'dz1',
      apple_url: 'https://apple',
      soundcloud_url: 'https://sc',
      deezer_url: 'https://dz',
      audio_path: 'a1/audio/x.mp3',
    })
    expect(songs[1].featured_artists).toEqual([]) // NULL column, not undefined
  })

  it('maps the release card fields, defaulting on_site to true and links to []', async () => {
    releaseRows = [
      release({
        id: 'r1',
        title: 'Album One',
        slug: 'album-one',
        spotify_id: 'sp1',
        cover_url: 'https://cover',
        release_date: '2026-01-02',
        release_type: 'ep',
        links: null,
        on_site: null,
      }),
    ]
    const props = await musicProps()
    expect(props.releases[0]).toMatchObject({
      id: 'r1',
      title: 'Album One',
      slug: 'album-one',
      cover_url: 'https://cover',
      release_date: '2026-01-02',
      release_type: 'ep',
      links: [],
      on_site: true,
    })
  })

  it('carries the song card fields, incl. its OWN release_type (an orphan remix is a Remix)', async () => {
    trackRows = [
      track({
        id: 't1',
        title: 'Remix',
        stream_url: 'https://open.spotify.com/track/x',
        cover_url: 'https://cover',
        release_date: '2026-02-03',
        on_site: true,
        release_type: 'remix',
        created_at: '2026-02-01T00:00:00Z',
      }),
    ]
    const props = await musicProps()
    expect(props.orphanSingles[0]).toMatchObject({
      id: 't1',
      title: 'Remix',
      cover_url: 'https://cover',
      release_date: '2026-02-03',
      on_site: true,
      release_type: 'remix',
      created_at: '2026-02-01T00:00:00Z',
    })
  })

  it('defaults a NULL created_at / on_site rather than passing null through', async () => {
    trackRows = [track({ id: 't1', stream_url: 'https://x', created_at: null, on_site: null })]
    const props = await musicProps()
    expect(props.orphanSingles[0]).toMatchObject({ created_at: '', on_site: false })
  })
})

describe('unreleased grouping', () => {
  it('groups an unreleased song under its release, and loose uploads under LOOSE', async () => {
    releaseRows = [release({ id: 'ep', title: 'Demo EP', slug: 'demo-ep' })]
    trackRows = [track({ id: 'inEp', release_id: 'ep' }), track({ id: 'loose' })]
    const props = await musicProps()
    expect(props.unreleasedSongs).toMatchObject([
      { id: 'inEp', group: 'ep', groupLabel: 'Demo EP' },
      { id: 'loose', group: LOOSE, groupLabel: '' },
    ])
  })
})

describe('release stat rolls up the release AND its songs', () => {
  it('sums the metric over the release id plus every song filed under it', async () => {
    releaseRows = [release({ id: 'r1', spotify_id: 'sp1' })]
    trackRows = [track({ id: 't1', release_id: 'r1' }), track({ id: 't2', release_id: 'r1' })]
    counts = new Map<string, Record<string, number>>([
      ['r1', { play: 2 }],
      ['t1', { play: 3 }],
      ['t2', { link_click: 5 }],
      // Not filed under r1 — pins that the roll-up is scoped to this release's songs.
      ['elsewhere', { play: 100 }],
    ])
    const props = await musicProps()
    expect(props.releases[0].stat).toBe(10)
  })
})

describe('page-level plumbing', () => {
  it('offers EVERY release as a move target, released or not', async () => {
    releaseRows = [release({ id: 'r1', title: 'Album', spotify_id: 'sp1' }), release({ id: 'r2', title: 'Demo EP' })]
    const props = await musicProps()
    expect(props.releaseOptions).toEqual([
      { id: 'r1', title: 'Album' },
      { id: 'r2', title: 'Demo EP' },
    ])
  })

  it('a dirty release OR track diff enables the publish pill', async () => {
    const { dashboardDiff } = await import('@/app/artists/[id]/(dashboard)/_data')
    // Music edits (renames, links) must arm the pill even when the on-site selection
    // is untouched, or an edit strands as a draft.
    vi.mocked(dashboardDiff).mockResolvedValue({ release: { dirty: false }, track: { dirty: true } } as never)
    expect((await musicProps()).dirty).toBe(true)
    vi.mocked(dashboardDiff).mockResolvedValue({ release: { dirty: false }, track: { dirty: false } } as never)
    expect((await musicProps()).dirty).toBe(false)
  })
})
