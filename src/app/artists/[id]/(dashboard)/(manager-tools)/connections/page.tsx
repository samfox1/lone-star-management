import type { SupabaseClient } from '@supabase/supabase-js'
import { CONNECTIONS, buildConnectionRows, type ConnectionSection, type SourceCounts } from '@/lib/connections'
import { provenBy, type IntegrationKey, type IntegrationSection } from '@/lib/integrations-registry'
import { listContent } from '@/lib/content'
import { createClient } from '@/lib/supabase/server'
import { dashboardDiff, getShopifyDomain, requireArtist } from '../../_data'
import { ConnectionList } from './connection-list'

export const metadata = { title: 'Connections — Lone Star Management' }

/**
 * CONNECTIONS — one page for every outside platform (Sam, 2026-09-13). It replaced the
 * Links page and the Integrations hub; see lib/connections.ts for the model, and the
 * list component for the rows. No heading: the rail names the tool.
 *
 * "Synced" is PROVEN, not assumed: a source counts as synced only when rows written by
 * it exist. A connected id that pulled nothing reads as a failure on the page, because
 * that is what it is.
 */

/** Which table a section's pulled rows land in; `null` for a source that stores nothing
 *  (Drive is browsed, not imported — connected is as proven as it gets). */
const SECTION_TABLE: Record<ConnectionSection, string | null> = {
  music: 'tracks',
  videos: 'videos',
  tour: 'tour_dates',
  files: null,
  merch: 'merch',
}

/** Rows per source, counted where they landed and by what proves them (`provenBy`:
 *  a music source's id column, since merged catalogs never carry its `source`). A
 *  failed count throws — a reader that answered 0 would print "couldn't connect". */
async function sourceCounts(supabase: SupabaseClient, artistId: string): Promise<SourceCounts> {
  const pulling = CONNECTIONS.filter((d) => d.source)
  const counts = await Promise.all(
    pulling.map(async (d) => {
      const table = SECTION_TABLE[d.source!.section]
      if (!table) return [d.source!.key, 1] as const
      const proof = provenBy({ key: d.source!.key as IntegrationKey, section: d.source!.section as IntegrationSection })
      const base = supabase.from(table).select('id', { count: 'exact', head: true }).eq('artist_id', artistId)
      const { count, error } = await (proof.op === 'not-null' ? base.not(proof.column, 'is', null) : base.eq(proof.column, proof.value!))
      if (error) throw new Error(`${table} for ${d.source!.key}: ${error.message}`)
      return [d.source!.key, count ?? 0] as const
    }),
  )
  return Object.fromEntries(counts)
}

export default async function ConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [artist, shopifyDomain, links, counts, diff] = await Promise.all([
    requireArtist(id),
    getShopifyDomain(id),
    listContent(supabase, 'link', id),
    sourceCounts(supabase, id),
    dashboardDiff(id),
  ])
  const rows = buildConnectionRows({
    // ContentRow is a bag of unknowns; name the four columns the model reads.
    links: links.map((l) => ({
      id: l.id,
      label: (l.label as string | null) ?? null,
      url: (l.url as string | null) ?? null,
      on_site: (l.on_site as boolean | null) ?? null,
      role: (l.role as string | null) ?? null,
    })),
    artist,
    shopifyConnected: !!shopifyDomain,
    counts,
  })

  // The floating Publish lights up on unpublished link EDITS — the same flag behind the
  // nav's pending dot, so the two always agree (the tour page's rule).
  return <ConnectionList artistId={id} rows={rows} dirty={diff.link.dirty} />
}
