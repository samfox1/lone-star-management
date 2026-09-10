// @vitest-environment jsdom
// The one Music surface: its two lenses, its shared toolbar, and how releases are ordered.
/**
 * MusicBrowser — the ONE Music surface. Locks Sam's 2026-07-09 spec: two
 * segmented lenses (All/Released/Unreleased, then All/On site/Off site) under a
 * single shared toolbar (Import · Sync · + Song · + Release · sort) that
 * stays put across views, with Sync absent on Unreleased — a platform pull only ever
 * produces RELEASED music, so the control does not apply there (it was a greyed-out
 * button until 2026-09-09, when Sync became a dialog the page builds). Unreleased
 * items count as off-site for the site lens; heavy cards are stubbed.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { MusicBrowser, LOOSE, type MusicSong, type UnreleasedSong } from '@/app/artists/[id]/(dashboard)/music/music-browser'
import type { Release } from '@/app/artists/[id]/(dashboard)/releases/release-card'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishMusicAction: vi.fn(async () => ({ ok: true })),
  setReleaseOnSiteAction: vi.fn(async () => ({})),
  addContentAction: vi.fn(async () => ({})),
  addReleaseAction: vi.fn(async () => undefined),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/app/artists/[id]/(dashboard)/tracks/track-card', () => ({
  TrackCard: ({ track }: { track: { title: string } }) => <li data-testid="song">{track.title}</li>,
}))
vi.mock('@/app/artists/[id]/(dashboard)/releases/release-card', () => ({
  // The stub exposes the tick, so the tick's wiring — not the card's — is what a test hits.
  ReleaseCard: ({ release, onToggleSelect }: { release: { title: string }; onToggleSelect?: () => void }) => (
    <div data-testid="release">
      {release.title}
      <button type="button" aria-label={`Tick ${release.title}`} onClick={onToggleSelect} />
    </div>
  ),
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
      syncDialog={<button type="button">Sync</button>}
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

  it('Unreleased hides released content, and Sync with it', () => {
    // Sync was a greyed-out button on this view until 2026-09-09; it is now a dialog the
    // page hands in, and the view does not render it at all. Same rule — a platform pull
    // only ever produces released music — expressed as absence rather than as a control
    // that can never become enabled here.
    setup()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy()
    fireEvent.click(bucketBtn('Unreleased'))
    expect(releaseTitles()).toEqual(['Demo EP'])
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull()
    fireEvent.click(bucketBtn('All'))
    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy()
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

describe('MusicBrowser — the Sync control', () => {
  it('CRITICAL: it is offered on the released views and NOT on Unreleased', () => {
    // A platform pull only ever produces released music, so the control does not apply
    // there. It was a greyed-out button until 2026-09-09; now the page hands in a dialog,
    // and the view simply does not render it — a disabled control that can never become
    // enabled in this view is furniture.
    setup()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy()
    fireEvent.click(bucketBtn('Unreleased'))
    expect(screen.queryByRole('button', { name: 'Sync' }), 'Sync is offered on Unreleased').toBeNull()
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

/* ── a section is ONE list, newest first, whatever kind of thing is in it ──────────────
 * Sam, 2026-09-09: "for putting the assets first, it doesnt seem to work with the
 * soundcloud songs. When I add a song, it should be stamped with a date field to indicate
 * when it was added to assets, and the ones added most recently should show up first."
 *
 * A SoundCloud single creates no release row, so it renders as an ORPHAN song. The section
 * used to draw every release, then every orphan — two consecutive lists sharing one
 * wrapping row — so a single imported five minutes ago sat after a release from 2019 no
 * matter how the sort was set. Sorting each list alone would not have fixed it: they have
 * to be ONE list to interleave.
 *
 * The order key is the same for both kinds:
 *   1. release date, descending, with an undated item counting as JUST ADDED (first);
 *   2. then created_at descending — when it was added to assets — which is what separates
 *      two things that share a date, and what orders the undated ones among themselves.
 */
