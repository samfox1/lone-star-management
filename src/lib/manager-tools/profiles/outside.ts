/**
 * DISCOGS AND WIKIDATA, READ ONLY (Sam, 2026-09-30; VISIBILITY_TOOLKIT.md "Round 3"). The SEO
 * tool's Profiles tab asks each, for every artist: does your page there know your site? Tapir
 * NEVER creates or edits a Wikidata item or a Discogs page; it only reads and says what it found.
 *
 * This file is the PURE half: which ids Tapir already knows, the addresses we ask, and how an
 * answer becomes what the manager is told. The fetching is outside-check.ts (server only).
 *
 *   Wikidata  one search, `haswbstatement:P434=<mbid>|P856=<site>|…` (OR; the P856 match is
 *             EXACT, so every spelling of the homepage is asked), then the item's P856 (official
 *             website) and P434 (MusicBrainz artist ID) statements. An item the manager linked
 *             in Connections is read first.
 *   Discogs   only the page the manager linked in Connections. Never a name search: names are
 *             shared (id 1230117 "Skeen" is someone else; Skeen's will be "Skeen (2)").
 *
 * Every id that goes into an address is checked against its own pattern first.
 */
import { discogs } from '@/lib/manager-tools/connections/services/discogs'
import { musicbrainz } from '@/lib/manager-tools/connections/services/musicbrainz'
import { wikidata } from '@/lib/manager-tools/connections/services/wikidata'

/** Wikimedia's policy: a name with "bot" in it and a way to reach us (no email). */
export const WIKIDATA_UA = 'TapirBot/1.0 (https://tapirwebsites.com)'
/** Discogs asks for a unique User-Agent. No token: an artist read needs none. */
export const DISCOGS_UA = 'TapirSites/1.0 +https://tapirwebsites.com'

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const QID = /^Q[1-9]\d{0,11}$/
const DISCOGS_ID = /^[1-9]\d{0,11}$/
/** A real host name, as `URL` writes it (lower case, punycode): at least one dot. */
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

export type WikidataCheck =
  /** An item lists the site or the MusicBrainz id (or the manager linked it). */
  | { kind: 'found'; item: string; url: string; hasSite: boolean; hasMbid: boolean }
  /** No item lists either. `byMbid`: the MusicBrainz id was asked about too. */
  | { kind: 'none'; byMbid: boolean }
  | { kind: 'unknown' }

export type DiscogsCheck =
  | { kind: 'listed' | 'missing' | 'gone'; id: string; url: string }
  | { kind: 'unlinked' }
  | { kind: 'unknown'; url: string | null }

export type OutsideChecks = { wikidata: WikidataCheck; discogs: DiscogsCheck }

/** A MusicBrainz id, either case. */
export const isMbid = (id: string | null): id is string => !!id && MBID.test(id.toLowerCase())

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/* ── what Tapir already knows ──────────────────────────────────────────────────────── */

type LinkRow = { url?: string | null }

/** The first id each service reads out of the manager's Connections links, checked. */
export function connectedIds(links: readonly LinkRow[]): { mbid: string | null; wikidata: string | null; discogs: string | null } {
  const first = (read: ((url: string) => string | null) | undefined, ok: RegExp, lower = false) => {
    for (const l of links) {
      const url = String(l.url ?? '').trim()
      const raw = url ? read?.(url) : null
      const id = raw ? (lower ? raw.toLowerCase() : raw) : null
      if (id && ok.test(id)) return id
    }
    return null
  }
  return {
    mbid: first(musicbrainz.social?.idFromUrl, MBID, true),
    wikidata: first(wikidata.social?.idFromUrl, QID),
    discogs: first(discogs.social?.idFromUrl, DISCOGS_ID),
  }
}

/**
 * The artist's MusicBrainz id, when Tapir knows it: a MusicBrainz link in Connections, else the
 * page the AI test's `mb` FOUND. Only a pass: a failed `mb` names someone else's page, or none.
 */
export function knownMbid(links: readonly LinkRow[], mb: { status: string; evidence?: readonly { value: string }[] } | null): string | null {
  const linked = connectedIds(links).mbid
  if (linked) return linked
  if (mb?.status !== 'pass') return null
  return connectedIds((mb.evidence ?? []).map((e) => ({ url: typeof e.value === 'string' ? e.value : null }))).mbid
}

/* ── the site's spellings ──────────────────────────────────────────────────────────── */

function hostOf(url: string): string | null {
  const s = url.trim()
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  return HOST.test(u.hostname) ? u.hostname : null
}

