/**
 * GOOGLE, as Tapir's robot account (ADD_WEBSITE_PLAN.md: "Google identity: a service account").
 *
 * The service account `tapir-search@digital-tapir.iam.gserviceaccount.com` signs its own JWT with
 * its private key (no library, Node crypto), trades it for an access token, and calls:
 *   Site Verification API v1  getToken (META) · webResource.insert (verify, with the owner)
 *   Search Console API v3     sites.add · sitemaps.submit
 *   Search Console API v1     urlInspection.index.inspect (is a page listed? the AI test's
 *                             "How crawlers see your site", seo-tests/run.ts)
 * The key comes from the env (`GOOGLE_SEARCH_SERVICE_ACCOUNT_B64`, base64 JSON). It owns every
 * client site in Search Console: it never appears in a return value, a log line or an error, and
 * this file is server-only (imported by the register script and, later, admin server actions).
 *
 * Every call answers `{ ok: true, value }` or `{ ok: false, reason, status?, detail? }`. `reason`
 * is a short code a caller may STORE (site_verifications.error_code); `detail` is Google's own
 * short message for the operator, printed, never stored.
 */
import { createSign } from 'node:crypto'
import { isGoogleVerification } from '@samfox1/site-bridge/verification'

export type GoogleCreds = { client_email: string; private_key: string }

export type GoogleReason = 'google_auth' | 'google_token' | 'google_verify' | 'google_owner' | 'google_add' | 'google_sitemap' | 'google_inspect' | 'google_network'
export type GoogleResult<T> = { ok: true; value: T } | { ok: false; reason: GoogleReason; status?: number; detail?: string }

export type GoogleDeps = { fetcher?: typeof fetch; now?: () => number }

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPES = ['https://www.googleapis.com/auth/siteverification', 'https://www.googleapis.com/auth/webmasters']
const VERIFY_API = 'https://www.googleapis.com/siteVerification/v1'
const CONSOLE_API = 'https://www.googleapis.com/webmasters/v3'
const INSPECT_API = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const TIMEOUT_MS = 15_000

/** The robot's key from the env value (base64 JSON), or null when it is missing or broken.
 *  The caller passes the value (`process.env.GOOGLE_SEARCH_SERVICE_ACCOUNT_B64`): there is NO
 *  default read of the env here, so a test asking "what about no key?" can never be handed the
 *  real one (2026-09-30: a default parameter did exactly that, and a failing assertion printed
 *  part of the real key). */
export function googleCredsFromEnv(value: string | undefined): GoogleCreds | null {
  if (!value) return null
  try {
    const j = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Record<string, unknown>
    if (typeof j.client_email !== 'string' || typeof j.private_key !== 'string') return null
    return { client_email: j.client_email, private_key: j.private_key }
  } catch {
    return null
  }
}

/** Google's `token` for META: the whole `<meta … content="X">` tag, or X alone (the docs don't
 *  say which). Kept only if X is in the shape the bridge will render. */
function metaContent(token: unknown): string | null {
  if (typeof token !== 'string') return null
  const inTag = token.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? token.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1]
  const value = (inTag ?? token).trim()
  return isGoogleVerification(value) ? value : null
}

/** What URL Inspection says about one page (`indexStatusResult`): `verdict` PASS / PARTIAL / FAIL /
 *  NEUTRAL, `coverage` Google's sentence ("Submitted and indexed"), `lastCrawl` when Googlebot
 *  last fetched it (ISO). null = Google's answer did not say. */
export type GoogleInspection = { verdict: string | null; coverage: string | null; lastCrawl: string | null }

/** A string field of Google's answer, cut; anything else null. */
const textField = (v: unknown, max: number): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null)

/** An RFC 3339 time as ISO, or null when it isn't one. */
function timeField(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Google's own short message from an error body, cut, for the operator. */
async function detailOf(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { error?: { message?: unknown } | string; error_description?: unknown }
    const msg = typeof j.error === 'object' ? j.error?.message : (j.error_description ?? j.error)
    // No control characters reach the operator's terminal.
    return typeof msg === 'string' ? msg.replace(/\p{Cc}/gu, ' ').slice(0, 200) : undefined
  } catch {
    return undefined
  }
}

