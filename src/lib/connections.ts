/**
 * CONNECTIONS — one word for every outside platform an artist can integrate with, to
 * send information to or receive it from (Sam, 2026-09-13).
 *
 * It replaced two tools that split one idea down the middle: LINKS (the social profiles
 * a site shows) and INTEGRATIONS / "Sources" (the services the dashboard pulls catalog
 * data from). Spotify was a row on both pages. Here it is one connection: the profile
 * the site links to, AND the catalog the Music page pulls — because for Spotify, Apple
 * Music and Deezer the artist id is literally inside the profile URL, so one paste can
 * do both jobs.
 *
 * The list is DERIVED, never hand-written (AGENTS.md rule 4):
 *   • every social platform the bridge knows (`SOCIAL_PLATFORMS`) is a connection;
 *   • every syncable source (`INTEGRATION_REGISTRY`) either attaches to the social with
 *     the same name, or stands alone as a service (Bandsintown, Ticketmaster, Drive);
 *   • Shopify is the one service outside both registries — a Vault token, not an id
 *     column — so it is named here explicitly, the same way `sync-sections.ts` does.
 *
 * Pure. No DB, no React. The page reads rows and passes them in; the modal reads defs.
 */
import { SOCIAL_PLATFORMS, platformFromUrl, socialSlug } from '@samfox1/site-bridge/social'
import {
  INTEGRATION_REGISTRY,
  SECTION_LABEL,
  isConnected,
  type ArtistIdField,
  type IntegrationArtist,
  type IntegrationSection,
} from './integrations-registry'
import { isContactLink, looksLikeEmail } from './url'

export const SHOPIFY_KEY = 'shopify'

/** What a connection can feed. The registry's sections plus Merch (Shopify). */
export type ConnectionSection = IntegrationSection | 'merch'
export const CONNECTION_SECTION_LABEL: Record<ConnectionSection, string> = { ...SECTION_LABEL, merch: 'Merch' }

export type ConnectionSource = {
  key: string
  section: ConnectionSection
  /** The artist column holding the id. Absent for Shopify, whose state is in Vault. */
  idField?: ArtistIdField
  /** What the id field wants, named for the manager ("Spotify artist ID"). */
  placeholder: string
}

export type ConnectionDef = {
  /** The social slug, the integration key, or 'shopify'. Stable; used as the row key. */
  key: string
  label: string
  kind: 'social' | 'service'
  /** Set when the connection has a public profile a site shows (a `links` row). */
  social?: string
  /** Prefilled so the manager pastes a handle, not a whole URL. */
  urlHint?: string
  /** Set when the connection pulls content into the dashboard. */
  source?: ConnectionSource
}

function socialFor(label: string) {
  const slug = socialSlug(label)
  return SOCIAL_PLATFORMS.find((p) => p.slug === slug)
}

/** Every connection we know, in registry order (socials first, then the lone services). */
export const CONNECTIONS: readonly ConnectionDef[] = (() => {
  const defs: ConnectionDef[] = SOCIAL_PLATFORMS.map((p) => ({ key: p.slug, label: p.label, kind: 'social', social: p.slug, urlHint: p.urlHint }))
  for (const intg of INTEGRATION_REGISTRY) {
    const source: ConnectionSource = { key: intg.key, section: intg.section, idField: intg.idField, placeholder: intg.placeholder }
    const social = socialFor(intg.label)
    const host = social && defs.find((d) => d.key === social.slug)
    if (host) host.source = source
    else defs.push({ key: intg.key, label: intg.label, kind: 'service', source })
  }
  defs.push({ key: SHOPIFY_KEY, label: 'Shopify', kind: 'service', source: { key: SHOPIFY_KEY, section: 'merch', placeholder: 'store.myshopify.com' } })
  return defs
})()

export function connectionByKey(key: string): ConnectionDef | undefined {
  return CONNECTIONS.find((d) => d.key === key)
}

/** The picker's order: A to Z, socials and services together — a manager looks for a
 *  name, not a category (Sam, 2026-09-13). */
export function connectionsAtoZ(defs: readonly ConnectionDef[] = CONNECTIONS): ConnectionDef[] {
  return [...defs].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
}

/** The search line: a case-insensitive substring of the label. Blank shows everything. */
export function searchConnections(query: string, defs: readonly ConnectionDef[] = CONNECTIONS): ConnectionDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...defs]
  return defs.filter((d) => d.label.toLowerCase().includes(q))
}

/**
 * The source id hidden inside a profile URL, for the platforms that put it there. Null
 * when the platform does not (Instagram), or the URL is not an artist page (a playlist).
 * YouTube returns the URL itself: `channelSelector` (lib/youtube) resolves any of its
 * shapes server-side, and guessing here would only duplicate that.
 */
