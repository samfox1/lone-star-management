import { createClient } from '@/lib/supabase/server'
import { seoSiteOrigin } from '@/lib/seo-tests/known'
import { requireArtist } from '../../../_data'
import { loadTestTab } from './test/load'
import { readSeoOverviewAction } from './test-actions'
import { buildOverview } from './overview/model'
import { SeoOverview } from './overview/overview'

/**
 * OVERVIEW, the SEO / GEO tool's first tab (/tools/seo): Sam's "Overview 3 · Timeline" from
 * prototypes/seo_variants_20260928_r2.html. What needs you now, then what really happened
 * (publishes, test runs and what changed between them), then visits over 30 days.
 *
 * Two reads, side by side, after the ownership gate: the Test tab's own (`loadTestTab`, the one
 * that tells "testing isn't switched on" from "couldn't read") for the headline and the to-do
 * list, and the overview reader for the timeline and the visits. A part that couldn't be read
 * is null and shows as "—" or a plain sentence, never as 0 (overview/model.ts).
 */
export default async function SeoOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const [tab, res] = await Promise.all([loadTestTab(await createClient(), id), readSeoOverviewAction(id)])
  const view = buildOverview({ tab, overview: res.ok ? res.overview : null, siteConnected: !!seoSiteOrigin(artist) })
  return <SeoOverview artistId={id} view={view} />
}
