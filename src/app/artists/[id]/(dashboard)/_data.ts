import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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
    .select('id, name, slug, template, spotify_artist_id, bandsintown_name')
    .eq('id', id)
    .single()
  if (error || !artist) notFound()
  return artist
})

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
