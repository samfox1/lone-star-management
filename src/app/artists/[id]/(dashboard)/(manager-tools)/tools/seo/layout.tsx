import { Suspense } from 'react'
import { SitePendingBar } from '../../_ui/site-pending'

/**
 * SEO / GEO (Sam, 2026-09-28, the round 2 design; tabs since 2026-09-29, Facts moved to Profile
 * 2026-10-02: Details · Answers · AI test · Profiles): the tabs on the thin rail's second panel
 * (lib/manager-tools/seo/sections.ts), the page in the tools shell's one frame (TOOL_FRAME, up to
 * 1180px like every tool), and ONE rising Publish bar shared by every tab. A layout does not re-render on a tab switch, so the bar keeps its
 * place; a save's router.refresh re-renders it.
 *
 * What the bar ships: `siteUnpublished` (the site's words, the profile and the site's photos —
 * never a Brand logo, which the Brand bar publishes) and the links, which a test's fix can
 * change (_ui/site-riser.tsx). Profile shows the same bar (_ui/site-pending.tsx).
 */
export default async function SeoLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params
  return (
    <>
      {children}
      {/* Its own boundary, so the pending check never holds up the tab it sits under. */}
      <Suspense fallback={null}>
        <SitePendingBar artistId={id} />
      </Suspense>
    </>
  )
}
