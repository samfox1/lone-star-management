/**
 * BING, as Tapir's Bing Webmaster account (ADD_WEBSITE_PLAN.md: "Bing identity: the API key of
 * Sam's existing Bing account").
 *
 * Bing's JSON API (`https://ssl.bing.com/webmaster/api.svc/json/{Method}?apikey=…`; SOAP/POX were
 * retired 2026-08-31). Answers come wrapped as `{ "d": … }`. The calls:
 *   AddSite · GetUserSites (this site's `AuthenticationCode`, the msvalidate.01 value) ·
 *   VerifySite · SubmitFeed (how a sitemap reaches Bing; there is no SubmitSitemap)
 *
 * The key rides in every request URL, so it is the thing to protect: it never reaches a return
 * value, and Bing's own message is passed on (`detail`) only with the key blanked out. A thrown
 * fetch error's text is never passed on at all (it can quote the URL). Server-only.
 *
 * Every call answers `{ ok: true, value }` or `{ ok: false, reason, status?, detail? }`: `reason`
 * may be stored (site_verifications.error_code), `detail` is for the operator, printed, never stored.
 */
import { isBingVerification } from '@samfox1/site-bridge/verification'

export type BingReason = 'bing_auth' | 'bing_add' | 'bing_code' | 'bing_verify' | 'bing_feed' | 'bing_network'
export type BingResult<T> = { ok: true; value: T } | { ok: false; reason: BingReason; status?: number; detail?: string }

const API = 'https://ssl.bing.com/webmaster/api.svc/json/'
const TIMEOUT_MS = 15_000

/** The same site whatever the case or trailing slash. */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const x = new URL(u)
      return `${x.protocol}//${x.hostname.replace(/\.$/, '')}${x.pathname.replace(/\/+$/, '')}/`.toLowerCase()
    } catch {
      return u.toLowerCase()
    }
  }
  return norm(a) === norm(b)
}

export function bingClient(apiKey: string, deps: { fetcher?: typeof fetch } = {}) {
  const fetcher = deps.fetcher ?? fetch
  const scrub = (text: string) => text.split(apiKey).join('<key>').slice(0, 200)

  /** One call. `reason` names the step when Bing says no. */
  async function call(reason: BingReason, method: string, body?: Record<string, string>): Promise<BingResult<unknown>> {
    const url = `${API}${method}?apikey=${encodeURIComponent(apiKey)}`
    let res: Response
    try {
      res = await fetcher(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json; charset=utf-8' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return { ok: false, reason: 'bing_network' }
    }
    const j = (await res.json().catch(() => null)) as { d?: unknown; Message?: unknown } | null
    if (!res.ok) {
      const detail = typeof j?.Message === 'string' ? scrub(j.Message) : undefined
      return { ok: false, reason: res.status === 401 || res.status === 403 ? 'bing_auth' : reason, status: res.status, detail }
    }
    return { ok: true, value: j?.d ?? null }
  }

  return {
    /** The site on Tapir's Bing account. Repeating it is harmless. */
    async addSite(siteUrl: string): Promise<BingResult<true>> {
      const r = await call('bing_add', 'AddSite', { siteUrl })
      return r.ok ? { ok: true, value: true } : r
    },

    /** This site's msvalidate.01 value, from the account's site list. */
    async siteCode(siteUrl: string): Promise<BingResult<string>> {
      const r = await call('bing_code', 'GetUserSites')
      if (!r.ok) return r
      const sites = Array.isArray(r.value) ? (r.value as { Url?: unknown; AuthenticationCode?: unknown }[]) : []
      const mine = sites.find((s) => typeof s?.Url === 'string' && sameUrl(s.Url, siteUrl))
      const code = mine?.AuthenticationCode
      return isBingVerification(code) ? { ok: true, value: code } : { ok: false, reason: 'bing_code', detail: mine ? 'the code is not in the expected shape' : 'the site is not on the account' }
    },

    /** Bing checks the live page for the tag. `{ d: false }` is "not found yet". */
    async verify(siteUrl: string): Promise<BingResult<true>> {
      const r = await call('bing_verify', 'VerifySite', { siteUrl })
      if (!r.ok) return r
      return r.value === true ? { ok: true, value: true } : { ok: false, reason: 'bing_verify', detail: 'Bing did not find the tag yet' }
    },

    /** Tells Bing where the site's page list is. */
    async submitFeed(siteUrl: string, feedUrl: string): Promise<BingResult<true>> {
      const r = await call('bing_feed', 'SubmitFeed', { siteUrl, feedUrl })
      return r.ok ? { ok: true, value: true } : r
    },
  }
}

export type BingClient = ReturnType<typeof bingClient>