describe('MusicBrowser — releases and orphan songs share one newest-first order', () => {
  const rel = (id: string, title: string, date: string | null, added = '2020-01-01T00:00:00Z') =>
    release({ id, title, release_date: date, release_type: 'single', created_at: added })
  const orphan = (id: string, title: string, date: string | null, added: string): MusicSong =>
    ({
      ...song({ id, title, release_date: date }),
      created_at: added,
      release_type: 'single',
    }) as MusicSong

  /** Everything drawn in the released shelf, in DOM order, releases and songs together. */
  const shelf = () =>
    screen.getAllByTestId(/^(release|song)$/).map((el) => el.textContent)

  const only = (releases: Release[], orphans: MusicSong[]) =>
    setup({ releases, orphanSingles: orphans, unreleasedReleases: [], unreleasedSongs: [] })

  it('CRITICAL: a just-added orphan single outranks an older release in the same section', () => {
    // The exact report. Before the fix this read ['Old Album', 'Fresh Import'] — the
    // orphan could not reach the front of its own section however it was dated.
    only(
      [rel('r1', 'Old Release', '2019-01-01')],
      [orphan('o1', 'Fresh Import', null, '2026-09-09T12:00:00Z')],
    )
    expect(shelf()).toEqual(['Fresh Import', 'Old Release'])
  })

  it('CRITICAL: a DATED orphan still sorts by its date, in among the releases', () => {
    // Interleaved, not "songs first". The kind of thing an item is must not decide where
    // it sits — only its date does.
    only(
      [rel('r1', 'From 2019', '2019-01-01'), rel('r2', 'From 2026', '2026-01-01')],
      [orphan('o1', 'From 2022', '2022-01-01', '2026-09-09T12:00:00Z')],
    )
    expect(shelf()).toEqual(['From 2026', 'From 2022', 'From 2019'])
  })

  it('CRITICAL: two undated items order by WHEN THEY WERE ADDED, newest first', () => {
    // "the ones added most recently should show up first". This is the tie-break, and the
    // only thing that separates a batch of imports that share no release date.
    only(
      [],
      [
        orphan('o1', 'Added first', null, '2026-09-01T00:00:00Z'),
        orphan('o2', 'Added last', null, '2026-09-09T00:00:00Z'),
        orphan('o3', 'Added second', null, '2026-09-05T00:00:00Z'),
      ],
    )
    expect(shelf()).toEqual(['Added last', 'Added second', 'Added first'])
  })

  it('CRITICAL: Oldest reverses the whole thing, both kinds together', () => {
    only(
      [rel('r1', 'Old Release', '2019-01-01')],
      [orphan('o1', 'Fresh Import', null, '2026-09-09T12:00:00Z')],
    )
    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }))
    expect(shelf()).toEqual(['Old Release', 'Fresh Import'])
  })
})

describe('MusicBrowser — unreleased songs stack too', () => {
  const demo = (id: string, title: string, added: string): UnreleasedSong =>
    ({ ...song({ id, title }), created_at: added }) as UnreleasedSong

  it('CRITICAL: the most recently added demo is first in its group', () => {
    setup({
      releases: [],
      unreleasedReleases: [],
      orphanSingles: [],
      unreleasedSongs: [
        demo('s1', 'Oldest demo', '2026-01-01T00:00:00Z'),
        demo('s2', 'Newest demo', '2026-09-09T00:00:00Z'),
        demo('s3', 'Middle demo', '2026-05-01T00:00:00Z'),
      ],
    })
    expect(screen.getAllByTestId('song').map((el) => el.textContent)).toEqual([
      'Newest demo',
      'Middle demo',
      'Oldest demo',
    ])
  })
})

/* ── the type filter, right of Released / Unreleased (Sam, 2026-09-10) ──────────────────
 * "Have a button to the right of released unreleased that allows you to select single,
 * ep, album, live, etc." One button, a menu: All types plus every entry in RELEASE_TYPES,
 * derived — a seventh type would appear here without anyone editing a list. */
import { RELEASE_TYPES } from '@/lib/releases'

describe('the type filter', () => {
  it('CRITICAL: the menu lists All types and every registry type, in registry order', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /All types/ }))
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())
    expect(items[0]).toBe('All types')
    expect(items).toHaveLength(RELEASE_TYPES.length + 1)
    // Every type is offered, and none is offered twice.
    expect(new Set(items).size).toBe(items.length)
  })

  it('CRITICAL: picking EPs shows only the EP shelf, and All types brings the rest back', () => {
    setup()
    expect(screen.getByText('Public Single')).toBeInTheDocument()
    expect(screen.getByText('Demo EP')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /All types/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'EPs' }))
    expect(screen.queryByText('Public Single'), 'a single survived the EP filter').toBeNull()
    expect(screen.getByText('Demo EP')).toBeInTheDocument()
    // The button now says what is picked.
    expect(screen.getByRole('button', { name: /EPs/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /EPs/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'All types' }))
    expect(screen.getByText('Public Single')).toBeInTheDocument()
  })

  it('CRITICAL: it filters the unreleased half too, not just the shelves', () => {
    // 'Bedroom Demo' is an unreleased single (the fixture default). Picking Albums must
    // hide it — a type filter that only reached the released shelves would be a lie on
    // the half of the page where hand-added music lives.
    setup()
    expect(screen.getByText('Bedroom Demo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /All types/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Albums' }))
    expect(screen.queryByText('Bedroom Demo')).toBeNull()
    expect(screen.queryByText('Demo EP')).toBeNull()
  })

  it('sits to the RIGHT of the Released / Unreleased control', () => {
    setup()
    const bucket = screen.getByRole('group', { name: /release state/i })
    const type = screen.getByRole('button', { name: /All types/ })
    expect(bucket.compareDocumentPosition(type) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

/* ── the tick is a draft write, at once (PRESENCE_PLAN S1, 2026-09-10) ──────────────── */
import { setReleaseOnSiteAction } from '@/app/artists/[id]/(dashboard)/actions'

describe('the on-site tick on a release', () => {
  it('CRITICAL: ticking writes the working row immediately, no Publish involved', async () => {
    // It used to accumulate into a selection that a password-gated publish reconciled —
    // and silently reverted the editor's toggle. Now the tick IS the write; Publish only
    // snapshots. 'Public Single' is on-site in the fixture, so a tick turns it OFF.
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Tick Public Single' }))
    await waitFor(() => expect(setReleaseOnSiteAction).toHaveBeenCalledWith('r1', 'a1', false))
  })
})
