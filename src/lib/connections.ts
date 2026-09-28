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
 *     column — so its whole def comes from its own service file.
 *
 * Each platform's own pieces (its handle rule, the id inside its link, its source, Shopify's
 * def) live in `lib/manager-tools/connections/services/<slug>/index.ts`, beside its README;
 * this module assembles them and holds every rule that is not one platform's.
 *
 * Pure. No DB, no React. The page reads rows and passes them in; the modal reads defs.
 */
import { SOCIAL_PLATFORMS, platformFromUrl, socialSlug } from '@samfox1/site-bridge/social'
import {
  INTEGRATION_REGISTRY,
  isConnected,
  type ArtistIdField,
  type IntegrationArtist,
  type IntegrationSection,
} from './integrations-registry'
import { isContactLink, looksLikeEmail } from './url'
import { displayAddress } from './settings'
import { CONNECT_METHODS, handleFromUrl, parseHandle, withArticle, type ConnectMethod } from './connect-methods'
import { SERVICES, SHOPIFY_KEY } from '@/lib/manager-tools/connections/services'

export { SHOPIFY_KEY }

/** What a connection can feed. The registry's sections plus Merch (Shopify). */
export type ConnectionSection = IntegrationSection | 'merch'

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
  /** The platform's own address — the bare site, which is never a profile. */
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
  const defs: ConnectionDef[] = SOCIAL_PLATFORMS.map((p) => ({
    key: p.slug,
    label: p.label,
    kind: 'social',
    social: p.slug,
    urlHint: p.urlHint,
  }))
  for (const intg of INTEGRATION_REGISTRY) {
    const source: ConnectionSource = { key: intg.key, section: intg.section, idField: intg.idField, placeholder: intg.placeholder }
    const social = socialFor(intg.label)
    const host = social && defs.find((d) => d.key === social.slug)
    if (host) host.source = source
    else defs.push({ key: intg.key, label: intg.label, kind: 'service', source })
  }
  // A service in neither registry (Shopify) brings its whole def.
  for (const s of SERVICES) if (s.service) defs.push(s.service)
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

/** Each social's own id reader (`social.idFromUrl` in its service file), by its key. */
const ID_FROM_URL = new Map(SERVICES.flatMap((s) => (s.social?.idFromUrl ? [[s.social.key, s.social.idFromUrl] as const] : [])))

/**
 * The source id hidden inside a profile URL, for the platforms that put it there. Null
 * when the platform does not (Instagram), or the URL is not an artist page (a playlist).
 * YouTube returns the URL itself: `channelSelector` (lib/youtube) resolves any of its
 * shapes server-side, and guessing here would only duplicate that.
 */
export function idFromProfileUrl(def: ConnectionDef, url: string): string | null {
  const u = url.trim()
  if (!u) return null
  return ID_FROM_URL.get(def.key)?.(u) ?? null
}

/**
 * How a social is connected: by handle (X, Instagram…) or by its artist link (Spotify…), from
 * lib/connect-methods; undefined for a service. LOOKED UP, never stored on the def: a def is
 * passed from the server page to client components, and the method's functions and RegExps
 * cannot cross that boundary (the page answered 500 when they rode on it, 2026-09-28).
 */
export function methodOf(def: ConnectionDef): ConnectMethod | undefined {
  return def.social ? CONNECT_METHODS[def.social] : undefined
}

/** What the manager typed for one connection in the Connect flow. `handle` for a handle
 *  platform, `url` for a music service's artist link; `sync: false` links the profile and
 *  pulls nothing (absent = pull, which is what connecting a source has always meant). */
export type ConnectInput = { url?: string; handle?: string; id?: string; domain?: string; token?: string; sync?: boolean }

/** A pasted link as https: the scheme added when it has none, `http://` upgraded. Null for
 *  any other scheme (`javascript:`, `mailto:`): never a profile. */
