import { defaultTitleOf, loadAltPhotos, loadSeoBase, loadShareSources } from '../load'
import { ListingTab } from './listing-tab'

/**
 * LISTING: how the artist shows up when found or shared (round 2 mock: Google · Share ·
 * Photos). The ids `share` and `alt` are where a test's pencil lands (sections.ts
 * SEO_EDIT_TARGETS) and where the old /logo and /alt routes redirect: listing-tab.tsx keeps
 * them on the rows that hold those settings, and landing on one opens its editor.
 */
export default async function SeoListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  const [sources, photos] = await Promise.all([loadShareSources(base), loadAltPhotos(base)])
  return (
    <ListingTab
      artistId={id}
      artistName={base.artist.name}
      defaultTitle={defaultTitleOf(base)}
      bio={base.bio}
      siteUrl={base.siteUrl}
      initial={{ seo_title: base.seo.seo_title ?? '', seo_description: base.seo.seo_description ?? '' }}
      shareUrl={base.content.og_image ?? ''}
      sources={sources}
      photos={photos}
    />
  )
}