export function googleClient(creds: GoogleCreds, deps: GoogleDeps = {}) {
  const fetcher = deps.fetcher ?? fetch
  const now = deps.now ?? Date.now
  let cached: { token: string; until: number } | null = null

  const b64u = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')

  async function send(url: string, init: RequestInit): Promise<Response | null> {
    try {
      return await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      return null
    }
  }

  /** An access token for the two scopes, reused until a minute before it expires. */
  async function accessToken(): Promise<GoogleResult<string>> {
    if (cached && now() < cached.until) return { ok: true, value: cached.token }
    const iat = Math.floor(now() / 1000)
    const head = b64u({ alg: 'RS256', typ: 'JWT' })
    const claims = b64u({ iss: creds.client_email, scope: SCOPES.join(' '), aud: TOKEN_URL, iat, exp: iat + 3600 })
    let assertion: string
    try {
      const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(creds.private_key).toString('base64url')
      assertion = `${head}.${claims}.${sig}`
    } catch {
      return { ok: false, reason: 'google_auth', detail: 'the key could not sign' }
    }
    const res = await send(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    })
    if (!res) return { ok: false, reason: 'google_network' }
    if (!res.ok) return { ok: false, reason: 'google_auth', status: res.status, detail: await detailOf(res) }
    const j = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown }
    if (typeof j.access_token !== 'string') return { ok: false, reason: 'google_auth', status: res.status }
    const life = typeof j.expires_in === 'number' ? j.expires_in : 3600
    cached = { token: j.access_token, until: now() + Math.max(0, life - 60) * 1000 }
    return { ok: true, value: j.access_token }
  }

  /** One authorised call. `reason` names the step when Google says no. A 401 means the cached
   *  token died early (revoked, clock skew): forget it and try once more with a fresh one. */
  async function call(reason: GoogleReason, url: string, init: RequestInit, retried = false): Promise<GoogleResult<Response>> {
    const t = await accessToken()
    if (!t.ok) return t
    const res = await send(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${t.value}` } })
    if (!res) return { ok: false, reason: 'google_network' }
    if (res.status === 401 && !retried) {
      cached = null
      return call(reason, url, init, true)
    }
    if (!res.ok) return { ok: false, reason, status: res.status, detail: await detailOf(res) }
    return { ok: true, value: res }
  }

  const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const site = (siteUrl: string) => ({ type: 'SITE', identifier: siteUrl })

  // The access token is deliberately NOT on the returned object: it owns every site, and a
  // stray console.log of it would print it (sidekick review, 2026-09-30).
  return {
    /** The code for `<meta name="google-site-verification">` on this site. */
    async getMetaToken(siteUrl: string): Promise<GoogleResult<string>> {
      const r = await call('google_token', `${VERIFY_API}/token`, jsonInit('POST', { site: site(siteUrl), verificationMethod: 'META' }))
      if (!r.ok) return r
      const j = (await r.value.json().catch(() => ({}))) as { token?: unknown }
      const code = metaContent(j.token)
      return code ? { ok: true, value: code } : { ok: false, reason: 'google_token', status: r.value.status, detail: 'the token is not in the expected shape' }
    },

    /**
     * Google checks the live page for the tag and records the robot as a verified owner, and
     * `owners` as (delegated) owners. Whether insert honours `owners` isn't certain from the docs,
     * so the answer's owner list is checked, and anyone missing is added with an update (which
     * replaces the whole list, so it sends Google's list plus the missing ones).
     */
    async verify(siteUrl: string, owners: string[]): Promise<GoogleResult<true>> {
      const r = await call('google_verify', `${VERIFY_API}/webResource?verificationMethod=META`, jsonInit('POST', { site: site(siteUrl), owners }))
      if (!r.ok) return r
      const res = (await r.value.json().catch(() => ({}))) as { id?: unknown; owners?: unknown }
      const have = Array.isArray(res.owners) ? res.owners.filter((o): o is string => typeof o === 'string') : []
      const missing = owners.filter((o) => !have.some((h) => h.toLowerCase() === o.toLowerCase()))
      if (!missing.length) return { ok: true, value: true }
      if (typeof res.id !== 'string') return { ok: false, reason: 'google_owner', detail: 'verified, but Google gave no resource id to add the owner to' }
      // Google's id may come back already encoded (https%3A%2F%2F…): decode once, encode once.
      let id = res.id
      try {
        id = decodeURIComponent(res.id)
      } catch {
        // Not encoded (a stray %): use it as it is.
      }
      const u = await call('google_owner', `${VERIFY_API}/webResource/${encodeURIComponent(id)}`, jsonInit('PUT', { site: site(siteUrl), owners: [...have, ...missing] }))
      return u.ok ? { ok: true, value: true } : u
    },

    /** The property in the robot's Search Console. Repeating it is harmless. */
    async addSite(siteUrl: string): Promise<GoogleResult<true>> {
      const r = await call('google_add', `${CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}`, { method: 'PUT' })
      return r.ok ? { ok: true, value: true } : r
    },

    /**
     * Is this page on Google? Search Console's URL Inspection for a page of a property the robot
     * owns (`siteUrl` exactly as registered). Read-only: it asks Google, it changes nothing.
     */
    async inspectUrl(siteUrl: string, pageUrl: string): Promise<GoogleResult<GoogleInspection>> {
      const r = await call('google_inspect', INSPECT_API, jsonInit('POST', { inspectionUrl: pageUrl, siteUrl }))
      if (!r.ok) return r
      const j = (await r.value.json().catch(() => ({}))) as { inspectionResult?: { indexStatusResult?: Record<string, unknown> } }
      if (!j.inspectionResult || typeof j.inspectionResult !== 'object') return { ok: false, reason: 'google_inspect', status: r.value.status, detail: 'no inspection result in the answer' }
      const x = j.inspectionResult.indexStatusResult ?? {}
      return { ok: true, value: { verdict: textField(x.verdict, 60), coverage: textField(x.coverageState, 200), lastCrawl: timeField(x.lastCrawlTime) } }
    },

    /** Tells Google where the site's page list is. */
    async submitSitemap(siteUrl: string, sitemapUrl: string): Promise<GoogleResult<true>> {
      const r = await call('google_sitemap', `${CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: 'PUT' })
      return r.ok ? { ok: true, value: true } : r
    },
  }
}

export type GoogleClient = ReturnType<typeof googleClient>
