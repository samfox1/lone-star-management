/**
 * Public-site SEO/OG metadata, derived from the PUBLISHED artist data so a fan
 * sharing /[slug] gets a proper title + preview card. Pure over SiteData (no
 * DB); generateMetadata on the public page wraps it. Dedicated SEO override
 * fields (custom title/description in Settings) can layer on later.
 */
import type { Metadata } from 'next'
import type { SiteData } from '@/lib/site'
import { safeHref } from '@/lib/url'

function truncate(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

export function siteMetadata(site: SiteData | null): Metadata {
  if (!site) return { title: 'Not found' }

  const { name, bio, hero_image_url } = site.artist
  const description = bio ? truncate(bio.replace(/\s+/g, ' ').trim()) : `${name} — official site`
  // Never emit an unsafe (javascript:/data:) URL as og:image.
  const ogImage = safeHref(hero_image_url)
  const images = ogImage ? [ogImage] : []

  return {
    title: name,
    description,
    openGraph: { title: name, description, type: 'website', images },
    twitter: {
      card: images.length ? 'summary_large_image' : 'summary',
      title: name,
      description,
    },
  }
}
