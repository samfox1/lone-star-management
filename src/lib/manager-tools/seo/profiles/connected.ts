import { connectionHandle, connectionOfLink, identityUrlOf, type LinkRowLike } from '@/lib/connections'

/**
 * THE CONNECTED PROFILES AND MUSICBRAINZ, for SEO / GEO › Profiles (moved from the Facts tab's
 * Profiles section on 2026-10-02, when Facts became the Profile tool). Discogs and Wikidata have
 * their own live rows there already (outside-rows.tsx), so only what they don't cover moved.
 *
 * PURE: the page reads the links and passes them in.
 */

/** A connected profile, as the row shows it. `inFactCard`: the site's fact card lists it. */
export type ProfileLink = { slug: string; label: string; display: string; inFactCard: boolean }

/** The fact databases: they have rows of their own, never counted among the profiles. */
const DATABASES = ['musicbrainz', 'discogs', 'wikidata'] as const
type Database = (typeof DATABASES)[number]

/** A linked fact database: its address as shown, and the link itself. */
export type DatabasePage = { display: string; url: string }

/**
 * Connected profiles (one per platform), and the fact databases apart, each as shown. "In your
 * fact card" is the fact card's own rule (identityUrlOf): a real artist profile, never a payment
 * handle or a playlist. A link that isn't a known connection, or has no address, is skipped.
 */
export function connectedProfiles(rows: readonly LinkRowLike[]): { profiles: ProfileLink[]; databases: Partial<Record<Database, DatabasePage>> } {
  const profiles: ProfileLink[] = []
  const databases: Partial<Record<Database, DatabasePage>> = {}
  const seen = new Set<string>() // one row per platform
  for (const r of rows) {
    const def = connectionOfLink(r)
    if (!def || !r.url) continue
    const db = DATABASES.find((d) => d === def.key)
    if (db) {
      databases[db] ??= { display: connectionHandle(def, r.url), url: r.url }
      continue
    }
    if (seen.has(def.key)) continue
    seen.add(def.key)
    profiles.push({ slug: def.social ?? def.key, label: def.label, display: connectionHandle(def, r.url), inFactCard: !!identityUrlOf(r) })
  }
  return { profiles, databases }
}
