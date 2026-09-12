/**
 * POST /functions/v1/event — the analytics ingest door for every artist site.
 *
 * This is the public door for fan events (ADR 0010 shape, ADR 0012 data). It is an Edge
 * Function and not an anon-granted SQL function because the event needs what only the
 * edge can see: the client IP (per-IP cap, daily visitor hash, location), the referrer
 * and the user agent. Postgres provably cannot, which is ADR 0010's test.
 *
 * It is deliberately THIN. Everything that decides an outcome lives in ./derive.ts
 * (pure, unit-tested in tests/unit/analytics/event-derive.test.ts, mutation-tested) or in
 * the RPCs (record_site_event, bump_event_attempt, lookup_geo_cache, cache_geo, tested
 * against the real DB in tests/integration/analytics/). What is left here is plumbing.
 * Keep it that way. Runbook: docs/event-endpoint.md.
 *
 * Contract (the bridge's `track()` speaks it; CONNECTING.md carries it from step 5):
 *   body  { slug, type, url, referrer, entity?: { kind, id, label? } }
 *         url = location.href (path, UTM and the site host are derived from it)
 *   204   recorded — or deliberately not (edit shell, unknown slug, per-artist cap): the
 *         browser cannot tell, and there is nothing useful for it to do with the difference
 *   400   { ok: false, error: "missing_field" | "bad_type" | "bad_entity" }
 *   401   POST without an Authorization header (the same speed bump as /contact; the
 *         value is not checked — the anon key is public, this only turns away the
 *         scripted abuse that never looked at the site)
 *   403   { ok: false, error: "origin_mismatch" } — the page's host is not the Origin's
 *   405   anything but POST / OPTIONS
 *   413   body larger than 8 KB
 *   429   { ok: false, error: "rate_limited" } + Retry-After — 60 events a minute per
 *         (site, IP), the IP being the /64 for IPv6
 *   500   { ok: false, error: "failed" }
 *
 * Never stored: the IP, the full user agent, the full referrer URL, cookies (none read,
 * none set). Location lookups are cached per IP for two days and drawn from a global
 * hourly budget, so a visitor costs one outbound call per two days at most and a flood
 * cannot spend the month's quota. With no IPINFO_TOKEN the row simply has no location.
 */
import { corsHeaders, json } from '../_shared/cors.ts'
import { clientIp, normalizeIp } from '../_shared/request.ts'
import {
  BODY_MAX_BYTES,
  SALT_MIN_LENGTH,
  ipHash,
  isBot,
  isEditShell,
  locateWith,
  pageMatchesOrigin,
  pagePath,
  parseAllowedOrigins,
  parseUa,
  reflectOrAllowlisted,
  referrerHost,
  sourceFor,
  utcDate,
  utcHour,
  utmOf,
  validateEvent,
  visitorHash,
  type Geo,
} from './derive.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Auto-injected by the platform. NOT a secret we manage, and never sent to the client.
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
/** Salt for both hashes. Unsalted, the geo cache is a 2^32 brute force away from an
 *  IP → city table, so a short or missing salt is a deploy error, not a default. */
const SALT = Deno.env.get('ANALYTICS_SALT') ?? ''
if (SALT.length < SALT_MIN_LENGTH) {
  throw new Error(`ANALYTICS_SALT must be at least ${SALT_MIN_LENGTH} characters: supabase secrets set ANALYTICS_SALT="$(openssl rand -hex 32)"`)
}
/** Optional. Without it, no location is recorded (the row is still written). */
const IPINFO_TOKEN = Deno.env.get('IPINFO_TOKEN') ?? ''
/** Optional allowlist. Empty = any origin, because every artist site posts here. */
const ALLOWED = parseAllowedOrigins(Deno.env.get('EVENT_ALLOWED_ORIGINS'))
const PER_SITE_IP_PER_MINUTE = 60
/** ipinfo's free tier is 50k a month; this keeps a flood of fresh IPs under it. */
const LOOKUPS_PER_HOUR = 500

