// @vitest-environment jsdom
/**
 * MusicBrowser — the ONE Music surface. Locks Sam's 2026-07-09 spec: two
 * segmented lenses (All/Released/Unreleased, then All/On site/Off site) under a
 * single shared toolbar (Import · Refresh · + Song · + Release · sort) that
 * stays put across views, with Refresh greyed out on Unreleased. Unreleased
 * items count as off-site for the site lens; heavy cards are stubbed.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MusicBrowser, LOOSE, type UnreleasedSong } from '@/app/artists/[id]/(dashboard)/music/music-browser'
import type { Release } from '@/app/artists/[id]/(dashboard)/releases/release-card'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishReleasesAction: vi.fn(async () => ({ ok: true })),
  addContentAction: vi.fn(async () => ({})),
  addReleaseAction: vi.fn(async () => undefined),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/app/artists/[id]/(dashboard)/tracks/track-card', () => ({
  TrackCard: ({ track }: { track: { title: string } }) => <li data-testid="song">{track.title}</li>,
}))
vi.mock('@/app/artists/[id]/(dashboard)/releases/release-card', () => ({
  ReleaseCard: ({ release }: { release: { title: string } }) => <div data-testid="release">{release.title}</div>,
}))

afterEach(cleanup)

const release = (over: Partial<Release>): Release => ({
  id: 'r', title: 'R', slug: 'r', cover_url: null, release_date: '2026-01-01',
  release_type: 'single', links: [], visible: true, songs: [], ...over,
})

const song = (over: Partial<UnreleasedSong>): UnreleasedSong => ({
  id: 's', title: 's', cover_url: null, stream_url: null, source: 'manual',
  audio_path: null, release_id: null, spotify_id: null, apple_id: null,
  deezer_id: null, apple_url: null, group: LOOSE, groupLabel: '', ...over,
})

function setup(over: Partial<Parameters<typeof MusicBrowser>[0]> = {}) {
  render(
    <MusicBrowser
      releases={[release({ id: 'r1', title: 'Public Single' }), release({ id: 'r2', title: 'Hidden Single', visible: false })]}
      unreleasedReleases={[release({ id: 'u1', title: 'Demo EP', release_type: 'ep' })]}
      looseReleased={[]}
      unreleasedSongs={[song({ id: 's1', title: 'Bedroom Demo' })]}
      releaseOptions={[]}
      artistId="a1"
      artistSlug="a"
      refreshAction={vi.fn(async () => ({ ok: true }))}
      {...over}
    />,
  )
}

const releaseTitles = () => screen.getAllByTestId('release').map((el) => el.textContent)

// The two lenses share labels ("All") — scope queries to their control groups.
const bucketBtn = (name: string) =>
  within(screen.getByRole('group', { name: 'Filter by release state' })).getByRole('button', { name })
const siteBtn = (name: string) =>
  within(screen.getByRole('group', { name: 'Filter by site visibility' })).getByRole('button', { name })

describe('MusicBrowser lenses', () => {
  it('All (default) shows released groups AND the Unreleased section', () => {
    setup()
    expect(releaseTitles()).toEqual(expect.arrayContaining(['Public Single', 'Hidden Single', 'Demo EP']))
    expect(screen.getByText('Unreleased', { selector: 'div' })).toBeInTheDocument() // the wrapper section (KLabel)
    expect(screen.getByTestId('song')).toHaveTextContent('Bedroom Demo')
  })

  it('Released hides the unreleased half', () => {
    setup()
    fireEvent.click(bucketBtn('Released'))
    expect(releaseTitles()).not.toContain('Demo EP')
    expect(screen.queryByTestId('song')).not.toBeInTheDocument()
  })

  it('Unreleased hides released content and greys out Refresh', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled()
    fireEvent.click(bucketBtn('Unreleased'))
    expect(releaseTitles()).toEqual(['Demo EP'])
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    fireEvent.click(bucketBtn('All'))
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled()
  })

  it('On site shows only live released items (unreleased is never on site)', () => {
    setup()
    fireEvent.click(siteBtn('On site'))
    expect(releaseTitles()).toEqual(['Public Single'])
    expect(screen.queryByTestId('song')).not.toBeInTheDocument()
  })

  it('Off site shows hidden released items and everything unreleased', () => {
    setup()
    fireEvent.click(siteBtn('Off site'))
    expect(releaseTitles()).toEqual(expect.arrayContaining(['Hidden Single', 'Demo EP']))
    expect(releaseTitles()).not.toContain('Public Single')
    expect(screen.getByTestId('song')).toBeInTheDocument()
  })
})

describe('MusicBrowser toolbar', () => {
  it('has the shared controls: Import slot, Refresh, ONE + button, sort', () => {
    setup({ importButton: <button type="button">DriveImport</button> })
    expect(screen.getByText('DriveImport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add song' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add release' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Newest' })).toBeInTheDocument()
  })

  it('the toolbar stays across views (same buttons on Unreleased)', () => {
    setup()
    fireEvent.click(bucketBtn('Unreleased'))
    expect(screen.getByRole('button', { name: 'Add song' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Newest' })).toBeInTheDocument()
  })

  it('publish pill: disabled clean, enabled by content edits', () => {
    setup()
    expect(screen.getByRole('button', { name: /^Publish/ })).toBeDisabled()
    cleanup()
    setup({ dirty: true })
    expect(screen.getByRole('button', { name: /^Publish/ })).not.toBeDisabled()
  })
})