export function idFromProfileUrl(def: ConnectionDef, url: string): string | null {
  const u = url.trim()
  if (!u) return null
  const grab = (re: RegExp) => {
    const m = u.match(re)
    return m ? m[1] : null
  }
  switch (def.key) {
    case 'spotify':
      return grab(/open\.spotify\.com\/(?:intl-[a-z]+\/)?artist\/([A-Za-z0-9]+)/)
    case 'apple music':
      return grab(/music\.apple\.com\/(?:[a-z]{2}\/)?artist\/(?:[^/]+\/)?(\d+)/)
    case 'deezer':
      return grab(/deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/)
    case 'youtube':
      return /youtube\.com\//.test(u) ? u : null
    default:
      return null
  }
}

/** What the manager typed for one connection in the Connect flow. */
export type ConnectInput = { url?: string; id?: string; domain?: string; token?: string }

/**
 * Why this input cannot be connected, or null when it can. Pure, so the modal can answer
 * before a request is made and the action can refuse the same things after.
 */
export function connectInputError(def: ConnectionDef, input: ConnectInput): string | null {
  if (def.key === SHOPIFY_KEY) {
    if (!input.domain?.trim() || !input.token?.trim()) return 'Enter the store domain and its storefront token.'
    return null
  }
  if (def.social) {
    const url = input.url?.trim() ?? ''
    if (!url) return `Paste the ${def.label} link.`
    // The bare platform root is what the hint prefills — it is not a profile.
    if (def.urlHint && url.replace(/\/+$/, '') === def.urlHint.replace(/\/+$/, '')) return 'Add the rest of the link — that’s just the site’s address.'
    const found = platformFromUrl(url)
    if (found && found.slug !== def.social) return `That’s a ${found.label} link, not ${def.label}.`
    return null
  }
  if (!input.id?.trim()) return `Enter the ${def.source?.placeholder ?? 'id'}.`
  return null
}

/** A `links` row, as the page reads it. */
export type LinkRowLike = { id: string; label: string | null; url: string | null; on_site?: boolean | null; role?: string | null }

/**
 * A link that belongs on the Connections page: a social profile. Booking addresses
 * (mailto:, tel:, bare emails) are contact details and live in Settings; a row with a
 * `role` is bound to a declared site element (the USB button) and is the editor's.
 */
export function isProfileLink(link: LinkRowLike): boolean {
  if (link.role) return false
  if (isContactLink(link.url) || looksLikeEmail(link.url)) return false
  return !!socialFor(link.label ?? '')
}

/**
 * What a connection's right-hand chip says.
 *   synced  — the source is connected and content from it exists
 *   failed  — the source is connected and NOTHING came in: a pull that proved nothing
 *   connect — it could pull (Apple Music has a catalog) but is not connected
 *   none    — a plain social; nothing to pull
 */
export type ConnectionState = 'synced' | 'failed' | 'connect' | 'none'

export type ConnectionRow = {
  def: ConnectionDef
  key: string
  label: string
  /** The profile link, when the artist has one. */
  linkId?: string
  url?: string
  onSite: boolean
  /** The source id as stored, when the source is connected. */
  sourceId?: string
  state: ConnectionState
}

/** Rows written by each source: `{ spotify: 24, youtube: 3 }`. Zero or absent = nothing. */
export type SourceCounts = Partial<Record<string, number>>

export function connectionState(def: ConnectionDef, connected: boolean, count: number): ConnectionState {
  if (!def.source) return 'none'
  if (!connected) return 'connect'
  return count > 0 ? 'synced' : 'failed'
}

/**
 * The page's list: only what is hooked up. A connection appears when the artist has its
 * profile link, or its source is connected — or both, which is the point.
 */
export function buildConnectionRows(opts: {
  links: readonly LinkRowLike[]
  artist: IntegrationArtist
  shopifyConnected: boolean
  counts: SourceCounts
}): ConnectionRow[] {
  const rows: ConnectionRow[] = []
  for (const def of CONNECTIONS) {
    const link = def.social ? opts.links.find((l) => isProfileLink(l) && socialSlug(l.label ?? '') === def.social) : undefined
    let connected = false
    let sourceId: string | undefined
    if (def.source) {
      if (def.key === SHOPIFY_KEY) connected = opts.shopifyConnected
      else if (def.source.idField) {
        connected = isConnected({ idField: def.source.idField }, opts.artist)
        sourceId = opts.artist[def.source.idField] ?? undefined
      }
    }
    if (!link && !connected) continue
    rows.push({
      def,
      key: def.key,
      label: def.label,
      linkId: link?.id,
      url: link?.url ?? undefined,
      onSite: link ? link.on_site !== false : connected,
      sourceId,
      state: connectionState(def, connected, opts.counts[def.source?.key ?? ''] ?? 0),
    })
  }
  return sortConnectionRows(rows)
}

/** Synced first, then anything that needs attention, then profiles, then what is off the
 *  site; A to Z within each. A failure sits high because it is the row to act on. */
export function sortConnectionRows(rows: readonly ConnectionRow[]): ConnectionRow[] {
  const rank = (r: ConnectionRow) => (r.state === 'synced' ? 0 : r.state === 'failed' ? 1 : r.onSite ? 2 : 3)
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
}
