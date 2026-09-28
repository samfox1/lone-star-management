// The release rules every catalog pull shares: what TYPE a platform's release is, and
// how a flat list of songs folds back into the releases they came from.
/**
 * Sam, 2026-09-28: "Songs pulled from Apple Music or Deezer never get grouped into albums,
 * EPs or singles. Only Spotify does that." → group them. Three platforms now create
 * releases, so the type law has to be ONE law, not three restatements that drift (the
 * music-rules twin ran a reverted rule for four weeks; see packages/music-rules).
 *
 * Pure, so it sits in the mutation slice with the rest of sync-match.
 */
import { describe, expect, it } from 'vitest'
import { classifyRelease, EP_MIN_TRACKS, groupReleases, type CatalogReleaseRef } from '@/lib/sync-match'

describe('classifyRelease — one type law for every platform', () => {
  it('trusts an explicit type when the platform gives one (Apple suffix, Deezer record_type)', () => {
    expect(classifyRelease('album', 1)).toBe('album')
    expect(classifyRelease('ep', 1)).toBe('ep')
    // An explicit single stays a single however many tracks it carries: the count rule is
    // only for a platform that CANNOT tell the two apart.
    expect(classifyRelease('single', 6)).toBe('single')
  })

  it("applies Spotify's count rule where the platform has no EP (a 'single' group of 4+ is an EP)", () => {
    expect(EP_MIN_TRACKS).toBe(4)
    expect(classifyRelease('single-or-ep', 3)).toBe('single')
    expect(classifyRelease('single-or-ep', 4)).toBe('ep')
    expect(classifyRelease('single-or-ep', 9)).toBe('ep')
  })

  it('an unknown track count reads as one track — a single, never an invented EP', () => {
    expect(classifyRelease('single-or-ep', null)).toBe('single')
  })
})

const ref = (id: string, over: Partial<CatalogReleaseRef> = {}): CatalogReleaseRef => ({
  id,
  title: `Release ${id}`,
  release_type: 'album',
  cover_url: `https://img/${id}.jpg`,
  release_date: '2025-01-01',
  url: `https://music.example/album/${id}`,
  ...over,
})

describe('groupReleases — songs back into the releases they came from', () => {
  it('one release per platform album id, carrying its member song ids in order', () => {
    const out = groupReleases([
      { trackId: 't1', release: ref('A') },
      { trackId: 't2', release: ref('B', { release_type: 'single' }) },
      { trackId: 't3', release: ref('A') },
    ])
    expect(out).toEqual([
      {
        externalId: 'A',
        title: 'Release A',
        release_type: 'album',
        cover_url: 'https://img/A.jpg',
        release_date: '2025-01-01',
        url: 'https://music.example/album/A',
        trackIds: ['t1', 't3'],
      },
      {
        externalId: 'B',
        title: 'Release B',
        release_type: 'single',
        cover_url: 'https://img/B.jpg',
        release_date: '2025-01-01',
        url: 'https://music.example/album/B',
        trackIds: ['t2'],
      },
    ])
  })

  it("dates the release by its LATEST song — an album's pre-released singles carry earlier dates", () => {
    // Real iTunes data (Skeen, "Heatwaves & Horizons"): the album tracks released ahead
    // as singles keep their own earlier dates; the album itself dropped on the last one.
    const out = groupReleases([
      { trackId: 't1', release: ref('A', { release_date: '2025-03-21' }) },
      { trackId: 't2', release: ref('A', { release_date: '2025-05-09' }) },
      { trackId: 't3', release: ref('A', { release_date: '2025-04-18' }) },
      { trackId: 't4', release: ref('A', { release_date: null }) },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].release_date).toBe('2025-05-09')
  })

  it('a release no song can date stays undated', () => {
    const out = groupReleases([{ trackId: 't1', release: ref('A', { release_date: null }) }])
    expect(out[0].release_date).toBeNull()
  })

  it('a song with no release (a compilation, an appearance) joins nothing', () => {
    const out = groupReleases([
      { trackId: 't1', release: null },
      { trackId: 't2' },
      { trackId: 't3', release: ref('A') },
    ])
    expect(out.map((r) => [r.externalId, r.trackIds])).toEqual([['A', ['t3']]])
  })

  it('lists a song id once even if the platform repeats it', () => {
    const out = groupReleases([
      { trackId: 't1', release: ref('A') },
      { trackId: 't1', release: ref('A') },
    ])
    expect(out[0].trackIds).toEqual(['t1'])
  })

  it('no songs, no releases', () => {
    expect(groupReleases([])).toEqual([])
  })
})
