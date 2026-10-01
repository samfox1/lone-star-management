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
 * Covers:   • Discogs, site missing: the status, then the card's page link, the action, and the
 *             "Data provided by Discogs" link its terms ask for
 *           • Wikidata, an item without the MusicBrainz id: the status, then the item link and
 *             what it lists
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
  // A linked Discogs page without the site: the row says so, and its card links the page, says
  // what to add, and carries Discogs' attribution link.
  it('Discogs: site missing, with the page, the action and the attribution', () => {
    render(<DiscogsRow artistId="a1" check={{ kind: 'missing', id: '1230117', url: 'https://www.discogs.com/artist/1230117' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Discogs/ }))
    expect(screen.getByRole('button', { name: /Discogs/ }).textContent).toContain('site missing')
    expect(screen.getByRole('link', { name: 'discogs.com/artist/1230117' }).getAttribute('href')).toBe('https://www.discogs.com/artist/1230117')
    expect(screen.getByText('Add your site under Sites on Discogs.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Data provided by Discogs' }).getAttribute('href')).toBe('https://www.discogs.com/')
  })

  // An item that lists the site but not the MusicBrainz id: the row names what's missing, and
  // the card links the item and shows each statement.
  it('Wikidata: item found without the MusicBrainz id, with the item link', () => {
    render(<WikidataRow check={{ kind: 'found', item: 'Q1299', url: 'https://www.wikidata.org/wiki/Q1299', hasSite: true, hasMbid: false }} />)
    fireEvent.click(screen.getByRole('button', { name: /Wikidata/ }))
    expect(screen.getByRole('button', { name: /Wikidata/ }).textContent).toContain('MusicBrainz ID missing')
    expect(screen.getByRole('link', { name: 'wikidata.org/wiki/Q1299' }).getAttribute('href')).toBe('https://www.wikidata.org/wiki/Q1299')
    expect(screen.getByText('Listed')).toBeTruthy()
    expect(screen.getByText('Missing')).toBeTruthy()
  })
})
