/**
 * Custom-site helpers (SITE_STYLING_PLAN.md). An artist's public site is either a
 * built-in template or a fully custom site hosted elsewhere (e.g. the Vercel
 * skeen-website). The `site_kind` / `custom_site_url` columns are config, not
 * published content, so they're read directly from `artists` — never through the
 * published snapshot (get_public_site) or ARTIST_SNAPSHOT.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The external URL a custom-site artist redirects to / is embedded from, or null
 * when the artist uses a built-in template.
 *
 * Goes through the `public_custom_site` DOOR, not a table read: `/[slug]` is a
 * PUBLIC route on the anon client, and `artists_select` RLS
 * (`is_admin() OR is_manager_of(id)`) hides the row from a visitor — a direct read
 * returned null for everyone and the redirect silently never fired
 * (20260714170000). The door is SECURITY DEFINER and returns only the redirect
 * target, so anon never sees the rest of the artists row.
 *
 * A MANAGER-side caller that already holds the row (e.g. `requireArtist`) should
 * use `isCustom(row)` directly instead of paying for this round-trip.
 */
export async function customSiteUrl(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await supabase.rpc('public_custom_site', { p_slug: slug })
  return (data as string | null) ?? null
}

/** Whether a `{ site_kind, custom_site_url }` row is a usable custom site. */
export function isCustom(row: { site_kind?: string | null; custom_site_url?: string | null } | null): boolean {
  return !!row && row.site_kind === 'custom' && !!row.custom_site_url
}
