import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, siteUnpublished, type UnpublishedDiff } from '@/lib/content'
import { dashboardDiff, requireArtist } from '../../../_data'
import { pendingMessage } from '@/lib/manager-tools/seo/pending'
import { SeoRiser } from './seo-riser'

/**
 * SEO / GEO (Sam, 2026-09-28, the round 2 design; tabs since 2026-09-29: Details · Facts · Answers ·
 * AI test): four tabs on the thin rail's second panel
 * (lib/manager-tools/seo/sections.ts), the page up to ~1180px like Brand, and ONE rising Publish bar shared by every
 * tab. A layout does not re-render on a tab switch, so the bar keeps its place; a save's
 * router.refresh re-renders it.
 *
 * What the bar ships: `siteUnpublished` (the site's words, the profile and the site's photos —
 * never a Brand logo, which the Brand bar publishes) and the links, which a test's fix can
 * change (seo-riser.tsx).
 */
export default async function SeoLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params
  return (
    <div className="max-w-[1180px] pb-28">
      {children}
      {/* Its own boundary, so the pending check never holds up the tab it sits under. */}
      <Suspense fallback={null}>
        <PendingBar artistId={id} />
      </Suspense>
    </div>
  )
}

async function PendingBar({ artistId }: { artistId: string }) {
  // FRESH, not the 30 s dashboard cache: a test's fix must raise the bar on the refresh that
  // follows it. RLS-scoped. If it fails, the cached diff is better than no bar at all.
  await requireArtist(artistId) // the ownership gate, before the cached (service-role) fallback
  let diff: UnpublishedDiff
  try {
    diff = await diffUnpublished(await createClient(), artistId)
  } catch {
    diff = await dashboardDiff(artistId)
  }
  return <SeoRiser artistId={artistId} site={siteUnpublished(diff)} links={!!diff.link?.dirty} message={pendingMessage(diff)} />
}
