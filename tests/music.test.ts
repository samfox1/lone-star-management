/**
 * music.ts — the Released vs Unreleased derivation (provenance-based, no stored status).
 * A release/track is Unreleased iff it has NO platform presence; release membership is
 * widen-only (a song is Released if its own provenance OR its release is Released). This
 * is the single source of truth mirrored by the SQL
 * public doors (Released-only). See MUSIC_RESTRUCTURE.md.
 */
import { describe, expect, it } from 'vitest'
import { releaseBucket, trackBucket, trackPlatforms, type MusicBucket, type ReleaseProvenance, type TrackProvenance } from '@/lib/music'

const rel = (o: Partial<ReleaseProvenance> = {}): ReleaseProvenance => ({
  source: 'manual', spotify_id: null, links: [], ...o,
})
const trk = (o: Partial<TrackProvenance> = {}): TrackProvenance => ({
  release_id: null, source: 'manual', audio_path: null, spotify_id: null,
  apple_id: null, deezer_id: null, provider_url: null, stream_url: null, apple_url: null, ...o,
})

describe('releaseBucket', () => {
  it('manual with no platform presence is unreleased', () => {
    expect(releaseBucket(rel())).toBe('unreleased')
  })
  it('a platform source is released', () => {
    expect(releaseBucket(rel({ source: 'spotify' }))).toBe('released')
  })
  it('a spotify_id makes a manual release released', () => {
    expect(releaseBucket(rel({ spotify_id: 'abc' }))).toBe('released')
  })
  it('non-empty DSP links make a manual release released', () => {
    expect(releaseBucket(rel({ links: [{ label: 'Spotify', url: 'https://x' }] }))).toBe('released')
  })
  it('empty links array stays unreleased', () => {
    expect(releaseBucket(rel({ links: [] }))).toBe('unreleased')
  })
})

describe('trackBucket (loose, no release)', () => {
  it('a manual upload with no platform link is unreleased', () => {
    expect(trackBucket(trk({ audio_path: 'a1/x.mp3' }))).toBe('unreleased')
  })
  it('a bare manual track (no audio, no platform) is unreleased', () => {
    expect(trackBucket(trk())).toBe('unreleased')
  })
  it('a platform source is released', () => {
    expect(trackBucket(trk({ source: 'spotify' }))).toBe('released')
  })
  // EVERY platform column trackOnPlatform reads must be listed here. `deezer_url` was
  // missing and its check was mutation-provably dead: deleting it from lib/music.ts left
  // the whole suite green, so a manager-entered Deezer link would silently stop promoting
  // a song to Released.
  it.each([
    'spotify_id', 'apple_id', 'deezer_id', 'provider_url', 'stream_url',
    'apple_url', 'soundcloud_url', 'deezer_url',
  ] as const)(
    'any platform linkage (%s) makes it released',
    (field) => {
      expect(trackBucket(trk({ [field]: 'v' }))).toBe('released')
    },
  )
})

describe('trackBucket (in a release) — widen-only', () => {
  const resolver = (id: string): MusicBucket => (id === 'unrel' ? 'unreleased' : 'released')
  it('a released release promotes an otherwise-unreleased song (album wins)', () => {
    expect(trackBucket(trk({ release_id: 'rel' }), resolver)).toBe('released')
  })
  it('a platform-linked song stays released inside an unreleased release (never demoted)', () => {
    expect(trackBucket(trk({ release_id: 'unrel', source: 'spotify' }), resolver)).toBe('released')
  })
  it('a bare manual song in an unreleased release is unreleased', () => {
    expect(trackBucket(trk({ release_id: 'unrel' }), resolver)).toBe('unreleased')
  })
  it("falls back to the track's own provenance when the release is unresolvable", () => {
    // release_id set but resolver returns undefined → classify by the track's own fields
    expect(trackBucket(trk({ release_id: 'gone', source: 'spotify' }), () => undefined)).toBe('released')
    expect(trackBucket(trk({ release_id: 'gone' }))).toBe('unreleased')
  })
})

describe('trackPlatforms (badge derivation)', () => {
  const ids = { spotify_id: null as string | null, apple_id: null as string | null, deezer_id: null as string | null, apple_url: null as string | null }

  it('no platform ids → no badges', () => {
    expect(trackPlatforms(ids)).toEqual([])
  })
  it('one badge per non-null id, links rebuilt from the id (Apple uses apple_url)', () => {
    expect(trackPlatforms({ ...ids, spotify_id: 'sp1', apple_id: 'ap1', deezer_id: 'dz1', apple_url: 'https://music.apple.com/x' })).toEqual([
      { key: 'spotify', label: 'Spotify', url: 'https://open.spotify.com/track/sp1' },
      { key: 'apple', label: 'Apple', url: 'https://music.apple.com/x' },
      { key: 'deezer', label: 'Deezer', url: 'https://www.deezer.com/track/dz1' },
    ])
  })
  it('an Apple id without a stored apple_url still badges (no link)', () => {
    expect(trackPlatforms({ ...ids, apple_id: 'ap1' })).toEqual([{ key: 'apple', label: 'Apple', url: null }])
  })
})

describe('the manual released flag', () => {
  it('marks a hand-added song (no links) as released', () => {
    expect(trackBucket(trk({ audio_path: 'a1/x.mp3', released: true }))).toBe('released')
  })
  it('defaults to unreleased when absent or false', () => {
    expect(trackBucket(trk({ released: false }))).toBe('unreleased')
    expect(trackBucket(trk())).toBe('unreleased')
  })
})

