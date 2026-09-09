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
import { MusicBrowser, LOOSE, type MusicSong, type UnreleasedSong } from '@/app/artists/[id]/(dashboard)/music/music-browser'
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
  release_type: 'single', links: [], on_site: true, songs: [], ...over,
})

const song = (over: Partial<UnreleasedSong>): UnreleasedSong => ({
  id: 's', title: 's', cover_url: null, stream_url: null, source: 'manual',
  audio_path: null, release_id: null, parent_release_id: null, release_date: null,
  release_type: 'single', on_site: false, spotify_id: null, apple_id: null,
  deezer_id: null, apple_url: null, group: LOOSE, groupLabel: '', ...over,
})

function setup(over: Partial<Parameters<typeof MusicBrowser>[0]> = {}) {
  render(
    <MusicBrowser
      releases={[release({ id: 'r1', title: 'Public Single' }), release({ id: 'r2', title: 'Hidden Single', on_site: false })]}
      unreleasedReleases={[release({ id: 'u1', title: 'Demo EP', release_type: 'ep' })]}
      orphanSingles={[]}
      unreleasedSongs={[song({ id: 's1', title: 'Bedroom Demo' })]}
      releaseOptions={[]}
      mergeTargets={[]}
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

  it('Unreleased hides released content and greys out Sync', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Sync' })).not.toBeDisabled()
    fireEvent.click(bucketBtn('Unreleased'))
    expect(releaseTitles()).toEqual(['Demo EP'])
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled()
    fireEvent.click(bucketBtn('All'))
    expect(screen.getByRole('button', { name: 'Sync' })).not.toBeDisabled()
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

describe('MusicBrowser — orphan singles (no loose bucket)', () => {
  const orphan = (over: Partial<MusicSong>): MusicSong => ({
    id: 'o', title: 'Bootleg', cover_url: null, stream_url: null, source: 'manual',
    audio_path: null, release_id: null, parent_release_id: null, release_date: null, on_site: false,
    spotify_id: null, apple_id: null,
    deezer_id: null, apple_url: null, created_at: '2026-01-01', release_type: 'single', ...over,
  })

  it('renders an orphan single as a song, and never a "Loose" section', () => {
    setup({ orphanSingles: [orphan({ id: 'o1', title: 'Bootleg Mix' })] })
    expect(screen.getAllByTestId('song').some((n) => n.textContent === 'Bootleg Mix')).toBe(true)
    expect(screen.queryByText(/loose/i)).toBeNull()
  })

  // The site lens must read the orphan's OWN `on_site`, like every other card.
  // It once passed orphans through untouched (`site === 'off' ? [] : orphans`), which
  // made an off-site orphan unfindable: shown under "On site", hidden under "Off site".
  // 48db004 gave orphan songs their own toggle, so there is no "orphans are always
  // public" shortcut left to take.
  it('an OFF-site orphan shows under Off site and NOT under On site', () => {
    setup({ orphanSingles: [orphan({ id: 'o1', title: 'Bootleg Mix', on_site: false })] })
    fireEvent.click(siteBtn('Off site'))
    expect(screen.getByText('Bootleg Mix')).toBeInTheDocument()
    fireEvent.click(siteBtn('On site'))
    expect(screen.queryByText('Bootleg Mix')).toBeNull()
  })

  it('an ON-site orphan shows under On site and NOT under Off site', () => {
    setup({ orphanSingles: [orphan({ id: 'o1', title: 'Bootleg Mix', on_site: true })] })
    fireEvent.click(siteBtn('On site'))
    expect(screen.getByText('Bootleg Mix')).toBeInTheDocument()
    fireEvent.click(siteBtn('Off site'))
    expect(screen.queryByText('Bootleg Mix')).toBeNull()
  })
})

describe('MusicBrowser toolbar', () => {
  it('has the shared controls: Import slot, Sync, ONE + button, sort', () => {
    setup({ importButton: <button type="button">DriveImport</button> })
    expect(screen.getByText('DriveImport')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add music' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add release' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Newest' })).toBeInTheDocument()
  })

  it('the toolbar stays across views (same buttons on Unreleased)', () => {
    setup()
    fireEvent.click(bucketBtn('Unreleased'))
    expect(screen.getByRole('button', { name: 'Add music' })).toBeInTheDocument()
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

/* ── a just-added item stacks on top of its section ────────────────────────────────────
 * Sam, 2026-09-09: "the newest ones should be in the top left of their respective
 * section. It should enter the list as a stack, not a append to the end list."
 *
 * The defect was a sentinel that disagreed with itself. `oldest` read an undated release
 * as `'9999'` — far future, therefore NEWEST, therefore last in an ascending sort, which
 * is right. `newest` read the same release as `''` — therefore OLDEST, therefore last
 * again. Undated items sank to the bottom in BOTH directions, and a release you had just
 * typed in (no date yet) appeared at the end of its section.
 *
 * Undated means JUST ADDED. It sorts first under Newest and last under Oldest, and the
 * two are now the same sentinel rather than two guesses.
 */
describe('MusicBrowser — an undated release is the newest thing there is', () => {
  const dated = (id: string, title: string, date: string | null) =>
    release({ id, title, release_date: date, release_type: 'single' })

  const titlesIn = (testid: string) => screen.getAllByTestId(testid).map((el) => el.textContent)
  /** Only the RELEASED shelf, so the fixture's unreleased defaults don't join the list
   *  being asserted on — they render in their own section and would read as a sort bug. */
  const only = (releases: Release[]) =>
    setup({ releases, unreleasedReleases: [], unreleasedSongs: [], orphanSingles: [] })

  it('CRITICAL: under Newest, a release with no date sorts ABOVE every dated one', () => {
    only([
      dated('r1', 'Old Song', '2020-01-01'),
      dated('r2', 'Just Added', null),
      dated('r3', 'Recent Song', '2026-01-01'),
    ])
    // 'newest' is the default sort, which is the state a manager lands in.
    expect(titlesIn('release')).toEqual(['Just Added', 'Recent Song', 'Old Song'])
  })

  it('CRITICAL: an EMPTY-STRING date counts as undated too', () => {
    // The old `?? ''` only caught null. A row whose date column holds '' — which the
    // add form produces from a blank input — fell through to a string compare against
    // every real date and lost every one of them.
    only([dated('r1', 'Old Song', '2020-01-01'), dated('r2', 'Just Added', '')])
    expect(titlesIn('release')).toEqual(['Just Added', 'Old Song'])
  })

  it('CRITICAL: under Oldest it goes LAST — the sentinel means one thing in both directions', () => {
    // The half that stops "undated first" from being implemented as "undated always
    // first". Newest and Oldest must be each other's reverse.
    only([
      dated('r1', 'Old Song', '2020-01-01'),
      dated('r2', 'Just Added', null),
      dated('r3', 'Recent Song', '2026-01-01'),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }))
    expect(titlesIn('release')).toEqual(['Old Song', 'Recent Song', 'Just Added'])
  })

  it('dated releases still sort by their DATE, not by when they were typed in', () => {
    // The rule is "newest release first", and a back-catalogue record added today is not
    // new. Only the undated case is about arrival order.
    only([dated('r1', 'Newer', '2026-05-01'), dated('r2', 'Older', '2019-01-01')])
    expect(titlesIn('release')).toEqual(['Newer', 'Older'])
  })
})