function asHttps(raw: string): string | null {
  if (/^https:\/\//i.test(raw)) return raw
  if (/^http:\/\//i.test(raw)) return `https://${raw.slice(7)}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  return `https://${raw}`
}

/**
 * The one link a social connection saves, or why it can't be. A handle platform builds it
 * from the handle (a pasted link is read back to its handle first, so an older caller that
 * sends `url` still works); a link platform (a music service) takes its artist link as
 * pasted, made https.
 *
 * A link platform's link must be one `platformFromUrl` reads as THAT platform (2026-09-28):
 * the site draws it by that reading, and until then any url that was not another platform's
 * got in — a personal site, a `javascript:` string, a WhatsApp chat link carrying a phone
 * number. A platform with a `path` (WhatsApp's channel) takes only that path, saved without
 * its query or fragment. Stored rows from before are not rewritten.
 */
export function profileLink(def: ConnectionDef, input: ConnectInput): { url: string } | { error: string } {
  const method = methodOf(def)
  if (method?.kind === 'handle') {
    const parsed = parseHandle(method, input.handle ?? input.url ?? '')
    return 'error' in parsed ? parsed : { url: parsed.url }
  }
  const raw = input.url?.trim() ?? ''
  if (!raw) return { error: `Paste the ${def.label} link.` }
  const url = asHttps(raw)
  // The bare platform root is not a profile.
  if (url && def.urlHint && url.replace(/\/+$/, '') === def.urlHint.replace(/\/+$/, '')) return { error: 'Add the rest of the link — that’s just the site’s address.' }
  const found = url ? platformFromUrl(url) : null
  if (found && found.slug !== def.social) return { error: `That’s ${withArticle(found.label)} link, not ${def.label}.` }
  const notMine = { error: `That isn’t ${withArticle(def.label)}${method?.pathNoun ? ` ${method.pathNoun}` : ''} link.` }
  if (!url || !found) return notMine
  if (method?.path) {
    const u = new URL(url)
    return method.path.test(u.pathname) ? { url: `${u.origin}${u.pathname}` } : notMine
  }
  return { url }
}

/** Whether this connection pulls: only one that has a source, and not when the manager
 *  turned sync off to just link the profile (Sam, 2026-09-28). */
export function wantsSync(def: ConnectionDef, input: ConnectInput): boolean {
  return !!def.source && input.sync !== false
}

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
    const link = profileLink(def, input)
    return 'error' in link ? link.error : null
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
  /** The profile link, when the artist has one. Whether it is a button on the site is the
   *  editor's business, not this list's (Sam, 2026-09-28: "Only in the editor"). */
  linkId?: string
  url?: string
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
      sourceId,
      state: connectionState(def, connected, opts.counts[def.source?.key ?? ''] ?? 0),
    })
  }
  return sortConnectionRows(rows)
}

/** Synced first, then anything that needs attention, then the rest; A to Z within each.
 *  A failure sits high because it is the row to act on. Being on the site moves nothing:
 *  that is a button, and buttons live in the editor. */
function sortConnectionRows(rows: readonly ConnectionRow[]): ConnectionRow[] {
  const rank = (r: ConnectionRow) => (r.state === 'synced' ? 0 : r.state === 'failed' ? 1 : 2)
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))
}

/**
 * SITE BUTTONS (Sam, 2026-09-28): "when the connection is added, and I travel to the socials
 * list in the site editor, I can add a new button based on one of the existing connections
 * that I have… it should reference the link provided by the connection."
 *
 * A button is not a second row: it is the connection's own profile link with `on_site` set,
 * so editing the handle in Connections changes the button. Services (Shopify, Bandsintown…)
 * have no profile link and are never buttons — Shopify feeds the merch buttons instead.
 */

/** The social connection a link is the profile of; undefined for a contact row, a
 *  role-bound button, or a label no platform owns. */
export function connectionOfLink(link: LinkRowLike): ConnectionDef | undefined {
  if (!isProfileLink(link)) return undefined
  const slug = socialSlug(link.label ?? '')
  return CONNECTIONS.find((d) => d.social === slug)
}

/**
 * A link row's new url, checked the way Connect checks it, for the door that CHANGES a link
 * row (`updateContentAction`: the Connections edit window, the editor's link rows). Only a
 * LINK-kind connection is checked (Spotify, WhatsApp…: the rule `profileLink` applies), and
 * its url comes back as that rule saves it (https, WhatsApp without a query). A contact row,
 * a role-bound button, a handle platform's row and a label no platform owns pass untouched.
 */
export function checkedLinkUrl(link: LinkRowLike & { url: string }): { url: string } | { error: string } {
  const def = connectionOfLink(link)
  if (!def || methodOf(def)?.kind !== 'link') return { url: link.url }
  return profileLink(def, { url: link.url })
}

/** What the editor's picker offers: every profile link that is not a button yet, with its
 *  connection, A to Z. The link is the artist's own row, so picking it turns THAT row on. */
export function buttonChoices<L extends LinkRowLike & { onSite: boolean }>(links: readonly L[]): { def: ConnectionDef; link: L }[] {
  return links
    .filter((l) => !l.onSite)
    .flatMap((link) => {
      const def = connectionOfLink(link)
      return def ? [{ def, link }] : []
    })
    .sort((a, b) => a.def.label.localeCompare(b.def.label, 'en', { sensitivity: 'base' }))
}

/** How a connection's account reads in a row: the handle for a handle platform
 *  (`skeenmusic`), otherwise the link as a person says it (`open.spotify.com/artist/26K`) —
 *  which is also what a handle platform's link with no handle in it (a channel id) shows. */
export function connectionHandle(def: ConnectionDef, url: string): string {
  const method = methodOf(def)
  const handle = method?.kind === 'handle' ? handleFromUrl(method, url) : null
  return handle ?? displayAddress(url)
}
