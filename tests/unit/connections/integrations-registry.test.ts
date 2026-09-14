// The data half of the integrations registry: what proves a source pulled, and what counts as connected.
import { describe, expect, it } from 'vitest'
import { INTEGRATION_REGISTRY, TRACK_ID_COLUMN, connectedCount, isConnected, provenBy, type ArtistIdField } from '@/lib/integrations-registry'

describe('provenBy — how a pulled source proves it pulled', () => {
  it('CRITICAL: a music source is proven by its id column, because merged catalogs never carry its `source`', () => {
    // Spotify first, Apple Music second: one row per song, source = spotify, apple_id set.
    // Counting source = apple is 0 forever and reads "couldn’t connect".
    expect(provenBy({ key: 'apple', section: 'music' })).toEqual({ column: 'apple_id', op: 'not-null' })
    expect(provenBy({ key: 'spotify', section: 'music' })).toEqual({ column: 'spotify_id', op: 'not-null' })
  })

  it('everything else is proven by the rows it wrote', () => {
    expect(provenBy({ key: 'bandsintown', section: 'tour' })).toEqual({ column: 'source', op: 'eq', value: 'bandsintown' })
    expect(provenBy({ key: 'youtube', section: 'videos' })).toEqual({ column: 'source', op: 'eq', value: 'youtube' })
  })

  it('CRITICAL: every music integration in the registry has a track column — derived, never hand-listed', () => {
    const music = INTEGRATION_REGISTRY.filter((i) => i.section === 'music').map((i) => i.key)
    expect(music.length).toBeGreaterThan(0)
    for (const k of music) expect(Object.keys(TRACK_ID_COLUMN), k).toContain(k)
    expect(Object.keys(TRACK_ID_COLUMN).sort()).toEqual([...music].sort())
  })
})

describe('connectedCount', () => {
  it('CRITICAL: every configured id counts on its own, plus Shopify from outside the row', () => {
    const all = Object.fromEntries(INTEGRATION_REGISTRY.map((i) => [i.idField, 'x'])) as Record<ArtistIdField, string>
    expect(connectedCount(all, true)).toBe(INTEGRATION_REGISTRY.length + 1)
    expect(connectedCount(all, false)).toBe(INTEGRATION_REGISTRY.length)
    expect(connectedCount({ spotify_artist_id: '26K', apple_artist_id: '1' }, false)).toBe(2)
    expect(connectedCount({}, false)).toBe(0)
  })

  it('an empty string is not connected', () => {
    expect(isConnected({ idField: 'spotify_artist_id' }, { spotify_artist_id: '' })).toBe(false)
    expect(isConnected({ idField: 'spotify_artist_id' }, { spotify_artist_id: null })).toBe(false)
    expect(isConnected({ idField: 'spotify_artist_id' }, { spotify_artist_id: '26K' })).toBe(true)
  })
})
