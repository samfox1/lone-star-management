// @vitest-environment jsdom
// The song modal on the modal kit: rows that save one field each, the listen links, the type
//   select, the tile's on-site mark, and the Unreleased pill.
/**
 * TrackCard — a song's modal, rebuilt on modal-kit (prototype G, Sam, 2026-09-11: the song
 * modal was the picture he liked). Header = cover · title · type / date meta. Rows: Title,
 * Type, Release, Also on, Date, one per listen platform, Audio. Footer: Unreleased pill
 * (where it can decide anything), Merge into… (when there is a target), Delete, Done.
 * No Save, no Edit sheet, no click numbers.
 *
 * What is pinned:
 *   - a pasted Spotify link saves on blur through updateContentAction (stream_url), which
 *     promotes an upload to Released by derivation; the current link is shown as text;
 *   - the Type row offers EVERY type in the registry (a hand-picked list is how 'live'
 *     shipped unpickable) and saves the pick at once; editing another row never writes
 *     the type;
 *   - the tile's on-site mark (orphans only) flips through the same action as before;
 *   - Unreleased is offered only where the flag can decide (manual + SoundCloud-only),
 *     and flipping it also takes the song off the site;
 *   - no Save / Close buttons, one Analytics button, Merge only when there is a target.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { TrackCard, type Track } from '@/app/artists/[id]/(dashboard)/tracks/track-card'
import { RELEASE_TYPE_LABEL, RELEASE_TYPES } from '@/lib/releases'
import { setTrackOnSiteAction, setTrackReleasedAction, setTrackTypeAction, updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/track-audio-uploader', () => ({
  TrackAudioUploader: () => <div data-testid="uploader" />,
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: async () => ({ data: [] }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  setTrackReleaseAction: vi.fn(async () => ({})),
  setTrackTypeAction: vi.fn(async () => ({})),
  setTrackParentReleaseAction: vi.fn(async () => ({})),
  setTrackOnSiteAction: vi.fn(async () => ({})),
  setTrackReleasedAction: vi.fn(async () => ({})),
  // Pulled in transitively via release-card (shared SONG_PLATFORMS).
  setReleaseLinkAction: vi.fn(async () => ({})),
  setReleaseTypeAction: vi.fn(async () => ({})),
  updateReleaseDetailsAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const track = (over: Partial<Track> = {}): Track => ({
  id: 't1', title: 'Demo', cover_url: null, stream_url: null, source: 'manual',
  audio_path: null, release_id: null, parent_release_id: null, release_date: null,
  release_type: 'single', on_site: false, spotify_id: null, apple_id: null, deezer_id: null,
  apple_url: null, soundcloud_url: null, deezer_url: null, ...over,
})

function openModal(t: Track = track(), extra: Partial<Parameters<typeof TrackCard>[0]> = {}) {
  render(<TrackCard track={t} artistId="a1" releases={[]} {...extra} />)
  // The tile's name is badge + title (+ platform badges): match on the title. Before the
  // modal opens it is the only BUTTON carrying it (the on-site mark is a checkbox).
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t.title) }))
  return screen.getByRole('dialog')
}

/** The row carrying this label (the label span's row box). */
function rowOf(dialog: HTMLElement, label: string): HTMLElement {
  const lab = within(dialog).getAllByText(label, { selector: 'span' }).find((el) => el.closest('.group'))!
  return lab.closest('.group') as HTMLElement
}

/** Click a row's value to edit it, type, blur. */
function editRow(dialog: HTMLElement, label: string, next: string) {
  fireEvent.click(within(rowOf(dialog, label)).getByRole('button'))
  const input = within(dialog).getByRole('textbox', { name: label })
  fireEvent.change(input, { target: { value: next } })
  fireEvent.blur(input)
}

describe('TrackCard listen link', () => {
  it('saves a pasted Spotify link on blur through updateContentAction (promotes the song)', async () => {
    const dialog = openModal()
    editRow(dialog, 'Spotify', 'https://soundcloud.com/x/song')
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const [type, id, artistId, fd] = vi.mocked(updateContentAction).mock.calls[0]
    expect([type, id, artistId]).toEqual(['track', 't1', 'a1'])
    expect([...(fd as FormData).keys()]).toEqual(['stream_url'])
    expect((fd as FormData).get('stream_url')).toBe('https://soundcloud.com/x/song')
  })

  it('shows the current Spotify link as text, with a way to open it', () => {
    const dialog = openModal(track({ stream_url: 'https://x/s' }))
    expect(within(dialog).getByText('https://x/s')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Open Spotify/ })).toHaveAttribute('href', 'https://x/s')
  })
})

describe('TrackCard song type', () => {
  it('CRITICAL: offers every type in the registry, not a hand-picked few', () => {
    // Derived from RELEASE_TYPES (AGENTS.md rule 4) — the check that would have caught
    // 'live' being unpickable.
    const dialog = openModal()
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Type' }))
    const labels = within(dialog).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(RELEASE_TYPES.map((t) => RELEASE_TYPE_LABEL[t]))
  })

  it('CRITICAL: picking Live saves it against the song at once', async () => {
    const dialog = openModal(track({ release_type: 'remix' }))
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Type' }))
    fireEvent.click(within(dialog).getByRole('option', { name: 'Live set' }))
    await waitFor(() => expect(setTrackTypeAction).toHaveBeenCalledTimes(1))
    const [id, artistId, fd] = vi.mocked(setTrackTypeAction).mock.calls[0]
    expect([id, artistId]).toEqual(['t1', 'a1'])
    expect((fd as FormData).get('release_type')).toBe('live')
  })

  it('does not write a type the manager never touched', async () => {
    // Editing the title must not stamp release_type — a no-op write would lock the value
    // against a later Spotify sync for no reason.
    const dialog = openModal(track({ release_type: 'single' }))
    editRow(dialog, 'Title', 'Demo (edit)')
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    expect([...(vi.mocked(updateContentAction).mock.calls[0][3] as FormData).keys()]).toEqual(['title'])
    expect(setTrackTypeAction).not.toHaveBeenCalled()
  })
})

