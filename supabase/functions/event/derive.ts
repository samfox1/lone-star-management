/**
 * Everything the `event` door DECIDES, with no I/O of its own: request validation, the
 * source bucket, device + browser from the user agent, bot detection, origin rules, the
 * two hashes, and the location lookup as a pure function over injected dependencies.
 * Pure so vitest can pin every rule (tests/unit/analytics/event-derive.test.ts) and
 * Stryker can break each one (stryker.config.json `mutate`). index.ts is plumbing only —
 * logic added there is logic nobody can test.
 *
 * Deno-agnostic on purpose: no Deno globals, only Web APIs Node also has (URL,
 * TextEncoder, crypto.subtle). This file cannot import from src/ (the bundler ships the
 * function directory), so the three registries it needs are PINNED copies —
 * EVENT_TYPES / ENTITY_KINDS of src/lib/events.ts, SOURCES of src/lib/analytics-sources.ts
 * — and the unit test diffs each against its original.
 */
import { sha256Hex } from '../_shared/hash.ts'
import { pickAllowedOrigin } from '../_shared/cors.ts'

/* ── Allowlists (pinned; a test diffs them) ─────────────────────────────────────── */

export const EVENT_TYPES = ['view', 'play', 'link_click', 'ticket_click', 'buy_click', 'video_click'] as const
export type EventType = (typeof EVENT_TYPES)[number]
export const ENTITY_KINDS = ['release', 'track', 'merch', 'video', 'tour_date', 'link'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/* ── Request body ───────────────────────────────────────────────────────────────── */

export type EventBody = {
  slug: string
  type: EventType
  /** The page the event happened on, as the browser sees it (location.href). */
  url: string
  /** document.referrer, or '' */
  referrer: string
  entity: { kind: EntityKind; id: string; label?: string } | null
}

export type Validated = { kind: 'ok'; value: EventBody } | { kind: 'error'; error: 'missing_field' | 'bad_type' | 'bad_entity' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

/** Shape-check the POST body. Anything else about it is derived server-side. */
export function validateEvent(raw: unknown): Validated {
  if (!raw || typeof raw !== 'object') return { kind: 'error', error: 'missing_field' }
  const r = raw as Record<string, unknown>
  const slug = str(r.slug, 100)
  const url = str(r.url, 2048)
  if (!slug || !url) return { kind: 'error', error: 'missing_field' }
  if (!(EVENT_TYPES as readonly string[]).includes(r.type as string)) return { kind: 'error', error: 'bad_type' }
  const referrer = typeof r.referrer === 'string' ? r.referrer.slice(0, 2048) : ''
  let entity: EventBody['entity'] = null
  if (r.entity !== undefined && r.entity !== null) {
    const e = r.entity as Record<string, unknown>
    if (!e || typeof e !== 'object' || !(ENTITY_KINDS as readonly string[]).includes(e.kind as string) || !UUID.test(String(e.id ?? ''))) {
      return { kind: 'error', error: 'bad_entity' }
    }
    entity = { kind: e.kind as EntityKind, id: String(e.id).toLowerCase(), ...(str(e.label, 200) ? { label: str(e.label, 200)! } : {}) }
  }
  return { kind: 'ok', value: { slug, type: r.type as EventType, url, referrer, entity } }
}

/** Requests above this are not analytics beacons. Checked on Content-Length before parsing. */
export const BODY_MAX_BYTES = 8192

/* ── Page + referrer ────────────────────────────────────────────────────────────── */

const EDIT_ROUTE = '/edit'

/** Path of the page, query and hash stripped, capped. Unparseable → '/'. */
export function pagePath(url: string): string {
  try {
    const p = new URL(url).pathname || '/'
    return p.length > 200 ? p.slice(0, 200) : p
  } catch {
    return '/'
  }
}

/** The manager opening the editor is not a visit — the same rule every site applies. */
export function isEditShell(path: string): boolean {
  return path === EDIT_ROUTE || path.startsWith(`${EDIT_ROUTE}/`)
}

/** Lower-cased host, a leading `www.` and a trailing `.` removed; null when absent or unparseable. */
export function hostOf(url: string): string | null {
  if (!url) return null
  try {
    let h = new URL(url).hostname.toLowerCase()
    if (h.startsWith('www.')) h = h.slice(4)
    if (h.endsWith('.')) h = h.slice(0, -1)
    return h || null
  } catch {
    return null
  }
}

/**
 * The referrer host worth storing: null for no referrer AND for same-site navigation
 * (a fan moving from /about to / is not "traffic from skeenmusic.com"). Same-site means
 * the two hosts are equal or one is a subdomain of the other. (A referrer that is a bare
 * public suffix of the page, e.g. `vercel.app` for `x.vercel.app`, is also dropped —
 * unrealistic input, noted rather than special-cased.)
 */
export function referrerHost(referrer: string, pageUrl: string): string | null {
  const ref = hostOf(referrer)
  if (!ref) return null
  const page = hostOf(pageUrl)
  if (page && (ref === page || ref.endsWith(`.${page}`) || page.endsWith(`.${ref}`))) return null
  return ref
}

/**
 * A browser sends `Origin` on every cross-origin POST. When it is there, the page the
 * body claims to be on must live on that origin — otherwise this is a beacon embedded on
 * some other site reporting visits to an artist's. Scripted callers can forge both; the
 * caps handle those. No Origin header (curl, a same-origin call) → nothing to compare.
 */
export function pageMatchesOrigin(pageUrl: string, origin: string | null): boolean {
  if (!origin) return true
  const page = hostOf(pageUrl)
  const o = hostOf(origin)
  if (!page || !o) return false
  return page === o
}

/* ── UTM ────────────────────────────────────────────────────────────────────────── */

export type Utm = { source: string | null; medium: string | null; campaign: string | null }

/** The three UTM tags off the page URL, verbatim (capped at 100). */
export function utmOf(url: string): Utm {
  try {
    const q = new URL(url).searchParams
    const g = (k: string) => {
      const v = q.get(k)?.trim()
      return v ? v.slice(0, 100) : null
    }
    return { source: g('utm_source'), medium: g('utm_medium'), campaign: g('utm_campaign') }
  } catch {
    return { source: null, medium: null, campaign: null }
  }
}

/* ── Source bucket ──────────────────────────────────────────────────────────────── */

/** PINNED copy of src/lib/analytics-sources.ts SOURCE_KEYS (a test diffs them). */
export const SOURCES = [
  'instagram', 'tiktok', 'youtube', 'facebook', 'x', 'spotify', 'apple_music', 'soundcloud', 'bandcamp',
  'google', 'bing', 'ai', 'linktree', 'bandsintown', 'songkick', 'email', 'direct', 'other',
] as const
export type Source = (typeof SOURCES)[number]

/** Host → bucket, matched on the host or any parent domain. Exported so the unit test
 *  can check EVERY entry against an independent expected table. */
export const HOST_BUCKETS: Record<string, Source> = {
  'instagram.com': 'instagram', 'l.instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'youtube.com': 'youtube', 'youtu.be': 'youtube', 'm.youtube.com': 'youtube',
  'facebook.com': 'facebook', 'l.facebook.com': 'facebook', 'lm.facebook.com': 'facebook', 'fb.com': 'facebook', 'm.facebook.com': 'facebook',
  'x.com': 'x', 't.co': 'x', 'twitter.com': 'x',
  'open.spotify.com': 'spotify', 'spotify.com': 'spotify',
  'music.apple.com': 'apple_music',
  'soundcloud.com': 'soundcloud',
  'bandcamp.com': 'bandcamp',
  'google.com': 'google', 'google.co.uk': 'google', 'google.ca': 'google', 'google.com.au': 'google', 'google.de': 'google', 'google.fr': 'google',
  'bing.com': 'bing',
  'chatgpt.com': 'ai', 'chat.openai.com': 'ai', 'openai.com': 'ai', 'perplexity.ai': 'ai', 'gemini.google.com': 'ai',
  'copilot.microsoft.com': 'ai', 'claude.ai': 'ai', 'you.com': 'ai',
  'linktr.ee': 'linktree', 'linktree.com': 'linktree',
  'bandsintown.com': 'bandsintown',
  'songkick.com': 'songkick',
  'mail.google.com': 'email', 'outlook.live.com': 'email', 'outlook.office.com': 'email', 'mail.yahoo.com': 'email',
}

/** utm_source values that name a bucket (case-insensitive, punctuation-insensitive). */
export const UTM_BUCKETS: Record<string, Source> = {
  instagram: 'instagram', ig: 'instagram', tiktok: 'tiktok', youtube: 'youtube', yt: 'youtube', facebook: 'facebook', fb: 'facebook',
  x: 'x', twitter: 'x', spotify: 'spotify', applemusic: 'apple_music', apple: 'apple_music', soundcloud: 'soundcloud',
  bandcamp: 'bandcamp', google: 'google', bing: 'bing', chatgpt: 'ai', perplexity: 'ai', gemini: 'ai', copilot: 'ai', ai: 'ai',
  linktree: 'linktree', bandsintown: 'bandsintown', songkick: 'songkick', email: 'email', newsletter: 'email', mailchimp: 'email',
}

export function bucketForHost(host: string | null): Source | null {
  if (!host) return null
  let h = host
  while (h) {
    const b = HOST_BUCKETS[h]
    if (b) return b
    const dot = h.indexOf('.')
    if (dot < 0) break
    h = h.slice(dot + 1)
  }
  return null
}

/**
 * The bucket: utm_source wins (a tag the artist wrote is the truth about the campaign,
 * even when we do not recognise the word → other); else the referrer host; no referrer
 * → direct; a referrer nothing matches → other (the raw host is stored beside it).
 */
export function sourceFor(utmSource: string | null, refHost: string | null): Source {
  if (utmSource) {
    const key = utmSource.toLowerCase().replace(/[^a-z]/g, '')
    return UTM_BUCKETS[key] ?? 'other'
  }
  if (!refHost) return 'direct'
  return bucketForHost(refHost) ?? 'other'
}

/* ── User agent ─────────────────────────────────────────────────────────────────── */

export type Device = 'mobile' | 'tablet' | 'desktop'
export type UaInfo = { device: Device; browser: string }

/**
 * Coarse device + browser family. In-app browsers come FIRST: they are the Instagram /
 * TikTok signal the referrer often strips, and their UAs also carry the family tokens
 * (`Chrome/`, `Safari/`) that would otherwise win. Android phones carry "Mobile";
 * Android tablets do not — the same token (`Mobi`) is used in both device branches so a
 * UA can never be a tablet here and a phone there. iPadOS 13+ reports as Macintosh and
 * lands on desktop; unavoidable without client hints.
 */
export function parseUa(ua: string): UaInfo {
  const s = ua || ''
  const device: Device = /iPad|Tablet|(?:Android(?!.*Mobi))/i.test(s) ? 'tablet' : /Mobi|iPhone|Android|IEMobile|Windows Phone/i.test(s) ? 'mobile' : 'desktop'
  const browser = /Instagram/i.test(s) ? 'instagram'
    : /musical_ly|TikTok|BytedanceWebview/i.test(s) ? 'tiktok'
    : /FBAN|FBAV|FB_IAB/i.test(s) ? 'facebook'
    : /Snapchat/i.test(s) ? 'snapchat'
    : /Edg(?:A|iOS)?\//i.test(s) ? 'edge'
    : /OPR\/|Opera/i.test(s) ? 'opera'
    : /SamsungBrowser/i.test(s) ? 'samsung'
    : /Firefox|FxiOS/i.test(s) ? 'firefox'
    : /CriOS|Chrome\//i.test(s) ? 'chrome'
    : /Safari\//i.test(s) ? 'safari'
    : s ? 'other' : 'unknown'
  return { device, browser }
}

/* ── Bots ───────────────────────────────────────────────────────────────────────── */

/**
 * Tokens that mark a crawler, link preview, headless browser or scripted client. The
 * regex is BUILT from this list so a test can iterate it (a name added here is checked
 * automatically). `bot` is special: it must be followed by a separator or the end, so
 * "Googlebot/2.1", "AdsBot-Google" and "MJ12bot/v1" match and a CUBOT_X19 phone or
 * "robots.txt" in a UA does not.
 */
export const BOT_UA_NAMES = [
  'bot', 'crawl', 'spider', 'slurp', 'headless', 'phantom', 'selenium', 'puppeteer', 'playwright', 'lighthouse', 'pagespeed',
  'pingdom', 'uptime', 'monitor', 'curl/', 'wget/', 'python-requests', 'python-urllib', 'go-http-client', 'okhttp', 'java/', 'libwww',
  'httpclient', 'scrapy', 'facebookexternalhit', 'facebookcatalog', 'twitterbot', 'linkedinbot', 'slackbot', 'discordbot', 'telegrambot',
  'whatsapp', 'skypeuripreview', 'embedly', 'quora link preview', 'redditbot', 'applebot', 'bingpreview', 'yandex', 'baiduspider',
  'duckduckbot', 'semrush', 'ahrefs', 'mj12bot', 'dotbot', 'petalbot', 'bytespider', 'gptbot', 'chatgpt-user', 'oai-searchbot',
  'claudebot', 'claude-web', 'anthropic-ai', 'perplexitybot', 'ccbot', 'amazonbot', 'google-inspectiontool', 'adsbot', 'mediapartners',
  'feedfetcher', 'vercel-screenshot', 'prerender',
] as const

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const BOT_UA = new RegExp(
  BOT_UA_NAMES.map((n) => (n === 'bot' ? 'bot(?=[\\/;)\\s\\-]|$)' : escapeRe(n))).join('|'),
  'i',
)

/** Known crawlers, previews, headless browsers and scripted clients. Empty UA counts. */
export function isBot(ua: string | null): boolean {
  if (!ua || !ua.trim()) return true
  return BOT_UA.test(ua)
}

/* ── Origin ─────────────────────────────────────────────────────────────────────── */

/** Comma-separated allowlist → array; empty means "any origin". */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
}

/**
 * The Access-Control-Allow-Origin for THIS door. With no allowlist it reflects the caller
 * — an analytics beacon is posted from every artist site, template and custom, preview
 * and production, and CORS is not the control here (the caps and the page/origin check
 * are). With an allowlist it is /contact's rule, unchanged.
 */
export function reflectOrAllowlisted(origin: string | null, allowed: string[]): string {
  if (allowed.length === 0) return origin ?? '*'
  return pickAllowedOrigin(origin, allowed)
}

/* ── Hashes ─────────────────────────────────────────────────────────────────────── */

/** UTC date as YYYY-MM-DD — the component that rotates the visitor hash daily. */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** UTC hour as YYYY-MM-DDTHH — the window of the global lookup budget. */
export function utcHour(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13)
}

