/**
 * Public-site SEO/OG metadata, derived from the PUBLISHED artist data so a fan
 * sharing /[slug] gets a proper title + preview card. Pure over SiteData (no DB);
 * generateMetadata on the public page wraps it. A manager's SEO overrides
 * (`seo_title` / `seo_description` / `og_image`, set on the Manager-tools → SEO
 * page and published with the site) take precedence; each unset field falls back
 * to an artist-derived default (name, bio, hero image).
 */
import type { Metadata } from 'next'
import type { SiteData } from '@/lib/site'
import { safeHref } from '@/lib/url'

function truncate(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/** Collapse whitespace + truncate, for a description drawn from free text. */
function toDescription(s: string): string {
  return truncate(s.replace(/\s+/g, ' ').trim())
}

/** Manager override → bio → a generic default. */
function resolveDescription(override: string, bio: string | null, name: string): string {
  if (override) return toDescription(override)
  if (bio) return toDescription(bio)
  return `${name} — official site`
}

export function siteMetadata(site: SiteData | null): Metadata {
  if (!site) return { title: 'Not found' }

  const { name, bio, hero_image_url } = site.artist
  const c = site.site_content

  const title = (c.seo_title || '').trim() || name
  const description = resolveDescription((c.seo_description || '').trim(), bio, name)
  // Override image wins; never emit an unsafe (javascript:/data:) URL as og:image.
  const ogImage = safeHref((c.og_image || '').trim() || hero_image_url)
  const images = ogImage ? [ogImage] : []

  // The browser-tab icon, derived from the primary logo by the Brand page and published
  // as a media row. Deliberately NO fallback to the hero image or the raw logo: an
  // unframed wide lockup squeezed into 32px reads as a smudge, which is worse than the
  // browser's default, and the Brand page exists so the manager picks the crop.
  // Through safeHref like every other rendered URL — a media row is manager-supplied.
  const favicon = safeHref(site.media.find((m) => m.purpose === 'favicon')?.url)

  return {
    title,
    description,
    ...(favicon ? { icons: { icon: favicon } } : {}),
    openGraph: { title, description, type: 'website', images },
    twitter: {
      card: images.length ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  }
}
