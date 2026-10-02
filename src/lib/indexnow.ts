/**
 * INDEXNOW: after a Publish, tell Bing (and Yandex, Naver, Seznam) which pages changed, so
 * they re-crawl now instead of whenever (AI_VISIBILITY_AUDIT finding 1.4). Bing's index is
 * what Copilot and ChatGPT search read. Google has no IndexNow; it keeps the sitemap.
 *
 * The protocol (indexnow.org/documentation): a key of 8–128 `[a-zA-Z0-9-]`, served as a
 * UTF-8 text file on the site's own host, and a JSON POST to api.indexnow.org naming
 * `host`, `key`, `keyLocation` and up to 10,000 URLs. 200 = accepted, 202 = accepted while
 * the key is checked, 400 bad format, 403 key not found or not in the file, 422 URLs that
 * are not the host's, 429 "potential spam". No published rate limit: submit what changed,
 * when it changed.
 *
 * The key: one random key per artist, in the RESERVED `site_content` key
 * `INDEXNOW_CONTENT_KEY` (only `ensureIndexNowKey` writes it; save.ts refuses it as a field
 * name). It is written just before a Publish that ships site text, so it goes live IN that
 * publish and never shows up as a pending change. It rides the payload's open
 * `site_content` map: get_public_site did not change. The site serves it at
 * `INDEXNOW_KEY_PATH` through the bridge (`indexNowKeyFile`, CONNECTING.md §10).
 *
 * The ping fires, at most once per Publish and after the response has gone (`after`), only
 * when ALL of these hold:
 *   • the artist has a custom site on a public https host, judged by the production rule
 *     (never the dev loopback hatch) and never a `*.vercel.app` preview;
 *   • the draft holds a valid key;
 *   • the site SERVES that key at /indexnow.txt, which proves it is published and live
 *     (ISR included), and reports bridge 0.42.0 or later in the key file's header.
 * The URLs are the site's own sitemap, same origin only, else its homepage.
 *
 * Nothing here may fail or slow a Publish: every error becomes an outcome, and the caller
 * only logs it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { INDEXNOW_CONTENT_KEY, INDEXNOW_KEY_PATH, INDEXNOW_VERSION_HEADER, isIndexNowKey } from '@samfox1/site-bridge/indexnow'
import { isPublicSiteUrl } from './custom-site'
import { guardedFetch } from './guarded-fetch'
import { pickTransport } from './net-guard'
import { bridgeSupportsIndexNow } from './site-editor/manifest'

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

/** An artist site has a handful of pages. The protocol allows 10,000; a sitemap listing
 *  more than this is not one we should be vouching for page by page. */
export const MAX_PING_URLS = 100

/** Per request. The ping runs after the response, but a hung socket still holds the
 *  function open until the platform kills it. */
const TIMEOUT_MS = 8_000

/** Each read of the site (key file, sitemap): the whole call, redirects included. Per hop it
 *  is guardedFetch's own 10 s, and its 2 MiB byte cap. */
const READ_DEADLINE_MS = 20_000

/** Vercel's own hosts are previews (or a site not yet on its domain): never ping for them. */
const PREVIEW_HOST = /(^|\.)vercel\.app$/i

/** A fresh key: 32 lowercase hex characters from the platform CSPRNG. */
export function newIndexNowKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

type SiteRow = { site_kind?: string | null; custom_site_url?: string | null }

/** The origin of `url` if a ping may name it: public (no loopback hatch), https, not a preview. */
export function pingableOrigin(url: string): string | null {
  if (!isPublicSiteUrl(url)) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (PREVIEW_HOST.test(u.hostname.replace(/\.$/, ''))) return null
  return u.origin
}

/**
 * The origin an IndexNow ping may be sent for, or null.
 *
 * Deliberately NOT `isCustom`/`publicSiteOrigin`: those open the loopback hatch in
 * development (FTBK's live value is `http://localhost:3004`), which is right for a browser
 * redirect and wrong for telling a search engine about a site.
 */
export function indexNowOrigin(row: SiteRow | null | undefined): string | null {
  if (!row || row.site_kind !== 'custom' || typeof row.custom_site_url !== 'string') return null
  return pingableOrigin(row.custom_site_url)
}

export type PingOutcome =
  | { sent: true; status: number; urlList: string[] }
  | { sent: false; reason: 'no-site' | 'no-key' | 'key-not-served' | 'old-bridge' | 'network' | 'error' }
  | { sent: false; reason: 'rejected'; status: number }

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The site's own pages from its sitemap: same origin only, no repeats, capped; else the
 *  homepage. A `<loc>` is text from a document the site controls, so it is only ever NAMED
 *  to IndexNow, never fetched from here. */
function pageUrls(xml: string | null, origin: string): string[] {
  const out: string[] = []
  // A sitemap INDEX lists sitemaps, not pages.
  if (xml && !/<sitemapindex[\s>]/i.test(xml)) {
    for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
      const raw = m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e])
      if (/\s/.test(raw) || out.includes(raw)) continue
      try {
        if (new URL(raw).origin !== origin) continue
      } catch {
        continue
      }
      out.push(raw)
      if (out.length === MAX_PING_URLS) break
    }
  }
  return out.length > 0 ? out : [`${origin}/`]
}