/** Salted key for the per-IP ledger and the geo cache. No date. 32 hex. */
export async function ipHash(salt: string, ip: string): Promise<string> {
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32)
}

/** The daily visitor: same person, same day, same browser → one hash. Nothing stored on
 *  the device. Rotates at UTC midnight, so "returning visitors" across days do not exist
 *  by design (ANALYTICS_PAGE_PLAN.md decision 4). Unlinkable to OUTSIDERS; the operator,
 *  who holds the salt, could recompute — see docs/event-endpoint.md. 32 hex. */
export async function visitorHash(salt: string, date: string, ip: string, ua: string): Promise<string> {
  return (await sha256Hex(`${salt}:${date}:${ip}:${ua}`)).slice(0, 32)
}

/** A salt short enough to brute-force is no salt. The door refuses to start below this. */
export const SALT_MIN_LENGTH = 32

/* ── Location ───────────────────────────────────────────────────────────────────── */

export type Geo = { country: string | null; region: string | null; city: string | null }
export const NO_GEO: Geo = { country: null, region: null, city: null }

/** Shape an ipinfo answer into our columns; anything odd → nulls, never a throw. */
export function geoFromIpinfo(raw: unknown): Geo {
  const r = (raw ?? {}) as Record<string, unknown>
  const country = typeof r.country === 'string' && /^[A-Za-z]{2}$/.test(r.country) ? r.country.toUpperCase() : null
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null)
  return { country, region: s(r.region), city: s(r.city) }
}

