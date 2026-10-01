// @vitest-environment jsdom
/**
 * The SEO / GEO Profiles tab: the Apple Music & Amazon bio card shows the email the builder
 * makes, Open in Mail opens exactly that email, and Mark as sent records it.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/profiles-tab.tsx
 * Feature:  SEO / GEO page · Profiles tab (Sam, 2026-09-30, prototypes/profiles_bio_pack_20260930.html)
 * Tier:     LIGHT (AGENTS.md "Test depth"): the card is new and still moving. The email itself is
 *           pinned STRICTLY in tests/unit/manager-tools/seo/bio-pack.test.ts.
 * Covers:   • the card shows the pack, and Open in Mail's href is the builder's mailto (with the
 *             CC once a valid one is typed); the CC check shows while the CC is empty
 *           • Mark as sent calls the action with the artist, the item and `true`
 * Fixtures: the mark action is a mock; the input is shaped like Skeen's get_public_site links and
 *           get_public_releases rows (2026-09-30).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { buildBioPack, mailtoHref, type BioPackInput } from '@/lib/manager-tools/seo/bio-pack'
import { ProfilesTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/profiles-tab'
import { markProfileItemAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/actions'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/actions', () => ({ markProfileItemAction: vi.fn(async () => ({ ok: true })) }))

const markMock = vi.mocked(markProfileItemAction)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const INPUT: Omit<BioPackInput, 'photo'> = {
  artist: { name: 'Skeen', bio: 'My name is Skeen\n\nI am a Chicago DJ, producer, and filmmaker.', genre: 'House, Tech House', location: 'Chicago', spotify_artist_id: '26KxuQlgIw8VP8YX2IkMWR' },
  site_content: { fact_region: '', fact_country: '' },
  site_url: 'https://www.skeenmusic.com',
  links: [
    { label: 'Spotify', url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', role: null },
    { label: 'USB button', url: 'https://open.spotify.com/playlist/0MLdp3LsWM0uO2oryTniXi?si=w980RNcdQUenHYKQSbDacw', role: 'usb' },
    { label: 'Apple Music', url: 'https://music.apple.com/no/artist/skeen/1754431714', role: null },
  ],
  releases: [{ title: 'You Were There', release_date: '2026-02-14', release_type: 'single', released: false, source: 'spotify', spotify_id: '6liwYYWqZgPxO2TgqM2tno', links: [{ url: 'https://open.spotify.com/album/6liwYYWqZgPxO2TgqM2tno', label: 'Spotify' }] }],
  manager_name: null,
}
const PHOTOS = [{ url: 'https://example.supabase.co/storage/v1/object/public/media/c6c2/gallery/cd13.jpg', thumb: 'https://example.supabase.co/thumb.jpg', type: 'JPEG', name: 'cd13.jpg' }]

const show = (sentAt: string | null = null) => render(<ProfilesTab artistId="a1" input={INPUT} photos={PHOTOS} sentAt={sentAt} marksOk />)

describe('the bio card', () => {
  // The card shows the email the builder makes, and Open in Mail opens exactly that one.
  it('shows the pack, and Open in Mail is the builder’s mailto (with the CC once it is valid)', () => {
    show()
    const pack = buildBioPack({ ...INPUT, photo: { url: PHOTOS[0].url, type: 'JPEG' } })
    expect(screen.getByText('apple.coverage.support@xperi.com')).toBeTruthy()
    expect(screen.getByText(pack.subject)).toBeTruthy()
    expect(screen.getByLabelText('Email').textContent).toBe(pack.body)
    const mail = screen.getByRole('link', { name: 'Open in Mail' })
    expect(mail.getAttribute('href')).toBe(mailtoHref(pack))
    // The CC check shows while the CC is empty; a valid address quiets it and joins the mailto.
    expect(document.querySelector('[data-check="cc"]')?.textContent).toBe('Add Skeen’s email so Skeen gets a copy.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Cc' }), { target: { value: 'skeen@gmail.com' } })
    expect(document.querySelector('[data-check="cc"]')).toBeNull()
    expect(mail.getAttribute('href')).toBe(mailtoHref(pack, { cc: 'skeen@gmail.com' }))
  })

  // Mark as sent: the artist, the item, and done = true; the row then says it was sent.
  it('Mark as sent calls the action with the artist, the item and true', async () => {
    show()
    expect(screen.getByText('not sent')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark as sent' }))
    })
    expect(markMock).toHaveBeenCalledTimes(1)
    expect(markMock).toHaveBeenCalledWith('a1', 'allmusic_bio', true)
    expect(screen.getByText(/^sent /)).toBeTruthy()
  })
})
