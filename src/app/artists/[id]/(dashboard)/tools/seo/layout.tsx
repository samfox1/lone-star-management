import { dashboardDiff } from '../../_data'
import { SeoTopRow } from './top-row'

/**
 * Every SEO / GEO section shares one top row: Publish appears only while something this
 * editor changes (site text, the profile, media) is unpublished (Sam, 2026-08-28).
 */
export default async function SeoLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params
  const diff = await dashboardDiff(id)
  const unpublished = diff.profile.dirty || diff.site_content.dirty || diff.media.dirty
  return (
    <div className="flex flex-col gap-6">
      <SeoTopRow artistId={id} unpublished={unpublished} />
      <div className="max-w-[760px]">{children}</div>
    </div>
  )
}