/** Private, loopback, link-local, carrier-NAT, mapped and unknown addresses have no
 *  location worth asking for. Only a normalised address (see _shared/request.ts) or a
 *  plain IPv4 gets past this. */
export function isLookupable(ip: string): boolean {
  if (!ip || ip === 'unknown') return false
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.|169\.254\.)/.test(ip)) return false
  if (/^(::1|::$|::ffff:|fc|fd|fe80)/i.test(ip)) return false
  if (/^(0*:){1,7}0*(\/64)?$/.test(ip)) return false
  return true
}

/** What the lookup needs from the outside world. index.ts wires these to RPCs + fetch;
 *  the unit test wires stubs, so every branch below is watched. */
export type GeoDeps = {
  cacheGet: (key: string) => Promise<Geo | null>
  cachePut: (key: string, geo: Geo) => Promise<void>
  /** true when this hour's global lookup budget still has room */
  budget: () => Promise<boolean>
  /** null on any failure (non-2xx, timeout, bad JSON) */
  fetchGeo: (ip: string) => Promise<unknown | null>
}

/**
 * Location for this IP: the cache first; then, if the hour's budget allows, one lookup;
 * a failed lookup is cached as "no location" so an ipinfo outage or rate limit costs one
 * call per IP per two days, not one timeout per event. Nothing here can throw into the
 * door: every failure returns NO_GEO and the write proceeds.
 */
export async function locateWith(deps: GeoDeps, ip: string, key: string, enabled: boolean): Promise<Geo> {
  if (!enabled || !isLookupable(ip)) return NO_GEO
  try {
    const cached = await deps.cacheGet(key)
    if (cached) return cached
    if (!(await deps.budget())) return NO_GEO
    const raw = await deps.fetchGeo(ip)
    const geo = raw === null ? NO_GEO : geoFromIpinfo(raw)
    await deps.cachePut(key, geo)
    return geo
  } catch {
    return NO_GEO
  }
}
