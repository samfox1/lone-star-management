import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, siteUnpublished, type UnpublishedDiff } from '@/lib/content'
import { pendingMessage } from '@/lib/manager-tools/site-pending'
import { dashboardDiff, requireArtist } from '../../_data'
import { SiteRiser } from './site-riser'

/**
 * The site Publish bar with what is waiting (site-riser.tsx), for SEO / GEO, Profile, Connections
 * and EPK (Batch 3, 2026-10-02: a link edited in a connection's pop-up waits here). Moved out of
 * tools/seo/layout.tsx when Profile shared it (2026-10-02). Render it inside its own <Suspense>,
 * so the pending check never holds up the page above it.
 *
 * FRESH, not the 30 s dashboard cache: a save (or a test's fix) must raise the bar on the refresh
 * that follows it. RLS-scoped. If it fails, the cached diff is better than no bar at all.
 */
export async function SitePendingBar({ artistId }: { artistId: string }) {
  await requireArtist(artistId) // the ownership gate, before the cached (service-role) fallback
  let diff: UnpublishedDiff
  try {
    diff = await diffUnpublished(await createClient(), artistId)
  } catch {
    diff = await dashboardDiff(artistId)
  }
  return <SiteRiser artistId={artistId} site={siteUnpublished(diff)} links={!!diff.link?.dirty} message={pendingMessage(diff)} />
}
