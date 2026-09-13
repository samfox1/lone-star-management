import type { SupabaseClient } from '@supabase/supabase-js'
import { buttonClass } from '@/components/ui/ui'
import { CONNECTIONS, buildConnectionRows, type ConnectionSection, type SourceCounts } from '@/lib/connections'
import { listContent } from '@/lib/content'
import { createClient } from '@/lib/supabase/server'
import { ActionButton } from '../action-button'
import { publishSectionAction } from '../actions'
import { getShopifyDomain, requireArtist } from '../_data'
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

/** Rows per source, counted where they landed — derived from the connections that pull. */
async function sourceCounts(supabase: SupabaseClient, artistId: string): Promise<SourceCounts> {
  const pulling = CONNECTIONS.filter((d) => d.source)
  const counts = await Promise.all(
    pulling.map(async (d) => {
      const table = SECTION_TABLE[d.source!.section]
      if (!table) return [d.source!.key, 1] as const
      const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('artist_id', artistId).eq('source', d.source!.key)
      return [d.source!.key, count ?? 0] as const
    }),
  )
  return Object.fromEntries(counts)
}

export default async function ConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [artist, shopifyDomain, links, counts] = await Promise.all([
    requireArtist(id),
    getShopifyDomain(id),
    listContent(supabase, 'link', id),
    sourceCounts(supabase, id),
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

  return (
    <ConnectionList
      artistId={id}
      rows={rows}
      publish={
        <ActionButton
          action={publishSectionAction.bind(null, 'link', id)}
          savedMessage="Published connections"
          busyLabel="Publishing…"
          className={buttonClass('ghost')}
        >
          Publish
        </ActionButton>
      }
    />
  )
}
