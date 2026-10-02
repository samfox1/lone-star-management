import { listBrandColors } from '@/lib/manager-tools/brand/brand-colors'
import { brandSwatches } from '@/lib/site-editor/style-apply'
import { defaultTitleOf } from '@/lib/manager-tools/seo/default-title'
import { loadAltPhotos, loadSeoBase, loadShareSources } from './load'
import { DetailsTab } from './details/details-tab'

/**
 * DETAILS, the SEO / GEO tool's first tab and its own route (/tools/seo, Sam 2026-09-29; it was
 * the Listing tab at /tools/seo/listing, which now redirects here): how the artist shows up when
 * found or shared (round 2 mock: Google · Share · Photos; the share image is called the "preview
 * picture" since 2026-09-29). The ids `share` and `alt` are where a test's pencil lands
 * (lib/manager-tools/seo/sections.ts SEO_EDIT_TARGETS) and where the old /logo and /alt routes redirect:
 * details/details-tab.tsx keeps them on the rows that hold those settings, and landing on one
 * opens its editor.
 */
export default async function SeoDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  const [sources, photos, colors] = await Promise.all([
    loadShareSources(base),
    loadAltPhotos(base),
    // The Brand colours, as the site editor reads them (its swatches): the preview picture's
    // background choices. RLS-scoped; a failed read is no swatches, not a broken tab.
    listBrandColors(base.supabase, id).catch(() => []),
  ])
  return (
    <DetailsTab
      artistId={id}
      artistName={base.artist.name}
      defaultTitle={defaultTitleOf(base)}
      bio={base.bio}
      siteUrl={base.siteUrl}
      initial={{ seo_title: base.seo.seo_title ?? '', seo_description: base.seo.seo_description ?? '' }}
      shareUrl={base.content.og_image ?? ''}
      sources={sources}
      photos={photos}
      brandColors={brandSwatches(colors)}
    />
  )
}
