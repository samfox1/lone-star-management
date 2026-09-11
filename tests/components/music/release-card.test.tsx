// @vitest-environment jsdom
// The release modal and the song-in-a-release modal on the modal kit: rows that save one field
//   each, constrained type choices, and a tracklist that opens each song the same way.
/**
 * ReleaseCard on modal-kit (prototype G, Sam, 2026-09-11). Sam clicked a song inside an
 * album after the song card was rebuilt and got the OLD two-column modal — this file had
 * its own copy. Both of its modals now read like every other one:
 *
 *   release  header = cover · title · type / year / song count; rows Title, Type, Date,
 *            one per streaming platform (release.links), Songs (EP/album) or Audio (single);
 *            footer Share · Delete · Done; no Save, no Edit sheet, no listens.
 *   song     header = the album's cover · song title · feat. / release; rows one per
 *            platform (the song's own fields) and Audio; footer Merge into… · Done.
 *
 * What is pinned:
 *   - Title / Date each save through updateReleaseDetailsAction carrying BOTH values (the
 *     action nulls a missing date — a title-only write would erase the date);
 *   - Type offers only the sensible pair (EP ⇄ Album for a multi-track release, Single ⇄
 *     Remix for a single) and saves the pick at once; an unrelated edit never writes it;
 *   - a platform row saves through setReleaseLinkAction with that platform's label;
 *   - a tracklist song opens its own dialog whose rows save the SONG's field;
 *   - no Save / Close / Cancel buttons; Done, Share, Analytics present.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReleaseCard, type Release, type ReleaseSong } from '@/app/artists/[id]/(dashboard)/releases/release-card'
import { setReleaseLinkAction, setReleaseTypeAction, updateContentAction, updateReleaseDetailsAction } from '@/app/artists/[id]/(dashboard)/actions'

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
  setReleaseLinkAction: vi.fn(async () => ({})),
  setReleaseTypeAction: vi.fn(async () => ({})),
  updateReleaseDetailsAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/music/actions', () => ({
  mergeSongsAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const song = (id: string, title: string, over: Partial<ReleaseSong> = {}): ReleaseSong => ({
  id, title, featured_artists: [], stream_url: null, audio_path: null,
  spotify_id: null, apple_id: null, deezer_id: null,
  apple_url: null, soundcloud_url: null, deezer_url: null, ...over,
})
const release = (over: Partial<Release> = {}): Release => ({
  id: 'r1', title: 'Night EP', slug: 'night-ep', cover_url: null, release_date: '2026-01-01',
  release_type: 'ep', links: [{ label: 'Spotify', url: 'https://open.spotify.com/album/x' }], on_site: false,
  songs: [song('s1', 'Alpha'), song('s2', 'Beta', { featured_artists: ['Arlo'] })],
  ...over,
})

function openRelease(r: Release = release()) {
  render(<ReleaseCard release={r} artistId="a1" artistSlug="lone-pine" />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${r.title} — `) }))
  return screen.getByRole('dialog', { name: r.title })
}

/** The row carrying this label (the label span's row box). */
function rowOf(scope: HTMLElement, label: string): HTMLElement {
  const lab = within(scope).getAllByText(label, { selector: 'span' }).find((el) => el.closest('.group'))!
  return lab.closest('.group') as HTMLElement
}
function editRow(scope: HTMLElement, label: string, next: string) {
  fireEvent.click(within(rowOf(scope, label)).getByRole('button'))
  const input = within(scope).getByLabelText(label) // a date input is not a "textbox"
  fireEvent.change(input, { target: { value: next } })
  fireEvent.blur(input)
}