/** Call a Postgres function as service_role over PostgREST. One HTTP POST, no client
 *  library (same reasoning as /contact). A void function answers 204 with no body. The
 *  error text is truncated: PostgREST's `details` can echo a failing row. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`rpc ${fn} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/** ipinfo, token in a header (never a query string that lands in someone's access log).
 *  Any failure → null; locateWith caches that as "no location" for two days. */
async function fetchGeo(ip: string): Promise<unknown | null> {
  try {
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${IPINFO_TOKEN}` },
      signal: AbortSignal.timeout(2_500),
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

const geoDeps = {
  cacheGet: async (key: string) => {
    const rows = await rpc<Geo[] | null>('lookup_geo_cache', { p_ip_hash: key })
    return rows && rows.length > 0 ? rows[0] : null
  },
  cachePut: async (key: string, geo: Geo) => {
    await rpc('cache_geo', { p_ip_hash: key, p_country: geo.country, p_region: geo.region, p_city: geo.city })
  },
  budget: async () => (await rpc<boolean>('bump_event_attempt', { p_ip_hash: `ipinfo:${utcHour()}`, p_limit: LOOKUPS_PER_HOUR })) === true,
  fetchGeo,
}

Deno.serve(async (req: Request) => {
  const origin = reflectOrAllowlisted(req.headers.get('origin'), ALLOWED)

  // Preflight first, unauthenticated, before anything that could throw (see /contact).
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' }, origin)
  }
  if (!req.headers.get('authorization')) {
    return json(401, { ok: false, error: 'unauthorized' }, origin)
  }
  if (Number(req.headers.get('content-length') ?? 0) > BODY_MAX_BYTES) {
    return json(413, { ok: false, error: 'too_large' }, origin)
  }

  try {
    let raw: unknown = null
    try {
      raw = await req.json()
    } catch {
      raw = null
    }
    const v = validateEvent(raw)
    if (v.kind === 'error') return json(400, { ok: false, error: v.error }, origin)
    const body = v.value

    if (!pageMatchesOrigin(body.url, req.headers.get('origin'))) {
      return json(403, { ok: false, error: 'origin_mismatch' }, origin)
    }
    const path = pagePath(body.url)
    if (isEditShell(path)) return new Response(null, { status: 204, headers: corsHeaders(origin) })

    const ip = normalizeIp(clientIp(req.headers))
    const ua = req.headers.get('user-agent') ?? ''

    // Per-(site, IP) cap first, so a flood is turned away before it costs a lookup or a
    // write. Keyed with the slug so one address cannot starve an artist's per-artist cap
    // from outside, and a fan behind a carrier NAT gets a budget per site, not per world.
    const ledgerKey = await ipHash(SALT, `${body.slug}:${ip}`)
    const allowed = await rpc<boolean>('bump_event_attempt', { p_ip_hash: ledgerKey, p_limit: PER_SITE_IP_PER_MINUTE })
    if (allowed !== true) return json(429, { ok: false, error: 'rate_limited' }, origin, { 'Retry-After': '60' })

    const bot = isBot(ua)
    const { device, browser } = parseUa(ua)
    const refHost = referrerHost(body.referrer, body.url)
    const utm = utmOf(body.url)
    const geo = bot ? { country: null, region: null, city: null } : await locateWith(geoDeps, ip, await ipHash(SALT, ip), IPINFO_TOKEN !== '')

    await rpc('record_site_event', {
      p_slug: body.slug,
      p_type: body.type,
      p_target: body.entity?.label ?? null,
      p_entity_id: body.entity?.id ?? null,
      p_entity_type: body.entity?.kind ?? null,
      p_path: path,
      p_referrer_host: refHost,
      p_source: sourceFor(utm.source, refHost),
      p_utm_source: utm.source,
      p_utm_medium: utm.medium,
      p_utm_campaign: utm.campaign,
      p_country: geo.country,
      p_region: geo.region,
      p_city: geo.city,
      p_device: device,
      p_browser: browser,
      p_visitor_hash: await visitorHash(SALT, utcDate(), ip, ua),
      p_is_bot: bot,
    })
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  } catch (err) {
    console.error('event door failed', err instanceof Error ? err.message.slice(0, 300) : 'unknown')
    return json(500, { ok: false, error: 'failed' }, origin)
  }
})
