/**
 * Custom-site helpers (SITE_STYLING_PLAN.md). An artist's public site is either a
 * built-in template or a fully custom site hosted elsewhere (e.g. the Vercel
 * skeen-website). The `site_kind` / `custom_site_url` columns are config, not
 * published content, so they're read directly from `artists` — never through the
 * published snapshot (get_public_site) or ARTIST_SNAPSHOT.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// Written via RegExp so the control-char range stays legible as escapes.
const CONTROL_CHAR = new RegExp('[\\u0000-\\u001f\\u007f]')

/**
 * `custom_site_url` as a USABLE redirect target, or null.
 *
 * The column is manager-supplied free text and `/[slug]` hands it straight to
 * `permanentRedirect` — a PUBLIC, unauthenticated route. So an unchecked value is an
 * arbitrary-scheme Location on a fan-facing URL, and a 308 at that: browsers cache it,
 * so one bad save outlives the fix. http(s) only — deliberately stricter than safeHref,
 * whose mailto:/tel: are legitimate links but not places a site can be hosted. A
 * relative or protocol-relative value is refused for the same reason: neither names a
 * host to send the fan to. Control chars are refused outright — this string becomes a
 * response header, and a CR/LF in it splits the response.
 */
function redirectTarget(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (CONTROL_CHAR.test(trimmed)) return null
  // `[^\s/]` after the slashes demands a host, so `https:///x` names nowhere to go.
  return /^https?:\/\/[^\s/]\S*$/i.test(trimmed) ? trimmed : null
}

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
  // The door is SECURITY DEFINER and returns the column verbatim, so the scheme check
  // belongs on this side of it — see redirectTarget.
  return redirectTarget(data as string | null)
}

/** Whether a `{ site_kind, custom_site_url }` row is a usable custom site — same
 *  http(s) rule the public redirect applies, so the manager-side editor and the fan-side
 *  route agree on what counts as a site. */
export function isCustom(row: { site_kind?: string | null; custom_site_url?: string | null } | null): boolean {
  return !!row && row.site_kind === 'custom' && redirectTarget(row.custom_site_url) !== null
}
