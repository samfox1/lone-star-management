import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { diffUnpublished } from '@/lib/content'

/**
 * Load the artist for the current dashboard request, or 404. `cache()` dedupes
 * within one render pass, so the layout AND each section page can call this and
 * the row is fetched once — while every page keeps its own ownership guard
 * (the layout's notFound() does NOT stop sub-pages from rendering, since App
 * Router renders layouts and pages in parallel). RLS scopes the read, so a
 * non-owner's .single() errors → notFound().
 */
export const requireArtist = cache(async (id: string) => {
  const supabase = await createClient()
  const { data: artist, error } = await supabase
    .from('artists')
    .select(
      'id, name, slug, template, spotify_artist_id, bandsintown_name, deezer_artist_id, apple_artist_id, ticketmaster_attraction_id, youtube_channel_id, drive_folder_id, site_kind, custom_site_url',
    )
    .eq('id', id)
    .single()
  if (error || !artist) notFound()
  return artist
})

/**
 * The unpublished-vs-published diff that powers the nav's dirty dots. This is the ~11
 * concurrent-query op that dominates the dashboard's parallel read wave (every other
 * read is one query; on a pooled connection this one is the bottleneck), so it's the
 * one worth a SERVER cache.
 *
 * `unstable_cache` caches the result per artist id across requests for 30s. It runs
 * OUTSIDE the request (can't read the session cookie), so it uses the service-role
 * client — SAFE because `requireArtist` (RLS, uncached) gates ownership on the live
 * path before this ever renders; a non-owner 404s and never sees the value. Keyed on
 * the id argument, so each artist caches separately. Time-based only, NO write-time
 * invalidation: the dots are cosmetic, so being up to 30s stale after a publish is
 * fine, and it keeps every content mutation off the invalidation hook. Content lists
 * (listContent) are deliberately NOT cached, so what the manager edits is always fresh.
 */
export const dashboardDiff = unstable_cache(
  (id: string) => diffUnpublished(createAdminClient(), id),
  ['dashboard-diff'],
  { revalidate: 30 },
)

/** The connected Shopify store domain for an artist, or null. Cached per request. */
export const getShopifyDomain = cache(async (id: string): Promise<string | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('integrations')
    .select('metadata')
    .eq('artist_id', id)
    .eq('provider', 'shopify')
    .maybeSingle()
  return (data?.metadata as { store_domain?: string } | null)?.store_domain ?? null
})
