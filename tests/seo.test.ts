/**
 * SEO/OG — siteMetadata(site) builds the public page's title/description/OG
 * image from the PUBLISHED artist data, with sensible fallbacks when unset.
 * Pure (no DB); generateMetadata on /[slug] wraps it.
 */
import { describe, expect, it } from 'vitest'
import { siteMetadata } from '@/lib/seo'
import type { SiteData } from '@/lib/site'

function site(artist: Partial<SiteData['artist']> = {}): SiteData {
  return {
    artist: {
      id: 'a',
      slug: 'lone-pine',
      name: 'Lone Pine',
      bio: 'Dusty alt-country out of West Texas.',
      hero_image_url: 'https://img.example/hero.jpg',
      template: 'classic',
      spotify_artist_id: null,
      ...artist,
    },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [],
    videos: [],
    media: [],
    site_content: {},
  }
}

describe('siteMetadata', () => {
  it('uses the artist name, bio, and hero image', () => {
    const m = siteMetadata(site())
    expect(m.title).toBe('Lone Pine')
    expect(m.description).toContain('Dusty alt-country')
    expect(m.openGraph?.images).toEqual(['https://img.example/hero.jpg'])
    expect((m.twitter as { card?: string } | null | undefined)?.card).toBe('summary_large_image')
  })

  it('falls back sensibly when bio and hero are unset', () => {
    const m = siteMetadata(site({ bio: null, hero_image_url: null }))
    expect(m.title).toBe('Lone Pine')
    expect(m.description).toContain('Lone Pine') // derived fallback
    expect(m.openGraph?.images ?? []).toHaveLength(0)
    expect((m.twitter as { card?: string } | null | undefined)?.card).toBe('summary') // no image → small card
  })

  it('drops an unsafe hero URL from the OG image', () => {
    const m = siteMetadata(site({ hero_image_url: 'javascript:alert(1)' }))
    expect(m.openGraph?.images ?? []).toHaveLength(0)
  })

  it('returns a not-found title for a null (unpublished/missing) site', () => {
    expect(siteMetadata(null).title).toBe('Not found')
  })
})