/**
 * Every way a homepage is commonly written, for a search whose match is exact: https and http,
 * with and without `www.`, with and without the trailing slash. The site's own host first. At
 * most eight; none for an address that isn't a real web host.
 */
export function siteSpellings(siteUrl: string | null): string[] {
  const host = siteUrl ? hostOf(siteUrl) : null
  if (!host) return []
  const bare = host.replace(/^www\./, '')
  const out: string[] = []
  for (const h of [host, host === bare ? `www.${bare}` : bare]) for (const scheme of ['https', 'http']) for (const slash of ['/', '']) out.push(`${scheme}://${h}${slash}`)
  return out
}

/** Does `url` point at the artist's site? The same host, give or take `www.` and the scheme. */
export function isSameSite(url: string, siteUrl: string): boolean {
  const a = hostOf(url)
  const b = hostOf(siteUrl)
  return !!a && !!b && a.replace(/^www\./, '') === b.replace(/^www\./, '')
}

/* ── Wikidata ──────────────────────────────────────────────────────────────────────── */

/** The one search: items whose MusicBrainz id is this artist's, OR whose official website is
 *  any spelling of the site. Null when there is nothing to ask by. */
export function wikidataSearchUrl(siteUrl: string | null, mbid: string | null): string | null {
  const clauses = [...(isMbid(mbid) ? [`P434=${mbid.toLowerCase()}`] : []), ...siteSpellings(siteUrl).map((s) => `P856=${s}`)]
  if (!clauses.length) return null
  const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: `haswbstatement:${clauses.join('|')}`, srprop: '', srlimit: '3', srnamespace: '0', format: 'json' })
  return `https://www.wikidata.org/w/api.php?${q}`
}

/** The search's items, in its order. Null = not a search answer. */
export function searchHits(json: unknown): string[] | null {
  if (!isObj(json) || !isObj(json.query) || !Array.isArray(json.query.search)) return null
  return json.query.search.flatMap((h) => (isObj(h) && typeof h.title === 'string' && QID.test(h.title) ? [h.title] : []))
}

export const wikidataItemUrl = (item: string) => `https://www.wikidata.org/wiki/${item}`

/** One property's statements on an item (Wikibase REST API). Null for an id that isn't one. */
export function wikidataStatementsUrl(item: string, property: 'P856' | 'P434'): string | null {
  return QID.test(item) ? `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${item}/statements?property=${property}` : null
}

/** The values of one property's statements, leaving out deprecated ones (Wikidata's "this is
 *  wrong or outdated"). `{}` is none. Null = not a statements answer. */
export function statementValues(json: unknown, property: 'P856' | 'P434'): string[] | null {
  if (!isObj(json)) return null
  const list = json[property]
  if (list === undefined) return []
  if (!Array.isArray(list)) return null
  return list.flatMap((s) => (isObj(s) && s.rank !== 'deprecated' && isObj(s.value) && s.value.type === 'value' && typeof s.value.content === 'string' ? [s.value.content] : []))
}

/** An item and its statements, as what the manager is told. With a MusicBrainz id in hand, the
 *  item must carry THAT id; without one, any P434 counts. */
export function wikidataFound(item: string, p856: readonly string[], p434: readonly string[], siteUrl: string | null, mbid: string | null): WikidataCheck {
  return {
    kind: 'found',
    item,
    url: wikidataItemUrl(item),
    hasSite: !!siteUrl && p856.some((v) => isSameSite(v, siteUrl)),
    hasMbid: isMbid(mbid) ? p434.some((v) => v.toLowerCase() === mbid.toLowerCase()) : p434.length > 0,
  }
}

/* ── Discogs ───────────────────────────────────────────────────────────────────────── */

export const discogsApiUrl = (id: string) => (DISCOGS_ID.test(id) ? `https://api.discogs.com/artists/${id}` : null)
export const discogsPageUrl = (id: string) => `https://www.discogs.com/artist/${id}`

/** Discogs' answer for the linked page, as what the manager is told. 404 = no page there. */
export function readDiscogs(id: string, status: number | null, json: unknown, siteUrl: string): DiscogsCheck {
  const url = discogsPageUrl(id)
  if (status === 404) return { kind: 'gone', id, url }
  if (status !== 200 || !isObj(json) || String(json.id) !== id) return { kind: 'unknown', url }
  const urls = Array.isArray(json.urls) ? json.urls.filter((u): u is string => typeof u === 'string') : []
  return { kind: urls.some((u) => isSameSite(u, siteUrl)) ? 'listed' : 'missing', id, url }
}
