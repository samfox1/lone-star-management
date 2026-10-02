// Building a public page's title, description and share image from published data.
/**
 * SEO/OG — siteMetadata(site) builds the public page's title/description/OG
 * image from the PUBLISHED artist data, with sensible fallbacks when unset.
 * Pure (no DB); generateMetadata on /[slug] wraps it.
 */
import { describe, expect, it } from 'vitest'
import { siteMetadata } from '@/lib/seo'
import type { SiteData } from '@/lib/site'
import { siteData } from '@tests/helpers/site-data'

const site = (artist: Partial<SiteData['artist']> = {}): SiteData =>
  siteData({ artist: { slug: 'lone-pine', name: 'Lone Pine', bio: 'Dusty alt-country out of West Texas.', hero_image_url: 'https://img.example/hero.jpg', ...artist } })

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

/**
 * AI visibility audit #1 / F18 (2026-09-28): the built-in site's metadata is the bridge's
 * `resolveSeo`, not a second copy of it, so a template site and a connected site agree on
 * the title, the description and the image.
 */
describe('siteMetadata — one precedence with the bridge', () => {
  it('CRITICAL: a blank seo_title → the title composed from the facts; an override wins', () => {
    const facts = site({ genre: 'Alt-Country, Americana', location: 'Marfa, TX', schema_type: 'MusicGroup' })
    expect(siteMetadata(facts).title).toBe('Lone Pine · Marfa alt-country musician')
    expect(siteMetadata(facts).openGraph?.title).toBe('Lone Pine · Marfa alt-country musician')
    expect(siteMetadata({ ...facts, site_content: { seo_title: 'LONE PINE' } }).title).toBe('LONE PINE')
  })
  it('the SEO page card carries its size; the hero does not', () => {
    const card = 'https://x.supabase.co/storage/v1/object/public/media/a/og/social-card.png?v=2'
    const m = siteMetadata({ ...site(), site_content: { og_image: card } })
    expect(m.openGraph?.images).toEqual([{ url: card, width: 1200, height: 630 }])
    expect(siteMetadata(site()).openGraph?.images).toEqual(['https://img.example/hero.jpg'])
  })
})

/** The bridge's numbers are lone-star's numbers: one cap, one card size. */
describe('bridge ↔ dashboard constants', () => {
  it('MAX_TITLE is the seo_title save cap; OG_CARD_SIZE is the card the picker draws', async () => {
    const { MAX_TITLE, OG_CARD_SIZE } = await import('@samfox1/site-bridge/seo')
    const { SEO_LIMITS } = await import('@/lib/site-editor/save')
    const { OG_CARD_WIDTH, OG_CARD_HEIGHT } = await import('@/lib/manager-tools/seo/og-card')
    expect(SEO_LIMITS.seo_title).toBe(MAX_TITLE)
    expect(OG_CARD_SIZE).toEqual({ width: OG_CARD_WIDTH, height: OG_CARD_HEIGHT })
  })
})
