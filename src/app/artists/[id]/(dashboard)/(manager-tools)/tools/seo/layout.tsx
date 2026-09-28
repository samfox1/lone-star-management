import { dashboardDiff, requireArtist } from '../../../_data'
import { publicSiteOrigin } from '@/lib/custom-site'
import { siteUnpublished } from '@/lib/content'
import { SeoTopRow } from './top-row'

/**
 * Every SEO / GEO section shares one top row: Publish appears only while something this
 * editor changes (site text, the profile, media) is unpublished (Sam, 2026-08-28).
 * `siteUnpublished`: exactly what this Publish ships — never a Brand logo (2026-09-28),
 * which the Brand bar publishes, so a bar lit by one could never be cleared from here.
 */
export default async function SeoLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params
  const [artist, diff] = await Promise.all([requireArtist(id), dashboardDiff(id)])
  const unpublished = siteUnpublished(diff)
  return (
    <div className="flex flex-col gap-8 pb-24">
      <SeoTopRow artistId={id} unpublished={unpublished} siteUrl={publicSiteOrigin(artist)} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
