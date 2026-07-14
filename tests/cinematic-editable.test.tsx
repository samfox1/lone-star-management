// @vitest-environment jsdom
/**
 * Phase 1 — the cinematic template emits the `data-lse-*` markers ONLY in edit
 * mode. Renders the template with mocked heavy children (hero/work/embed/subscribe)
 * so the test is fast and focuses on the marked regions: a section is a slot, its
 * heading is a field, and each row is an item. Off edit mode, no markers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SiteData } from '@/lib/site'
import { CinematicTemplate } from '@/components/templates/cinematic'

vi.mock('@/components/templates/cinematic-hero', () => ({ CinematicHero: () => <div data-testid="hero" /> }))
vi.mock('@/components/templates/cinematic-work', () => ({ CinematicWork: () => <div data-testid="work" /> }))
vi.mock('@/components/video-embed', () => ({ VideoEmbed: () => <div data-testid="embed" /> }))
vi.mock('@/components/subscribe-form', () => ({ SubscribeForm: () => <div data-testid="subscribe" /> }))

const TOUR_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const VIDEO_ID = 'bbbbbbbb-0000-4000-8000-000000000002'

function siteData(): SiteData {
  return {
    artist: {
      id: 'artist-1',
      slug: 'demo',
      name: 'Demo Artist',
      bio: 'Line one',
      hero_image_url: 'https://img/hero.jpg',
      template: 'cinematic',
      spotify_artist_id: null,
    },
    tracks: [],
    tour_dates: [
      { id: TOUR_ID, date: '2099-06-01', venue: 'The Venue', city: 'Austin', country: 'US', ticket_url: null },
    ],
    merch: [],
    links: [],
    videos: [
      { id: VIDEO_ID, title: 'A video', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/x', storage_path: null, sort_order: 0 },
    ],
    media: [],
    site_content: {},
    styles: {},
  }
}

afterEach(cleanup)

describe('cinematic template — edit-mode markers', () => {
  it('marks slots, fields, and items when editable', () => {
    const { container } = render(<CinematicTemplate data={siteData()} editable />)

    // Shows section: slot + heading field + item row.
    expect(container.querySelector('[data-lse-slot="shows"]')).not.toBeNull()
    expect(container.querySelector('[data-lse-field="shows_heading"]')).not.toBeNull()
    expect(container.querySelector(`[data-lse-item="tour_date:${TOUR_ID}"]`)).not.toBeNull()

    // Videos section: slot + heading field + item.
    expect(container.querySelector('[data-lse-slot="videos"]')).not.toBeNull()
    expect(container.querySelector('[data-lse-field="videos_heading"]')).not.toBeNull()
    expect(container.querySelector(`[data-lse-item="video:${VIDEO_ID}"]`)).not.toBeNull()

    // About profile photo (image field) + Footer booking heading (text field).
    expect(container.querySelector('[data-lse-field="profile_photo"]')).not.toBeNull()
    expect(container.querySelector('[data-lse-field="bookings_heading"]')).not.toBeNull()
  })

  it('emits NO markers when not editable (the public site)', () => {
    const { container } = render(<CinematicTemplate data={siteData()} />)
    expect(container.querySelector('[data-lse-slot]')).toBeNull()
    expect(container.querySelector('[data-lse-field]')).toBeNull()
    expect(container.querySelector('[data-lse-item]')).toBeNull()
  })
})
