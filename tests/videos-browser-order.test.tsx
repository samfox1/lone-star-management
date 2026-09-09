// @vitest-environment jsdom
/**
 * NEWEST FIRST, IN EVERY SECTION (Sam, 2026-09-09).
 *
 * "On the assets page, the newest ones should be in the top left of their respective
 * section. It should enter the list as a stack, not a append to the end list."
 *
 * Videos were the page that appended. `listContent` orders every publishable type by
 * `sort_order, created_at` ASCENDING, and `sort_order` defaults to 0 for every row a
 * manager has never dragged — so the whole library ties on 0 and falls through to
 * created_at ascending, which is oldest first. The browser's default "Added" sort then
 * re-ordered nothing, so a video you had just imported landed at the BOTTOM of its
 * provider section.
 *
 * The fix is here rather than in `listContent`, deliberately: that same ordering feeds
 * `lib/site.ts`, so changing it would silently re-order the public site for every artist.
 * The assets page is a LIBRARY view — what you have, newest first. The site's order is
 * the editor's business.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VideosBrowser } from '@/app/artists/[id]/(dashboard)/videos/videos-browser'
import type { VideoItem } from '@/app/artists/[id]/(dashboard)/videos/video-card'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishEntityAction: vi.fn(async () => ({ ok: true })),
  setOnSiteAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/app/artists/[id]/(dashboard)/videos/video-card', () => ({
  VideoCard: ({ video }: { video: { title: string } }) => <div data-testid="video">{video.title}</div>,
}))

afterEach(cleanup)

const video = (over: Partial<VideoItem>): VideoItem =>
  ({
    id: 'v', title: 'V', provider: 'youtube', poster: null, embed_url: null,
    storage_path: null, source: null, is_short: false, on_site: true,
    youtube_views: null, created_at: '2026-01-01T00:00:00Z', ...over,
  }) as VideoItem

const titles = () => screen.getAllByTestId('video').map((el) => el.textContent)

/** The order the PAGE hands them over: `listContent`'s oldest-first. The browser must not
 *  depend on being fed them in the order it wants to show. */
// Titles chosen so ALPHABETICAL order differs from CHRONOLOGICAL order. The first version
// used 'Just Added' / 'Middle' / 'Oldest', which sort a–z into exactly the newest-first
// order — so the A–Z test below could not tell the two comparators apart (review,
// 2026-09-09). 'Zulu' is newest, 'Alpha' is oldest: newest-first is Z-M-A, a–z is A-M-Z.
const asLoaded = [
  video({ id: 'v1', title: 'Alpha', created_at: '2020-01-01T00:00:00Z' }),
  video({ id: 'v2', title: 'Mike', created_at: '2023-01-01T00:00:00Z' }),
  video({ id: 'v3', title: 'Zulu', created_at: '2026-09-09T00:00:00Z' }),
]

describe('VideosBrowser — a new video stacks on top of its section', () => {
  it('CRITICAL: the default view shows newest first, reversing how they arrived', () => {
    render(<VideosBrowser videos={asLoaded} artistId="a1" />)
    expect(titles()).toEqual(['Zulu', 'Mike', 'Alpha'])
  })

  it('CRITICAL: it sorts WITHIN each provider section, never across them', () => {
    // Sections are the provider groups, and their order is fixed (uploaded, then
    // youtube). A global sort would hoist the newest video out of its own section — "top
    // left of their respective section", not top left of the page.
    render(
      <VideosBrowser
        artistId="a1"
        videos={[
          video({ id: 'y1', title: 'YT old', provider: 'youtube', created_at: '2020-01-01T00:00:00Z' }),
          video({ id: 'u1', title: 'Upload old', provider: 'uploaded', created_at: '2021-01-01T00:00:00Z' }),
          video({ id: 'y2', title: 'YT new', provider: 'youtube', created_at: '2026-01-01T00:00:00Z' }),
          video({ id: 'u2', title: 'Upload new', provider: 'uploaded', created_at: '2026-09-09T00:00:00Z' }),
        ]}
      />,
    )
    // Uploaded section first (ORIGIN_ORDER), newest within it; then YouTube, same.
    expect(titles()).toEqual(['Upload new', 'Upload old', 'YT new', 'YT old'])
  })

  it('CRITICAL: A–Z still sorts by title, not by date', () => {
    // The witness for the sort control itself: if the default simply ignored the setting,
    // this would fail and the test above would still pass.
    render(<VideosBrowser videos={asLoaded} artistId="a1" />)
    fireEvent.click(screen.getByRole('button', { name: 'A–Z' }))
    expect(titles()).toEqual(['Alpha', 'Mike', 'Zulu'])
  })

  it('videos with no created_at keep a stable order rather than jumping', () => {
    // Older rows predate the column being surfaced. They sort together at the end rather
    // than shuffling on every render.
    render(
      <VideosBrowser
        artistId="a1"
        videos={[
          video({ id: 'a', title: 'No date A', created_at: '' }),
          video({ id: 'b', title: 'Dated', created_at: '2026-01-01T00:00:00Z' }),
          video({ id: 'c', title: 'No date B', created_at: '' }),
        ]}
      />,
    )
    expect(titles()).toEqual(['Dated', 'No date A', 'No date B'])
  })
})
