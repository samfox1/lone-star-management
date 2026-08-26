/**
 * The PUBLISHED-CONTENT read — the other half of the contract.
 *
 * The bridge already owns what the EDITOR sends a site (the manifest, the markers, the
 * style tokens). This is what a site reads on its own, for the fan-facing page: the
 * artist's published payload, straight from `get_public_site`.
 *
 * It lives here for the same reason the style resolver does. Skeen hand-rolled it, the
 * two throwaway sites never did at all — so publishing reached one deployed site and not
 * the others, and nothing in the code said why (2026-08-15). One implementation, and a
 * site is wired in three lines.
 *
 * Framework-free, like the rest of the package: plain `fetch`, no Supabase client, no
 * Next import. A caller that wants ISR passes `{ next: { revalidate: 60 } }` through
 * `fetchOptions` — Next reads it, everything else ignores it.
 */
import type { PublicSitePayload, SiteRelease } from "./payload";

export type PublicSiteConfig = {
  /** `https://<project>.supabase.co` — the project's REST root. */
  supabaseUrl: string;
  /** The ANON key. Public by design: `get_public_site` is anon-readable and returns
   *  only published rows, and RLS guards everything it does not. */
  anonKey: string;
  /** Which artist's site this is. */
  slug: string;
};

/** True when every piece needed to make the call is present. A site missing its env
 *  vars should render EMPTY rather than throw on a fan's page — the same choice the
 *  region registry makes for an unknown key. */
export function isConfigured(config: Partial<PublicSiteConfig> | undefined): config is PublicSiteConfig {
  return Boolean(config?.supabaseUrl && config?.anonKey && config?.slug);
}

/**
 * The artist's PUBLISHED payload, or null.
 *
 * Null means "nothing to show": either the site is not configured yet, or the artist has
 * never published. Both render the empty site, which is the no-hardcoded-content rule —
 * what a fan sees when nothing is published is nothing, never invented songs.
 *
 * A FAILED request throws, deliberately. A site that quietly renders empty because the
 * key rotated looks identical to one that was never published, and the difference matters
 * enough to be loud: under ISR the last good page keeps serving while the error surfaces
 * in the build log.
 */
export async function fetchPublicSite(
  config: Partial<PublicSiteConfig> | undefined,
  fetchOptions?: RequestInit,
): Promise<PublicSitePayload | null> {
  if (!isConfigured(config)) return null;
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/get_public_site`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
    },
    body: JSON.stringify({ p_slug: config.slug }),
    ...fetchOptions,
  });
  if (!res.ok) throw new Error(`get_public_site failed: ${res.status}`);
  // An artist with nothing published returns an empty body, not `null` JSON.
  const text = await res.text();
  return text ? (JSON.parse(text) as PublicSitePayload) : null;
}

/**
 * The artist's published, on-site, released releases (`get_public_releases`) — what a
 * MusicAlbum fact sheet needs (seo.jsonLdGraph). Same config and cache rules as
 * fetchPublicSite; an unconfigured site gets `[]`, never a throw.
 */
export async function fetchPublicReleases(
  config: Partial<PublicSiteConfig> | undefined,
  fetchOptions?: RequestInit,
): Promise<SiteRelease[]> {
  if (!isConfigured(config)) return [];
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/get_public_releases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
    },
    body: JSON.stringify({ p_slug: config.slug }),
    ...fetchOptions,
  });
  if (!res.ok) throw new Error(`get_public_releases failed: ${res.status}`);
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : [];
  return Array.isArray(parsed) ? (parsed as SiteRelease[]) : [];
}
