// One action runs the sources a manager ticked for a section, and reports each separately.
/**
 * ONE ACTION DISPATCHES A SECTION'S PULLS, AND REPORTS THEM ONE BY ONE.
 *
 * The dialog hands back a section and the keys the manager ticked; this resolves them
 * against the integrations registry and runs each. Per source, deliberately: the old
 * `refreshMusicAction` joined every failure into one string, so "Spotify worked, Apple is
 * not linked" arrived as a single red line with no way to tell which half was which.
 *
 * MERCH IS THE ODD ONE and is meant to be. Shopify is not in `INTEGRATIONS` — it has no
 * artist-id column, it is a connect/disconnect token in Vault (see that registry's
 * header) — so it is resolved by name rather than bent into a shape it does not have.
 */
import { describe, expect, it } from 'vitest'
import { SYNC_SECTIONS, sourcesForSection } from '@/app/artists/[id]/(dashboard)/sync-sections'
import type { SyncSource } from '@/app/artists/[id]/(dashboard)/sync-dialog'
import { INTEGRATIONS } from '@/app/artists/[id]/(dashboard)/integrations'

describe('sourcesForSection — what a page offers to sync', () => {
  it('CRITICAL: music offers exactly the registry’s music integrations', () => {
    // Derived, never hand-listed (AGENTS.md rule 4): a fourth music service added to the
    // registry appears in the dialog without anyone remembering this file.
    const expected = INTEGRATIONS.filter((i) => i.section === 'music').map((i) => i.key)
    expect(expected.length).toBeGreaterThan(1)
    expect(sourcesForSection('music', { spotify_artist_id: 'x' }, false).map((s: SyncSource) => s.key)).toEqual(expected)
  })

  it('CRITICAL: connected state comes from the artist row, per source', () => {
    const rows = sourcesForSection('music', { spotify_artist_id: 'x', apple_artist_id: null }, false)
    expect(rows.find((s: SyncSource) => s.key === 'spotify')?.connected).toBe(true)
    expect(rows.find((s: SyncSource) => s.key === 'apple')?.connected).toBe(false)
  })

  it('CRITICAL: merch offers Shopify, connected from VAULT and not from a column', () => {
    // The registry deliberately excludes Shopify. If this ever read an id field it would
    // report every artist as disconnected, forever, with no error.
    expect(sourcesForSection('merch', {}, true)).toEqual([
      { key: 'shopify', label: 'Shopify', connected: true },
    ])
    expect(sourcesForSection('merch', {}, false)[0].connected).toBe(false)
  })

  it('CRITICAL: every section a page can pass resolves to something', () => {
    // The registry is the list. A section added to the union without sources here is a
    // dialog that opens empty, which reads as "nothing connected" and is a lie.
    for (const section of SYNC_SECTIONS) {
      expect(sourcesForSection(section, {}, false).length, section).toBeGreaterThan(0)
    }
  })

  it('videos and tour resolve to their own registry entries, not music’s', () => {
    // The witness for the section filter: a resolver that ignored `section` would pass
    // the music test above by returning everything.
    expect(sourcesForSection('videos', {}, false).map((s: SyncSource) => s.key)).toEqual(['youtube'])
    expect(sourcesForSection('tour', {}, false).map((s: SyncSource) => s.key)).toEqual(['bandsintown', 'ticketmaster'])
  })
})
