/**
 * Custom-site helpers (SITE_STYLING_PLAN.md). An artist's public site is either a
 * built-in template or a fully custom site hosted elsewhere (e.g. the Vercel
 * skeen-website). The `site_kind` / `custom_site_url` columns are config, not
 * published content, so they're read directly from `artists` — never through the
 * published snapshot (get_public_site) or ARTIST_SNAPSHOT.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** The external URL a custom-site artist redirects to / is embedded from, or null
 *  when the artist uses a built-in template. */
export async function customSiteUrl(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await supabase
    .from('artists')
    .select('site_kind, custom_site_url')
    .eq('slug', slug)
    .maybeSingle<{ site_kind: string; custom_site_url: string | null }>()
  return isCustom(data) ? (data!.custom_site_url as string) : null
}

/** Whether a `{ site_kind, custom_site_url }` row is a usable custom site. */
export function isCustom(row: { site_kind?: string | null; custom_site_url?: string | null } | null): boolean {
  return !!row && row.site_kind === 'custom' && !!row.custom_site_url
}
