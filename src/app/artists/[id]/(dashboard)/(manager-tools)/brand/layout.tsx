import { Suspense } from 'react'
import { loadBrandPending } from '@/lib/manager-tools/brand/brand-pending'
import { BrandCheckFailed, BrandRiser } from './_ui/brand-riser'

/**
 * BRAND (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): four tabs — Logos · Colors · Fonts · Tab
 * icon — share this layout. The page's width and the room under its last row are the tools
 * shell's one frame now (TOOL_FRAME, _shell/tools-rail.tsx: Brand's 1180px, set once for every
 * tool in Batch 3); the one Publish bar rises from the bottom when a real change is waiting,
 * and while it is up it adds its OWN measured height on top (PublishRiser's in-flow spacer,
 * review 2 2026-09-24 — a fixed pb-28 left the bottom colour panel under the bar).
 * No brand-kit download button (Sam, 2026-09-24: removed; the kit route stays,
 * unlinked, for a later home).
 *
 * A layout does not re-render on a tab switch (Next 16 docs, layout.md), which is what
 * lets the bar keep its place; a save's revalidatePath / router.refresh re-renders it.
 */
export default async function BrandLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <>
      {children}
      {/* Its own boundary, so the pending check never holds up the tab it sits under. */}
      <Suspense fallback={null}>
        <PendingBar artistId={id} />
      </Suspense>
    </>
  )
}

/** Always mounted once loaded: hidden (off-screen, inert) while nothing is pending, so it
 *  can SLIDE up when a refresh brings `dirty` — a bar mounted only when dirty would just
 *  appear. `loadBrandPending` is BRAND-SCOPED (brand media purposes, fonts + slots, colours
 *  and the browser-bar colour), never every media row on the account. A check that FAILED
 *  says so (BrandCheckFailed) rather than hiding the bar, which reads as "all published". */
async function PendingBar({ artistId }: { artistId: string }) {
  const pending = await loadBrandPending(artistId)
  if (pending.failed) return <BrandCheckFailed />
  return <BrandRiser artistId={artistId} dirty={pending.dirty} message={pending.message} canRevert={pending.canRevert} />
}
