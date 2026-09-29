import type { SupabaseClient } from '@supabase/supabase-js'
import { CONNECTIONS, buildConnectionRows, isProfileLink, type ConnectionSection, type SourceCounts } from '@/lib/connections'
import { provenBy, type IntegrationKey, type IntegrationSection } from '@/lib/integrations-registry'
import { listContent } from '@/lib/content'
import { createClient } from '@/lib/supabase/server'
import { shopifyAppConfigured, shopifyReturnNotice } from '@/lib/merch/shopify-oauth'
import { youtubeOAuthConfigured, youtubeReturnNotice } from '@/lib/youtube-oauth'
import { eventbriteOAuthConfigured, eventbriteReturnNotice, eventbriteSignedInState } from '@/lib/eventbrite-oauth'
import { publicSiteOrigin } from '@/lib/custom-site'
import { musicBrainzCreateUrl } from '@/lib/manager-tools/connections/services/musicbrainz/seed'
import { dashboardDiff, getEventbriteSignedIn, getShopifyDomain, requireArtist } from '../../_data'
import { ConnectionList } from './connection-list'
import { EventbriteReturnNotice, ShopifyReturnNotice, YouTubeReturnNotice } from './shopify-return'

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

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Back from Shopify's approve screen, Google's or Eventbrite's sign-in: the callback sends
  // a CODE, the words are chosen here.
  const query = await searchParams
  const shopifyReturn = shopifyReturnNotice(query)
  const youtubeReturn = youtubeReturnNotice(query)
  const eventbriteReturn = eventbriteReturnNotice(query)
  const supabase = await createClient()
  const [artist, shopifyDomain, eventbriteStored, links, counts, diff, { data: facts }] = await Promise.all([
    requireArtist(id),
    getShopifyDomain(id),
    getEventbriteSignedIn(id),
    listContent(supabase, 'link', id),
    sourceCounts(supabase, id),
    dashboardDiff(id),
    // The SEO facts, for the MusicBrainz seed below (RLS-scoped like the rest).
    supabase.from('artists').select('location, schema_type').eq('id', id).single(),
  ])
  // ContentRow is a bag of unknowns; name the four columns the model reads.
  const linkRows = links.map((l) => ({
    id: l.id,
    label: (l.label as string | null) ?? null,
    url: (l.url as string | null) ?? null,
    on_site: (l.on_site as boolean | null) ?? null,
    role: (l.role as string | null) ?? null,
  }))
  const rows = buildConnectionRows({ links: linkRows, artist, shopifyConnected: !!shopifyDomain, signedIn: { eventbrite: eventbriteSignedInState(eventbriteStored) }, counts })

  // No MusicBrainz page yet (AI_VISIBILITY_AUDIT.md 4.1): its Connect row offers MusicBrainz's
  // own artist editor, filled from what we know. Only "Visual artist" says person; the
  // default "Musician" says nothing about person vs group, so the artist picks it there.
  const createPages: Partial<Record<string, string>> = rows.some((r) => r.key === 'musicbrainz')
    ? {}
    : {
        musicbrainz: musicBrainzCreateUrl({
          name: artist.name,
          type: facts?.schema_type === 'Person' ? 'person' : null,
          area: (facts?.location as string | null) ?? null,
          homepage: publicSiteOrigin(artist),
          links: linkRows.filter(isProfileLink),
        }),
      }

  // The floating Publish lights up on unpublished link EDITS — the same flag behind the
  // nav's pending dot, so the two always agree (the tour page's rule).
  // `shopifyApp` / `youtubeApp` / `eventbriteApp` are the one thing about each app the browser
  // learns: whether it is set up. The ids and the secrets stay on the server.
  return (
    <>
      {shopifyReturn && <ShopifyReturnNotice {...shopifyReturn} />}
      {youtubeReturn && <YouTubeReturnNotice {...youtubeReturn} />}
      {eventbriteReturn && <EventbriteReturnNotice {...eventbriteReturn} />}
      <ConnectionList
        artistId={id}
        rows={rows}
        dirty={diff.link.dirty}
        shopifyApp={shopifyAppConfigured()}
        youtubeApp={youtubeOAuthConfigured()}
        eventbriteApp={eventbriteOAuthConfigured()}
        createPages={createPages}
      />
    </>
  )
}
