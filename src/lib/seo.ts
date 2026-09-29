/**
 * Public-site SEO/OG metadata, derived from the PUBLISHED artist data so a fan
 * sharing /[slug] gets a proper title + preview card. Pure over SiteData (no DB);
 * generateMetadata on the public page wraps it.
 *
 * The title, description and image are the bridge's `resolveSeo` (AI visibility audit
 * F18, 2026-09-28): this file used to carry a second copy of that precedence, and a
 * built-in template site and a connected site must not disagree about either. So: the
 * manager's SEO overrides (`seo_title` / `seo_description` / `og_image`, set on the
 * Manager-tools → SEO page and published with the site) win; a blank title is composed
 * from the facts ("Skeen · Chicago house musician"); the bio, then "<name> — official
 * site", is the description; the card, then the hero, is the image.
 */
import type { Metadata } from 'next'
import { resolveSeo } from '@samfox1/site-bridge/seo'
import type { SiteData } from '@/lib/site'
import { safeHref } from '@/lib/url'

export function siteMetadata(site: SiteData | null): Metadata {
  if (!site) return { title: 'Not found' }

  const { title, description, ogImage, ogImageSize } = resolveSeo(site)
  // http(s) only (resolveSeo's guard): never a javascript:/data: URL as og:image. The
  // size only when it is KNOWN (the SEO page's 1200×630 card), never guessed for a hero.
  const images = ogImage ? [ogImageSize ? { url: ogImage, ...ogImageSize } : ogImage] : []

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
