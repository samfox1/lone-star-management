import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, type UnpublishedDiff } from '@/lib/content'
import { isCustom } from '@/lib/custom-site'
import { siteAddress, type OverviewCounts } from '@/lib/manager-tools/overview/overview'
import { dashboardDiff, getShopifyDomain, requireArtist } from '../../_data'
import { connectedCount } from '../../integrations'

/**
 * WHAT THE OVERVIEW READS: the artist row (the ownership gate), the unpublished diff, and the
 * three counts its tool rows show (subscribers, unread enquiries, connected sources). The same
 * reads the old cards made. RLS-scoped.
 *
 * The diff is FRESH, not the 30 s dashboard cache: the Publish bar must go down on the refresh
 * after its own Publish (site-pending.tsx reads it the same way). If the fresh read fails, the
 * cached one, but only once the gate has passed (the cache is service-role).
 */
export async function loadOverview(id: string) {
  const supabase = await createClient()
  const gate = requireArtist(id)
  const [artist, shopifyDomain, diff, subscribers, unread] = await Promise.all([
    gate,
    getShopifyDomain(id),
    freshDiff(supabase, id, gate),
    supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('artist_id', id),
    supabase.from('enquiries').select('id', { count: 'exact', head: true }).eq('artist_id', id).is('read_at', null),
  ])
  const counts: OverviewCounts = {
    connected: connectedCount(artist, !!shopifyDomain),
    subscribers: subscribers.error ? null : (subscribers.count ?? 0),
    unread: unread.error ? null : (unread.count ?? 0),
  }
  return {
    slug: artist.slug as string,
    customSite: isCustom(artist),
    address: siteAddress({ slug: artist.slug as string, site_kind: artist.site_kind as string | null, custom_site_url: artist.custom_site_url as string | null }),
    counts,
    diff,
  }
}

async function freshDiff(supabase: SupabaseClient, id: string, gate: Promise<unknown>): Promise<UnpublishedDiff> {
  try {
    return await diffUnpublished(supabase, id)
  } catch {
    await gate
    return dashboardDiff(id)
  }
}
