/**
 * music.ts — the Released vs Unreleased derivation (provenance-based, no stored status).
 * A release/track is Unreleased iff it has NO platform presence; a track in a release
 * inherits its release's bucket. This is the single source of truth mirrored by the SQL
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
  it.each(['spotify_id', 'apple_id', 'deezer_id', 'provider_url', 'stream_url', 'apple_url', 'soundcloud_url'] as const)(
    'any platform linkage (%s) makes it released',
    (field) => {
      expect(trackBucket(trk({ [field]: 'v' }))).toBe('released')
    },
  )
})

describe('trackBucket (in a release)', () => {
  it('inherits the release bucket from the resolver', () => {
    const resolver = (id: string): MusicBucket => (id === 'unrel' ? 'unreleased' : 'released')
    expect(trackBucket(trk({ release_id: 'unrel', source: 'spotify' }), resolver)).toBe('unreleased')
    expect(trackBucket(trk({ release_id: 'rel' }), resolver)).toBe('released')
  })
  it('falls back to the track\'s own provenance when the release is unresolvable', () => {
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
