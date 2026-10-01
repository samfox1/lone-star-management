// @vitest-environment jsdom
/**
 * The Profiles tab's Outside bios: a bio whose facts changed after its tick says so, with the
 * date, and its card's tick re-confirms it.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/bio-rows.tsx
 * Feature:  SEO / GEO page · Profiles tab · Outside bios (OUTSIDE_PROFILES_PLAN.md, build step 1)
 * Tier:     LIGHT (AGENTS.md "Test depth"): new UI, one main path. Which state a bio is in is
 *           pinned STRICTLY in tests/unit/manager-tools/seo/bio-state.test.ts.
 * Covers:   • a stale row: "may be out of date since" its date; the card says what changed, links
 *             the edit page in a new tab, and the tick calls the action with bio_<key>
 *           • the server writes no date (its time zone is not the viewer's, and React 19 keeps a
 *             server text node it disagrees with): dates arrive after mount
 * Not here: the states themselves (bio-state.test.ts); the action (profile-marks.test.ts).
 * Fixtures: the row is built by the REAL bio-state functions from Skeen's real Instagram link;
 *           the action is a mock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { OUTSIDE_BIOS } from '@/lib/manager-tools/profiles/bios'
import { bioRows, connectedBios, factChanges } from '@/lib/manager-tools/profiles/bio-state'
import { BioRows } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/bio-rows'
import { markProfileItemAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/actions'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/actions', () => ({ markProfileItemAction: vi.fn(async () => ({ ok: true })) }))

afterEach(cleanup)

/** Instagram, ticked Aug 15; its facts changed Sep 29. */
function staleInstagram() {
  const bios = connectedBios([{ id: 'l6', label: 'Instagram', url: 'https://www.instagram.com/skeeeeeeen/', role: null }], {})
  const changes = factChanges([
    { published_at: '2026-09-29T12:00:00.000Z', data: { name: 'Skeen', bio: 'New bio.', location: 'Detroit' } },
    { published_at: '2026-08-01T12:00:00.000Z', data: { name: 'Skeen', bio: 'Old bio.', location: 'Chicago' } },
  ])
  return bioRows({ bios, marks: { bio_instagram: '2026-08-15T12:00:00.000Z' }, factsKnown: true, changes }, Date.parse('2026-10-01T12:00:00.000Z'))
}

describe('the outside bios', () => {
  // Instagram ticked Aug 15, facts changed Sep 29: the row says so; the card's tick re-confirms bio_instagram.
  it('a stale bio shows the date, says what changed, and the tick re-confirms bio_<key>', async () => {
    render(<BioRows artistId="a1" rows={staleInstagram()} />)

    const row = screen.getByRole('button', { name: /Instagram/ })
    expect(row.textContent).toContain('may be out of date since Sep 29')
    fireEvent.click(row)
    expect(screen.getByText(/Bio and city/)).toBeTruthy()
    const edit = screen.getByRole('link', { name: 'Edit on Instagram' })
    expect(edit.getAttribute('href')).toBe(OUTSIDE_BIOS.find((b) => b.key === 'instagram')!.edit)
    expect(edit.getAttribute('target')).toBe('_blank')
    expect(edit.getAttribute('rel')).toBe('noopener noreferrer')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark as updated' }))
    })
    expect(vi.mocked(markProfileItemAction)).toHaveBeenCalledWith('a1', 'bio_instagram', true)
    expect(screen.getByRole('button', { name: /Instagram/ }).textContent).toMatch(/updated/)
    expect(screen.getByRole('button', { name: /Instagram/ }).textContent).not.toContain('out of date')
  })

  // The server's render carries the state but no date: the date is written in the viewer's zone after mount.
  it('the server writes no date; the browser does', () => {
    const html = renderToString(<BioRows artistId="a1" rows={staleInstagram()} />)
    expect(html).toContain('may be out of date')
    expect(html).not.toContain('Sep')
    render(<BioRows artistId="a1" rows={staleInstagram()} />)
    expect(screen.getByRole('button', { name: /Instagram/ }).textContent).toContain('since Sep 29')
  })
})
