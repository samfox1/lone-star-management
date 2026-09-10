// Building a public page's title, description and share image from published data.
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
    styles: {},
    fonts: [],
    font_slots: {},
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

/**
 * The browser-tab icon.
 *
 * It is a `media` row with purpose `favicon`, DERIVED from the primary logo by the Brand
 * page (the framing has to be baked into the pixels — a favicon has no CSS at display
 * time). Metadata is the only route it has to the page head, so if this doesn't emit,
 * the artist's tab silently keeps the platform default and nothing says why.
 */
describe('siteMetadata — favicon', () => {
  const withMedia = (media: SiteData['media']): SiteData => ({ ...site(), media })

  it('emits the published favicon as the icon', () => {
    const meta = siteMetadata(
      withMedia([{ purpose: 'favicon', url: 'https://img.example/favicon.png' } as never]),
    )
    expect(meta.icons).toEqual({ icon: 'https://img.example/favicon.png' })
  })

  it('emits no icon when none is published — the browser default is correct then', () => {
    // Deliberately NOT falling back to the hero image or the raw logo: an unframed wide
    // logo squeezed into 32px is worse than no icon, and the Brand page exists precisely
    // so the manager chooses the crop.
    expect(siteMetadata(site()).icons).toBeUndefined()
  })

  it('CRITICAL: never emits an unsafe URL as an icon', () => {
    const meta = siteMetadata(withMedia([{ purpose: 'favicon', url: 'javascript:alert(1)' } as never]))
    expect(meta.icons).toBeUndefined()
  })

  it('ignores other media purposes', () => {
    const meta = siteMetadata(
      withMedia([{ purpose: 'logo_primary', url: 'https://img.example/logo.png' } as never]),
    )
    expect(meta.icons).toBeUndefined()
  })
})
