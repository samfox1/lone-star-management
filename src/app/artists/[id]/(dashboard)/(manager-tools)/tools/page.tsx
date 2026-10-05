import { loadOverview } from './load'
import { OverviewView } from './overview-view'

export const metadata = { title: 'Overview — Lone Star Management' }

/**
 * The Overview of the manager tools (Sam, 2026-10-05, prototypes/overview_20261002.html): the
 * site's state and every tool, on Brand's ledger. load.ts reads, lib/manager-tools/overview
 * decides the words, overview-view.tsx draws. No width of its own: ToolsShell sets one.
 *
 * ↗ goes to /[slug], which 308s a custom-site artist to their own site.
 */
export default async function ToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const o = await loadOverview(id)
  return <OverviewView artistId={id} customSite={o.customSite} address={o.address} viewHref={`/${o.slug}`} counts={o.counts} diff={o.diff} />
}