describe('trackPlatforms — SoundCloud', () => {
  it('badges a stored soundcloud_url', () => {
    expect(
      trackPlatforms({ spotify_id: null, apple_id: null, deezer_id: null, apple_url: null, soundcloud_url: 'https://soundcloud.com/x/y' }),
    ).toEqual([{ key: 'soundcloud', label: 'SoundCloud', url: 'https://soundcloud.com/x/y' }])
  })
})

describe('the manual released flag on releases', () => {
  it('marks a hand-added album/EP (no links) as released; songs inherit', () => {
    expect(releaseBucket(rel({ released: true }))).toBe('released')
    const resolver = (id: string): MusicBucket => (id === 'r1' ? releaseBucket(rel({ released: true })) : 'unreleased')
    expect(trackBucket(trk({ release_id: 'r1' }), resolver)).toBe('released')
  })
  it('defaults to unreleased when absent or false', () => {
    expect(releaseBucket(rel({ released: false }))).toBe('unreleased')
  })
})

/**
 * groupTracksIntoProjects — how the editor's Music panel and the site's grid turn a flat
 * list of songs into PROJECTS. Groups by album name (not release_id, which is unpopulated
 * in practice); an album-less song stands alone; the release row supplies type + date;
 * newest-first.
 */
import { groupTracksIntoProjects, type ProjectTrack, type ReleaseMeta } from '@/lib/music'

// A ProjectTrack: (id, parent release_id | null, title, type, on_site). A null parent = standalone.
const ptrk = (id: string, releaseId: string | null, type = 'single', on: boolean | null = true, title = id): ProjectTrack =>
  ({ id, release_id: releaseId, release_type: type, title, on_site: on })

describe('groupTracksIntoProjects', () => {
  const meta: Record<string, ReleaseMeta> = {
    relHeat: { title: 'Heatwaves & Horizons', release_date: '2025-05-09' },
    relOut: { title: 'OutWest', release_date: '2024-01-26' },
    relYou: { title: 'You Were There', release_date: '2026-02-14' },
  }
  const lookup = (id: string) => meta[id]

  it('groups songs sharing a parent release into one project', () => {
    const p = groupTracksIntoProjects([ptrk('a', 'relOut', 'ep'), ptrk('b', 'relOut', 'ep'), ptrk('c', 'relHeat', 'album')], lookup)
    const out = p.find((x) => x.title === 'OutWest')!
    expect(out.trackIds.sort()).toEqual(['a', 'b'])
    expect(out.releaseType).toBe('ep')
  })

  it('gives an album-less song its OWN one-song project, keyed by track id', () => {
    const p = groupTracksIntoProjects([ptrk('sc1', null), ptrk('sc2', null)], lookup)
    expect(p).toHaveLength(2)
    expect(p.map((x) => x.key).sort()).toEqual(['track:sc1', 'track:sc2'])
    // parent keys live in a disjoint `release:` namespace, so a standalone can never collide.
    const withParent = groupTracksIntoProjects([ptrk('x', 'relOut', 'ep')], lookup)
    expect(withParent[0].key).toBe('release:relOut')
    // No release row → single, no date, titled by fallback.
    expect(p[0].releaseType).toBe('single')
    expect(p[0].releaseDate).toBeNull()
  })

  it('orders projects newest-first, undated last', () => {
    const p = groupTracksIntoProjects(
      [ptrk('a', 'relOut'), ptrk('b', 'relYou'), ptrk('c', 'relHeat'), ptrk('d', null)],
      lookup,
    )
    expect(p.map((x) => x.title)).toEqual(['You Were There', 'Heatwaves & Horizons', 'OutWest', 'd'])
  })

  it('a project is on-site iff ANY of its songs is', () => {
    const p = groupTracksIntoProjects([ptrk('a', 'relOut', 'ep', false), ptrk('b', 'relOut', 'ep', true)], lookup)
    expect(p.find((x) => x.title === 'OutWest')!.anyOnSite).toBe(true)
    const off = groupTracksIntoProjects([ptrk('a', 'relOut', 'ep', false)], lookup)
    expect(off[0].anyOnSite).toBe(false)
  })

  // Pins `t.on_site ?? false`: a null on_site is OFF here. Flipping it to `?? true` was
  // mutation-provably invisible before this test.
  //
  // ASYMMETRY, deliberate: every SQL door does `coalesce(on_site, true)` — null reads as
  // ON there, because a published snapshot with no live row must keep serving. Here a
  // null means "no live row to trust", and the panel must not claim a song is live. The
  // two can't actually diverge (tracks.on_site is NOT NULL), so this pins intent rather
  // than guarding a reachable path.
  it('treats a NULL on_site as off (opposite of the SQL doors coalesce(on_site, true))', () => {
    const p = groupTracksIntoProjects([ptrk('a', 'relOut', 'ep', null)], lookup)
    expect(p[0].anyOnSite).toBe(false)
  })

  it("falls back to the SONG's own title when no release row matches", () => {
    // A parented song with an unknown release id falls back to the song's own title.
    // (Album-name grouping is gone — there is no album name left to fall back to.)
    const p = groupTracksIntoProjects([ptrk('a', 'relUNKNOWN', 'single', true, 'Bootleg Mix')], lookup)
    expect(p[0].title).toBe('Bootleg Mix')
    expect(p[0].releaseType).toBe('single')
  })

  it("takes the project's type from the SONG's tag, not a release row", () => {
    // A standalone SoundCloud remix: no album, no release, tagged remix on the song.
    const p = groupTracksIntoProjects([ptrk('sc', null, 'remix')], lookup)
    expect(p[0].releaseType).toBe('remix')
    expect(p[0].key).toBe('track:sc')
  })
})
