/**
 * The Profiles tab's Discogs and Wikidata checks: the FETCHING half (outside.ts is the pure half
 * and says what is asked and why). SERVER ONLY: it goes through guardedFetch (net-guard).
 *
 * Their rules, kept: each service's own User-Agent; a short timeout and a deadline per check; a
 * 429 (or any answer but 200 / 404) is "couldn't check", never a retry loop. Redirects stay on
 * the service's own API path. Never throws: a failure is `unknown`.
 */
import { guardedFetch } from '@/lib/seo-tests/guarded-fetch'
import {
  DISCOGS_UA,
  WIKIDATA_UA,
  discogsApiUrl,
  discogsPageUrl,
  isMbid,
  readDiscogs,
  searchHits,
  statementValues,
  wikidataFound,
  wikidataSearchUrl,
  wikidataStatementsUrl,
  type DiscogsCheck,
  type WikidataCheck,
} from './outside'

type Opts = { fetcher?: typeof fetch }

const TIMEOUT_MS = 5000
const DEADLINE_MS = 8000
const MAX_BYTES = 512 * 1024

async function getJson(url: string, userAgent: string, onlyUnder: string, opts: Opts): Promise<{ status: number | null; json: unknown }> {
  const r = await guardedFetch(url, { fetcher: opts.fetcher, userAgent, timeoutMs: TIMEOUT_MS, deadlineMs: DEADLINE_MS, maxBytes: MAX_BYTES, allow: (next) => next.startsWith(onlyUnder) })
  if (r.status !== 200) return { status: r.status, json: null }
  if (r.truncated) return { status: null, json: null }
  try {
    return { status: 200, json: JSON.parse(r.text ?? '') }
  } catch {
    return { status: null, json: null }
  }
}

const UNKNOWN: WikidataCheck = { kind: 'unknown' }

/** An item's P856 and P434, read together. `missing` = Wikidata has no such item. */
async function readItem(item: string, siteUrl: string | null, mbid: string | null, opts: Opts): Promise<WikidataCheck | 'missing'> {
  const site = wikidataStatementsUrl(item, 'P856')
  const brainz = wikidataStatementsUrl(item, 'P434')
  if (!site || !brainz) return UNKNOWN
  const under = 'https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/'
  const [a, b] = await Promise.all([getJson(site, WIKIDATA_UA, under, opts), getJson(brainz, WIKIDATA_UA, under, opts)])
  // 404: no such item. 400: an id past the last item (Wikidata answers "invalid item id").
  if ([a.status, b.status].some((s) => s === 404 || s === 400)) return 'missing'
  const p856 = a.status === 200 ? statementValues(a.json, 'P856') : null
  const p434 = b.status === 200 ? statementValues(b.json, 'P434') : null
  return p856 && p434 ? wikidataFound(item, p856, p434, siteUrl, mbid) : UNKNOWN
}

/**
 * Does the artist have a Wikidata item, and does it carry the site and the MusicBrainz id? The
 * item linked in Connections is read first; one that no longer exists falls back to the search.
 */
export async function checkWikidata(input: { siteUrl: string | null; mbid: string | null; item: string | null }, opts: Opts = {}): Promise<WikidataCheck> {
  if (input.item) {
    const linked = await readItem(input.item, input.siteUrl, input.mbid, opts)
    if (linked !== 'missing') return linked
  }
  const search = wikidataSearchUrl(input.siteUrl, input.mbid)
  if (!search) return UNKNOWN
  const r = await getJson(search, WIKIDATA_UA, 'https://www.wikidata.org/w/api.php?', opts)
  const hits = r.status === 200 ? searchHits(r.json) : null
  if (!hits) return UNKNOWN
  if (!hits.length) return { kind: 'none', byMbid: isMbid(input.mbid) }
  const found = await readItem(hits[0], input.siteUrl, input.mbid, opts)
  return found === 'missing' ? UNKNOWN : found
}

/** Does the Discogs page linked in Connections list the site? No link: nothing is asked. */
export async function checkDiscogs(input: { siteUrl: string | null; id: string | null }, opts: Opts = {}): Promise<DiscogsCheck> {
  if (!input.id) return { kind: 'unlinked' }
  const api = discogsApiUrl(input.id)
  if (!api) return { kind: 'unlinked' }
  if (!input.siteUrl) return { kind: 'unknown', url: discogsPageUrl(input.id) }
  const r = await getJson(api, DISCOGS_UA, 'https://api.discogs.com/artists/', opts)
  return readDiscogs(input.id, r.status, r.json, input.siteUrl)
}
