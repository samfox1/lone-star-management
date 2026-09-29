/**
 * WHAT A SERVICE FILE IS (Sam, 2026-09-28: "Maybe they should all have their own file …
 * inside the manager tools").
 *
 * Every connection has a folder here: a README (how it is implemented and integrated) and an
 * `index.ts` exporting ONE `Service` — that platform's own pieces of code, and only those:
 *
 *   social  — a profile a site can show: the bridge slug, how the manager enters it (a
 *             handle spec or `{ kind: 'link' }`), and the source id inside its link;
 *   source  — a syncable source: its INTEGRATION_REGISTRY entry;
 *   signInSource — a source its social pulls through the artist's own sign-in (a Vault
 *             token, no id column: Eventbrite);
 *   service — a connection in neither registry, defined whole (Shopify).
 *
 * The shared modules ASSEMBLE from these files and keep every rule that is not one
 * platform's: `lib/connect-methods` (CONNECT_METHODS, parseHandle), `lib/connections`
 * (CONNECTIONS, idFromProfileUrl, the page's rows), `lib/integrations-registry`
 * (INTEGRATION_REGISTRY, in INTEGRATION_KEYS order).
 *
 * Pure data and pure functions only: these files reach client components through those
 * modules. And they import those modules for TYPES only (erased at build): the modules
 * import this folder, so a runtime import back would be a cycle.
 */
import type { HandleMethod, LinkMethod } from '@/lib/connect-methods'
import type { ConnectionDef, ConnectionSource } from '@/lib/connections'
import type { IntegrationDef } from '@/lib/integrations-registry'

/** How a social is entered: a handle spec (its label comes from the bridge's platform
 *  name), or `link` for a platform whose artists have no handle, only an artist link (with,
 *  rarely, the one path that link may have: WhatsApp's channel). */
export type ConnectSpec = Omit<HandleMethod, 'kind' | 'label'> | Omit<LinkMethod, 'label'>

export type Service = {
  /** The folder name, beside its README. */
  slug: string
  social?: {
    /** The bridge's `SOCIAL_PLATFORMS` slug ('apple music', 'x'). */
    key: string
    method: ConnectSpec
    /** The source id inside a profile link, or null when there is none (a playlist).
     *  Given the link trimmed and never blank. */
    idFromUrl?: (url: string) => string | null
  }
  source?: IntegrationDef
  /** A source connected by the artist's own SIGN-IN — a token in Vault, not an artist-id
   *  column (Eventbrite) — so it is not in INTEGRATION_REGISTRY. Attached to this service's
   *  social def as its `source`. No `idField`: a pasted link cannot pull. */
  signInSource?: ConnectionSource
  /** Plain data: it rides in CONNECTIONS from the server page to client components. */
  service?: ConnectionDef
}

/** An `@` platform: `tiktok.com/@` [handle]. */
export const at = (host: string) => ({ before: `${host}/@`, after: '', url: (h: string) => `https://${host}/@${h}` })

/** A plain one: `x.com/` [handle]. */
export const slash = (host: string) => ({ before: `${host}/`, after: '', url: (h: string) => `https://${host}/${h}` })

/** The first capture of `re` in `url`, or null. */
export function grab(url: string, re: RegExp): string | null {
  const m = url.match(re)
  return m ? m[1] : null
}
