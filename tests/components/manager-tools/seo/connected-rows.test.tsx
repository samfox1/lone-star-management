// @vitest-environment jsdom
/**
 * SEO / GEO › Profiles: the connected profiles and MusicBrainz rows, moved there from the Facts
 * tab (2026-10-02, when Facts became the Profile tool). These two cases came with them from
 * facts-tab.test.tsx.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/connected-rows.tsx
 * Feature:  SEO / GEO page · Profiles tab; feeds the `profiles` and `mb` tests (Says who you are)
 * Tier:     LIGHT (AGENTS.md "Test depth"): what the rows say and where they link; nothing saves.
 * Covers:   • how many connected profiles reach the fact card
 *           • MusicBrainz: its own editor, filled in, opens in a new tab; or the linked page
 * Not here: how the links are split (connectedProfiles, src/lib/manager-tools/seo/profiles/connected.ts,
 *           the rules it calls are pinned in tests/unit/manager-tools/connections/).
 * Fixtures: hand-made profile rows and pages.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConnectedRow, MusicBrainzRow } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/connected-rows'

afterEach(cleanup)

const CREATE = 'https://musicbrainz.org/artist/create?edit-artist.name=Skeen'

describe('connected profiles and MusicBrainz', () => {
  // How many connected profiles reach the fact card.
  it('connected profiles: how many reach the fact card', () => {
    render(
      <ConnectedRow
        artistId="a1"
        profiles={[
          { slug: 'spotify', label: 'Spotify', display: 'x', inFactCard: true },
          { slug: 'cash app', label: 'Cash App', display: 'y', inFactCard: false },
        ]}
      />,
    )
    expect(screen.getByText('1 of 2 shown to search engines')).toBeTruthy()
  })
  // No MusicBrainz page: its own editor, filled in with the name, in a new tab.
  it('MusicBrainz offers its own editor, filled in; a linked page shows instead', () => {
    render(<MusicBrainzRow artistId="a1" create={CREATE} />)
    expect(screen.getByText('no page yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /MusicBrainz/ }))
    const create = screen.getByRole('link', { name: 'Create the page' })
    expect(create.getAttribute('href')).toBe(CREATE)
    expect(create.getAttribute('target')).toBe('_blank')
    cleanup()
    render(<MusicBrainzRow artistId="a1" create={CREATE} page={{ display: 'musicbrainz.org/artist/abc', url: 'https://musicbrainz.org/artist/abc' }} />)
    expect(screen.getByText('page linked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /MusicBrainz/ }))
    expect(screen.getByRole('link', { name: /musicbrainz\.org\/artist\/abc/ }).getAttribute('href')).toBe('https://musicbrainz.org/artist/abc')
    expect(screen.queryByRole('link', { name: 'Create the page' })).toBeNull()
  })
})
