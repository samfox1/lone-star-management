import { dashboardDiff, requireArtist } from '../../_data'
import { publicSiteOrigin } from '@/lib/custom-site'
import { SeoTopRow } from './top-row'

/**
 * Every SEO / GEO section shares one top row: Publish appears only while something this
 * editor changes (site text, the profile, media) is unpublished (Sam, 2026-08-28).
 */
export default async function SeoLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params
  const [artist, diff] = await Promise.all([requireArtist(id), dashboardDiff(id)])
  const unpublished = diff.profile.dirty || diff.site_content.dirty || diff.media.dirty
  return (
    <div className="flex flex-col gap-8 pb-24">
      <SeoTopRow artistId={id} unpublished={unpublished} siteUrl={publicSiteOrigin(artist)} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
