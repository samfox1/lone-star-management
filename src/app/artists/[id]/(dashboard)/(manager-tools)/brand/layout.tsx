import { Suspense } from 'react'
import { loadBrandPending } from '@/lib/manager-tools/brand/brand-pending'
import { BrandRiser } from './_ui/brand-riser'

/**
 * BRAND (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): four tabs — Logos · Colors · Fonts · Tab
 * icon — share this frame. The ledger fills the width up to ~1180px; the one Publish bar
 * rises from the bottom when a real change is waiting. `pb-28` is the room under the last
 * row; while the bar is up it adds its OWN measured height on top (PublishRiser's in-flow
 * spacer, review 2 2026-09-24 — a fixed pb-28 left the bottom colour panel under the bar).
 * No brand-kit download button (Sam, 2026-09-24: removed; the kit route stays,
 * unlinked, for a later home).
 *
 * A layout does not re-render on a tab switch (Next 16 docs, layout.md), which is what
 * lets the bar keep its place; a save's revalidatePath / router.refresh re-renders it.
 */
export default async function BrandLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
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

/** Always mounted once loaded: hidden (off-screen, inert) while nothing is pending, so it
 *  can SLIDE up when a refresh brings `dirty` — a bar mounted only when dirty would just
 *  appear. `loadBrandPending` is BRAND-SCOPED (brand media purposes + font slots), never
 *  every media row on the account, and fails closed (hidden). */
async function PendingBar({ artistId }: { artistId: string }) {
  const pending = await loadBrandPending(artistId)
  return <BrandRiser artistId={artistId} dirty={pending.dirty} message={pending.message} canRevert={pending.canRevert} />
}