describe('the release modal', () => {
  it('is headed by the release, with type · year · songs as meta, and has the rows', () => {
    const dialog = openRelease()
    expect(within(dialog).getByRole('heading', { name: 'Night EP' })).toBeInTheDocument()
    // The meta line sits right under the heading: type · year · song count.
    expect(dialog.querySelector('h3 + div')?.textContent).toMatch(/^EP.*2026.*2 songs$/)
    for (const label of ['Title', 'Type', 'Date', 'Spotify', 'Apple Music', 'SoundCloud', 'Deezer', 'Songs']) {
      expect(rowOf(dialog, label)).toBeInTheDocument()
    }
    expect(within(dialog).queryByText(/listens/i)).toBeNull()
  })

  it('CRITICAL: saving the title carries the current date too (the action nulls a missing date)', async () => {
    const dialog = openRelease()
    editRow(dialog, 'Title', 'Night EP (Deluxe)')
    await waitFor(() => expect(updateReleaseDetailsAction).toHaveBeenCalledTimes(1))
    const [id, artistId, fd] = vi.mocked(updateReleaseDetailsAction).mock.calls[0]
    expect([id, artistId]).toEqual(['r1', 'a1'])
    expect((fd as FormData).get('title')).toBe('Night EP (Deluxe)')
    expect((fd as FormData).get('release_date')).toBe('2026-01-01')
    expect(setReleaseTypeAction).not.toHaveBeenCalled()
  })

  it('saving the date carries the current title too', async () => {
    const dialog = openRelease()
    editRow(dialog, 'Date', '2026-02-02')
    await waitFor(() => expect(updateReleaseDetailsAction).toHaveBeenCalledTimes(1))
    const fd = vi.mocked(updateReleaseDetailsAction).mock.calls[0][2] as FormData
    expect(fd.get('title')).toBe('Night EP')
    expect(fd.get('release_date')).toBe('2026-02-02')
  })

  it('CRITICAL: Type offers only EP ⇄ Album for a multi-track release and saves the pick at once', async () => {
    const dialog = openRelease()
    const select = within(dialog).getByRole('combobox', { name: 'Type' })
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['EP', 'Album'])
    fireEvent.change(select, { target: { value: 'album' } })
    await waitFor(() => expect(setReleaseTypeAction).toHaveBeenCalledTimes(1))
    expect((vi.mocked(setReleaseTypeAction).mock.calls[0][2] as FormData).get('release_type')).toBe('album')
  })

  it('a single offers Single ⇄ Remix; a featured appearance has no type row', () => {
    const single = openRelease(release({ release_type: 'single', songs: [song('s1', 'Alpha')] }))
    expect([...within(single).getByRole('combobox', { name: 'Type' }).querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Single', 'Remix'])
    cleanup()
    const featured = openRelease(release({ release_type: 'featured', songs: [song('s1', 'Alpha')] }))
    expect(within(featured).queryByRole('combobox', { name: 'Type' })).toBeNull()
  })

  it('a platform row saves the release link under that platform, and shows the current one', async () => {
    const dialog = openRelease()
    expect(within(dialog).getByText('https://open.spotify.com/album/x')).toBeInTheDocument()
    editRow(dialog, 'Apple Music', 'https://music.apple.com/x')
    await waitFor(() => expect(setReleaseLinkAction).toHaveBeenCalledTimes(1))
    const [id, artistId, label, fd] = vi.mocked(setReleaseLinkAction).mock.calls[0]
    expect([id, artistId, label]).toEqual(['r1', 'a1', 'Apple Music'])
    expect((fd as FormData).get('url')).toBe('https://music.apple.com/x')
  })

  it('a single shows Audio instead of Songs', () => {
    const dialog = openRelease(release({ release_type: 'single', songs: [song('s1', 'Alpha')] }))
    expect(rowOf(dialog, 'Audio')).toBeInTheDocument()
    expect(within(dialog).queryByText('Songs', { selector: 'span' })).toBeNull()
  })

  it('the footer is Share · Delete · Done, with Analytics in the corner and no Save', () => {
    const dialog = openRelease()
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Delete/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/artists/a1')
    expect(within(dialog).queryByRole('button', { name: /^(Save|Cancel)$/ })).toBeNull() // × is "Close"; nothing else is
  })
})

describe('a song inside the release', () => {
  it('opens its own dialog: album cover, song title, feat. and the release as meta', () => {
    const dialog = openRelease()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Beta' }))
    const songDialog = screen.getByRole('dialog', { name: 'Beta' })
    expect(within(songDialog).getByRole('heading', { name: 'Beta' })).toBeInTheDocument()
    expect(within(songDialog).getByText(/feat\. Arlo/)).toBeInTheDocument()
    expect(within(songDialog).getByText(/Night EP/)).toBeInTheDocument()
    expect(within(songDialog).queryByText(/listens/i)).toBeNull()
  })

  it("CRITICAL: a platform row saves the SONG's field, not the release's link", async () => {
    const dialog = openRelease()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Beta' }))
    const songDialog = screen.getByRole('dialog', { name: 'Beta' })
    editRow(songDialog, 'SoundCloud', 'https://soundcloud.com/x/beta')
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const [type, id, artistId, fd] = vi.mocked(updateContentAction).mock.calls[0]
    expect([type, id, artistId]).toEqual(['track', 's2', 'a1'])
    expect([...(fd as FormData).keys()]).toEqual(['soundcloud_url'])
    expect(setReleaseLinkAction).not.toHaveBeenCalled()
  })

  it('has Audio, Done, and no Save', () => {
    const dialog = openRelease()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Beta' }))
    const songDialog = screen.getByRole('dialog', { name: 'Beta' })
    expect(rowOf(songDialog, 'Audio')).toBeInTheDocument()
    expect(within(songDialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(within(songDialog).queryByRole('button', { name: /^Save$/ })).toBeNull()
  })
})
