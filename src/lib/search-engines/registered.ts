/**
 * WHICH search engines Tapir registered an artist's site with: site_verifications rows that are
 * VERIFIED, at an https root address (the Search Console property / the Bing site, exactly). The
 * one reader for the AI test's listing (seo-tests/run.ts), the Search tab (search-stats-ask.ts)
 * and the sitemap resend (resubmit.ts). It lived in the AI-test runner, so the other two loaded
 * the whole runner just to read one table.
 *
 * Read through the SERVICE client: site_verifications is closed to every signed-in user. The
 * caller must already have checked the manager owns the artist.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** A search engine the site is registered with (site_verifications, verified), at the address
 *  it was registered as: the Search Console property / the Bing site, exactly. `verifiedAt`:
 *  when it was verified (the row's verified_at), which the Search tab reads as "added Sep 30". */
export type SeoRegistration = { provider: 'google' | 'bing'; siteUrl: string; verifiedAt?: string }

/** A registered address in the shape the migration allows: https, a host, the root, nothing else. */
function registeredUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password && u.port === '' ? v : null
  } catch {
    return null
  }
}

/** The site's VERIFIED registrations, read through the WRITER (service role): site_verifications
 *  is closed to every signed-in user. [] when there are none or the read fails. */
export async function readRegistered(writer: SupabaseClient, artistId: string): Promise<SeoRegistration[]> {
  const { data, error } = await writer.from('site_verifications').select('provider, site_url, verified_at').eq('artist_id', artistId)
  if (error || !Array.isArray(data)) return []
  const out: SeoRegistration[] = []
  for (const row of data as Record<string, unknown>[]) {
    const provider = row?.provider
    if ((provider !== 'google' && provider !== 'bing') || typeof row.verified_at !== 'string' || !row.verified_at) continue
    const siteUrl = registeredUrl(row.site_url)
    if (siteUrl && !out.some((r) => r.provider === provider)) out.push({ provider, siteUrl, verifiedAt: row.verified_at })
  }
  return out
}