describe('the modal grammar', () => {
  it('has no Save or Close buttons, one Done, and an Analytics button', () => {
    const dialog = openModal()
    expect(within(dialog).queryByRole('button', { name: /^Save$/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /^Cancel$/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument() // the × only
    expect(within(dialog).getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/artists/a1')
    expect(within(dialog).queryByText(/listens/i)).toBeNull()
  })

  it('offers Merge into… only when there is something to merge into', () => {
    openModal()
    expect(screen.queryByRole('button', { name: /Merge/ })).toBeNull()
    cleanup()
    openModal(track(), { mergeTargets: [{ id: 't2', title: 'Other' }] })
    expect(screen.getByRole('button', { name: /Merge/ })).toBeInTheDocument()
  })
})

/* ── the on-site check on the tile (Sam, 2026-09-10) ─────────────────────────────────
 * Same check the release cards wear, wired to the song's action; a song inside a release
 * shows none, because the release owns that decision. */
describe('the on-site check on a song tile', () => {
  it('CRITICAL: an orphan song ON the site shows a checked mark on its tile', () => {
    render(<TrackCard track={track({ on_site: true })} artistId="a1" releases={[]} />)
    expect(screen.getByRole('checkbox', { name: /Demo — on site/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('CRITICAL: clicking the mark flips the song on or off the site, through the same action', async () => {
    render(<TrackCard track={track({ on_site: false })} artistId="a1" releases={[]} />)
    const box = screen.getByRole('checkbox', { name: /Demo — off site/ })
    expect(box).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(box)
    await waitFor(() => expect(setTrackOnSiteAction).toHaveBeenCalledWith('t1', 'a1', true))
    expect(screen.getByRole('checkbox', { name: /Demo — on site/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('CRITICAL: a song inside a release shows NO mark — the release owns on-site', () => {
    render(<TrackCard track={track({ release_id: 'r1', on_site: true })} artistId="a1" releases={[]} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('the mark does not open the modal', () => {
    render(<TrackCard track={track({ on_site: false })} artistId="a1" releases={[]} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/* ── the Unreleased pill in the footer (Sam, 2026-09-10) ────────────────────────────── */
describe('the Unreleased pill', () => {
  it('CRITICAL: a manual SoundCloud-only song offers it; flipping it calls the action', async () => {
    openModal(track({ soundcloud_url: 'https://soundcloud.com/x/demo', released: true }))
    const sw = screen.getByRole('switch', { name: 'Unreleased' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    await waitFor(() => expect(setTrackReleasedAction).toHaveBeenCalledWith('t1', 'a1', false))
    expect(screen.getByRole('switch', { name: 'Unreleased' })).toHaveAttribute('aria-checked', 'true')
  })

  it('a manual upload with no links offers it too', () => {
    openModal(track())
    expect(screen.getByRole('switch', { name: 'Unreleased' })).toBeInTheDocument()
  })

  it('CRITICAL: a song on Spotify does NOT offer it — being there is being released', () => {
    openModal(track({ spotify_id: 'sp1', soundcloud_url: 'https://soundcloud.com/x/y' }))
    expect(screen.queryByRole('switch', { name: 'Unreleased' })).toBeNull()
  })

  it("flipping to unreleased also takes the song off the site (the tile's mark follows)", async () => {
    // The public doors read on_site, so the two must move together or "unreleased" lies.
    openModal(track({ soundcloud_url: 'https://soundcloud.com/x/demo', released: true, on_site: true }))
    expect(screen.getByRole('checkbox', { name: /Demo — on site/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('switch', { name: 'Unreleased' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Demo — off site/ })).toHaveAttribute('aria-checked', 'false'))
  })
})

/* ── a song that lives on a record (Sam, 2026-09-11) ─────────────────────────────── */
describe('a song on a record', () => {
  it('CRITICAL: is typed by the record — no Type row, and the meta says "Track from EP …"', () => {
    render(
      <TrackCard
        track={track({ release_id: 'r1', release_type: 'ep' })}
        artistId="a1"
        releases={[{ id: 'r1', title: 'Night EP', release_type: 'ep' }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Demo/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('combobox', { name: 'Type' })).toBeNull()
    expect(dialog.querySelector('h3 + div')?.textContent).toMatch(/^Track from EP Night EP/)
  })

  it('a song on a one-song release keeps its plain type in the meta, still without a Type row', () => {
    render(
      <TrackCard
        track={track({ release_id: 'r1', release_type: 'single' })}
        artistId="a1"
        releases={[{ id: 'r1', title: 'Demo', release_type: 'single' }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Demo/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('combobox', { name: 'Type' })).toBeNull()
    expect(dialog.querySelector('h3 + div')?.textContent).toMatch(/^Single/)
  })
})
