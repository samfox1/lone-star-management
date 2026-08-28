import type { IconName } from '@/components/ui/icons'

/**
 * The SEO / GEO editor's sub-sections (Sam, 2026-08-28): a second panel to the right of
 * the tools panel lists them; each is its own screen. The registry the panel, the
 * routes and the tests derive from — never hand-list sections elsewhere.
 */
export const SEO_SECTIONS: readonly { seg: string; label: string; icon: IconName }[] = [
  { seg: 'listing', label: 'Search listing', icon: 'search' },
  { seg: 'logo', label: 'Share image', icon: 'photo' },
  { seg: 'facts', label: 'Facts', icon: 'note' },
  { seg: 'about', label: 'About', icon: 'text' },
  { seg: 'alt', label: 'Alt tags', icon: 'grid' },
  { seg: 'ai', label: 'AI visibility', icon: 'bolt' },
  { seg: 'test', label: 'Test', icon: 'check' },
]
export type SeoSection = (typeof SEO_SECTIONS)[number]['seg']
export const DEFAULT_SEO_SECTION: SeoSection = 'listing'
export function isSeoSection(s: string): s is SeoSection {
  return SEO_SECTIONS.some((x) => x.seg === s)
}