/**
 * Ping IndexNow for one site. Never throws; at most ONE request to api.indexnow.org.
 * `fetcher` is injected so tests never touch the network. Left out, it is lib/net-guard's
 * transport, NOT the global fetch: `timed` wraps it, and a wrapped global fetch would resolve
 * the manager's host again with no check on where it points.
 */
export async function pingIndexNow(
  site: SiteRow | null | undefined,
  key: string | null | undefined,
  fetcher?: typeof fetch,
): Promise<PingOutcome> {
  try {
    const origin = indexNowOrigin(site)
    if (!origin) return { sent: false, reason: 'no-site' }
    if (!isIndexNowKey(key)) return { sent: false, reason: 'no-key' }
    const base = pickTransport(fetcher)
    // Adds a timeout to the caller's signal, never replaces it: the guarded read's own
    // deadline must still reach the socket.
    const timed: typeof fetch = (input, init) =>
      base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) })

    // The key file first: the same check IndexNow will make. Through the SSRF-guarded fetch
    // (every redirect hop re-checked), and judged where it really answered: apex → www is
    // normal, but the answering host must itself be pingable and the file must still be at
    // the root, or it vouches for less than the whole site.
    const read = (url: string) => guardedFetch(url, { fetcher: timed, deadlineMs: READ_DEADLINE_MS })
    const file = await read(`${origin}${INDEXNOW_KEY_PATH}`)
    const served = file.finalUrl ? pingableOrigin(file.finalUrl) : null
    if (file.status !== 200 || file.text == null || !served || new URL(file.finalUrl!).pathname !== INDEXNOW_KEY_PATH || file.text.trim() !== key) {
      return { sent: false, reason: 'key-not-served' }
    }
    if (!bridgeSupportsIndexNow(file.headers[INDEXNOW_VERSION_HEADER])) return { sent: false, reason: 'old-bridge' }

    const map = await read(`${served}/sitemap.xml`)
    const urlList = pageUrls(map.status === 200 ? map.text : null, served)

    let res: Response
    try {
      res = await timed(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: new URL(served).hostname, key, keyLocation: `${served}${INDEXNOW_KEY_PATH}`, urlList }),
      })
    } catch {
      return { sent: false, reason: 'network' }
    }
    if (res.status === 200 || res.status === 202) return { sent: true, status: res.status, urlList }
    return { sent: false, reason: 'rejected', status: res.status }
  } catch {
    return { sent: false, reason: 'error' }
  }
}

/** The two things a ping (or a key write) needs: the site row and the draft key. */
async function readState(supabase: SupabaseClient, artistId: string) {
  const [artist, current] = await Promise.all([
    supabase.from('artists').select('site_kind, custom_site_url').eq('id', artistId).maybeSingle(),
    supabase.from('site_content').select('value').eq('artist_id', artistId).eq('key', INDEXNOW_CONTENT_KEY).maybeSingle(),
  ])
  if (artist.error || current.error) return null
  const value = (current.data as { value?: unknown } | null)?.value
  return { site: artist.data as SiteRow | null, key: typeof value === 'string' ? value : null }
}

/**
 * Make sure a pingable artist has a key in the DRAFT, right before a Publish that ships
 * `site_content` (publishAll / publishSite), so the key goes live in that same publish.
 * Writes only when the site could ever be pinged and the key is missing or malformed.
 * Returns the key, or null; never throws, because a Publish must not fail over this.
 */
export async function ensureIndexNowKey(supabase: SupabaseClient, artistId: string): Promise<string | null> {
  try {
    const state = await readState(supabase, artistId)
    if (!state || !indexNowOrigin(state.site)) return null
    if (isIndexNowKey(state.key)) return state.key
    const key = newIndexNowKey()
    const { error } = await supabase
      .from('site_content')
      .upsert({ artist_id: artistId, key: INDEXNOW_CONTENT_KEY, value: key }, { onConflict: 'artist_id,key' })
    return error ? null : key
  } catch {
    return null
  }
}

/** Read the artist's site and key, then ping. Never throws. */
async function pingAfterPublish(supabase: SupabaseClient, artistId: string, fetcher?: typeof fetch): Promise<PingOutcome> {
  try {
    const state = await readState(supabase, artistId)
    if (!state) return { sent: false, reason: 'error' }
    return await pingIndexNow(state.site, state.key, fetcher)
  } catch {
    return { sent: false, reason: 'error' }
  }
}

/**
 * Schedule the ping for after the Publish's response has gone. Call it once per successful
 * publish. A failure anywhere, including `after` itself refusing (outside a request), is
 * logged quietly and goes no further.
 */
export function scheduleIndexNowPing(supabase: SupabaseClient, artistId: string): void {
  try {
    after(async () => {
      const out = await pingAfterPublish(supabase, artistId)
      if (!out.sent && (out.reason === 'rejected' || out.reason === 'network' || out.reason === 'error')) {
        console.warn(`[indexnow] ping not accepted (artist ${artistId}): ${out.reason}${out.reason === 'rejected' ? ` ${out.status}` : ''}`)
      }
    })
  } catch (e) {
    console.warn('[indexnow] ping not scheduled:', e instanceof Error ? e.message : e)
  }
}
