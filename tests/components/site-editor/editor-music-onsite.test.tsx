// @vitest-environment jsdom
// The Music panel lists only what is on the site, not the whole library.
/**
 * THE EDITOR'S MUSIC PANEL SHOWS WHAT IS ON THE SITE.
 *
 * Sam, 2026-09-09, on a panel full of dimmed covers: "items like songs here that have
 * been untallied (dont have the blue check) should be off the panel. i can always re-add
 * them with the add music button."
 *
 * The panel used to list the whole catalogue and dim whatever was off-site, so a manager
 * editing a three-album site scrolled past every demo and every back-catalogue single to
 * find the covers actually on the page. The editor is a view of the SITE; the library
 * lives on the Music page, which is exactly where "Add music" already goes.
 *
 * Turning something off therefore removes it from this panel. That is the intended
 * gesture, not a side effect — the way back is the Music page, and it is one click away
 * at the bottom of the panel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MusicTools } from '@/app/artists/[id]/(dashboard)/editor/panels/music-tools'
import type { EditorProject } from '@/app/artists/[id]/(dashboard)/editor/inspector-types'

afterEach(cleanup)

const project = (over: Partial<EditorProject>): EditorProject => ({
  key: 'release:r', title: 'Untitled', cover_url: null, kind: 'album',
  songs: [{ id: 's1', title: 'One' }], onSite: true, ...over,
})

const covers = () =>
  screen.queryAllByRole('button', { expanded: false }).map((el) => el.getAttribute('aria-label'))

describe('MusicTools — off-site projects are not in the panel', () => {
  it('CRITICAL: an off-site album is gone, an on-site one stays', () => {
    render(
      <MusicTools
        artistId="a1"
        onToggleOnSite={vi.fn()}
        releases={[
          project({ key: 'release:on', title: 'On The Site', onSite: true }),
          project({ key: 'release:off', title: 'Taken Down', onSite: false }),
        ]}
      />,
    )
    expect(screen.getByText('On The Site')).toBeTruthy()
    expect(screen.queryByText('Taken Down'), 'an off-site project is still listed').toBeNull()
  })

  it('CRITICAL: with everything off-site the panel is empty, not a wall of dimmed covers', () => {
    // The state Sam's screenshot was of. The Add link is the whole panel — there is
    // nothing on the site to edit, and saying so is the honest empty state.
    render(
      <MusicTools
        artistId="a1"
        onToggleOnSite={vi.fn()}
        releases={[project({ key: 'release:a', title: 'A', onSite: false }), project({ key: 'release:b', title: 'B', onSite: false })]}
      />,
    )
    expect(screen.queryByText('A')).toBeNull()
    expect(screen.queryByText('B')).toBeNull()
    expect(covers()).toEqual([])
  })

  it('CRITICAL: the way back is always on screen', () => {
    // Removing the toggle from the panel makes this link the ONLY route to an off-site
    // project. It must be there whether the panel is full or empty.
    const { rerender } = render(
      <MusicTools artistId="a1" onToggleOnSite={vi.fn()} releases={[project({ onSite: true })]} />,
    )
    expect(screen.getByRole('link', { name: /Add music/i })).toBeTruthy()
    rerender(<MusicTools artistId="a1" onToggleOnSite={vi.fn()} releases={[project({ onSite: false })]} />)
    expect(screen.getByRole('link', { name: /Add music/i })).toBeTruthy()
  })

  it('an on-site project still expands to its songs', () => {
    // The witness: a filter that removed everything would satisfy the two tests above.
    render(
      <MusicTools
        artistId="a1"
        onToggleOnSite={vi.fn()}
        releases={[project({ key: 'release:x', title: 'Kept', songs: [{ id: 's1', title: 'Track One' }] })]}
      />,
    )
    expect(screen.getByText('Kept')).toBeTruthy()
    expect(covers()).toContain('Kept — 1 song')
  })
})
