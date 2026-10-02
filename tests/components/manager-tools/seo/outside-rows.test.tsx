// @vitest-environment jsdom
/**
 * The Profiles tab's Discogs and Wikidata rows show what the check found, and open a card with
 * the link and the one thing to do.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/outside-rows.tsx
 * Feature:  SEO / GEO page · Profiles tab · the Discogs and Wikidata rows (VISIBILITY_TOOLKIT.md
 *           "Round 3")
 * Tier:     LIGHT (AGENTS.md "Test depth"): the rows are new and still moving; one main path per
 *           row. What each check decides is pinned STRICTLY in
 *           tests/unit/manager-tools/seo/outside-profiles.test.ts.
 * Covers:   • Discogs, site missing: the status and the "Data provided by Discogs" link its terms
 *             ask for, on the CLOSED row; then the card's page link and the action
 *           • Wikidata, an item without the MusicBrainz id: the status, then the item link and
 *             what it lists
 *           • no site: each row says so, with nothing to open
 * Not here: how the checks are made (outside-profiles.test.ts); the exact words and layout.
 * Fixtures: the check results are typed by hand in the shapes outside.ts returns; 1230117 is the
 *           real Discogs id of the other "Skeen". The bio card's mark action is mocked (the
 *           rows share its parts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DiscogsRow, WikidataRow } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/outside-rows'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/actions', () => ({ markProfileItemAction: vi.fn(async () => ({ ok: true })) }))

afterEach(cleanup)

describe('the outside rows', () => {
  // A linked Discogs page without the site: the closed row says so beside Discogs' attribution
  // link (the status is Discogs data too), and its card links the page and says what to add.
  it('Discogs: site missing, with the attribution on the closed row, then the page and the action', () => {
    render(<DiscogsRow artistId="a1" check={{ kind: 'missing', id: '1230117', url: 'https://www.discogs.com/artist/1230117' }} />)
    expect(screen.getByRole('button', { name: /Discogs/ }).textContent).toContain('site missing')
    expect(screen.getByRole('link', { name: 'Data provided by Discogs' }).getAttribute('href')).toBe('https://www.discogs.com/')
    fireEvent.click(screen.getByRole('button', { name: /Discogs/ }))
    expect(screen.getByRole('link', { name: 'www.discogs.com/artist/1230117' }).getAttribute('href')).toBe('https://www.discogs.com/artist/1230117')
    expect(screen.getByText('Add your site under Sites on Discogs.')).toBeTruthy()
  })

  // No site to look for: "no site", not "couldn't check", and nothing to open.
  it('no site: both rows say so, with nothing to open', () => {
    render(
      <>
        <DiscogsRow artistId="a1" check={{ kind: 'nosite', id: '1230117', url: 'https://www.discogs.com/artist/1230117' }} />
        <WikidataRow check={{ kind: 'nosite' }} />
      </>,
    )
    expect(screen.getAllByText('no site')).toHaveLength(2)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/couldn’t check|Try again/)).toBeNull()
  })

  // An item that lists the site but not the MusicBrainz id: the row names what's missing, and
  // the card links the item and shows each statement.
  it('Wikidata: item found without the MusicBrainz id, with the item link', () => {
    render(<WikidataRow check={{ kind: 'found', item: 'Q1299', url: 'https://www.wikidata.org/wiki/Q1299', hasSite: true, hasMbid: false }} />)
    fireEvent.click(screen.getByRole('button', { name: /Wikidata/ }))
    expect(screen.getByRole('button', { name: /Wikidata/ }).textContent).toContain('MusicBrainz ID missing')
    expect(screen.getByRole('link', { name: 'www.wikidata.org/wiki/Q1299' }).getAttribute('href')).toBe('https://www.wikidata.org/wiki/Q1299')
    expect(screen.getByText('Listed')).toBeTruthy()
    expect(screen.getByText('Missing')).toBeTruthy()
  })
})
