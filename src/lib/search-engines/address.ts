/**
 * THE ONE ADDRESS a site is registered under at Google and Bing (ADD_WEBSITE_PLAN.md "One
 * address, decided once").
 *
 * A Search Console URL-prefix property covers only URLs under it, so the address must be the one
 * the site really serves from: skeenmusic.com 308s to www.skeenmusic.com, and registering the apex
 * would verify fine (Google's tag check follows redirects) and then quietly fail every sitemap and
 * URL Inspection call. So the live site decides: fetch the home page, follow redirects, keep the
 * final origin.
 *
 * The registered form is `https://<lower-case host>/`: https only, punycode for international
 * names (URL does that), no port, no path, a trailing slash, never a preview host, a loopback or
 * private address, or a bare IP. The same string is the Google property, the Bing site, the
 * sitemap's base and the database's `site_verifications.site_url` (whose CHECK it always passes).
 */
import { pingableOrigin } from '@/lib/indexnow'
import { guardedFetch, type GuardedOptions } from '@/lib/guarded-fetch'
// Same site: the same host give or take a leading "www." (both sides are registration forms).
import { sameSite } from '@/lib/seo-tests/evidence'

/** A host that is only digits and dots: an IPv4 address (the URL parser has normalised it). */
const IPV4 = /^[\d.]+$/

/** The database's own CHECK on site_verifications.site_url (20260930120000; the suite pins it
 *  against the migration). The registered form must always pass it. */
export const SITE_URL_SHAPE = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?\/$/

/** `https://host/` for an address that may be registered, or null. */
export function registrationForm(raw: string): string | null {
  if (typeof raw !== 'string') return null
  // https, public (no loopback hatch), not a *.vercel.app preview: the IndexNow rule.
  const origin = pingableOrigin(raw)
  if (!origin) return null
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return null
  }
  const host = u.hostname.replace(/\.$/, '')
  // Any explicit port is refused (isPublicSiteUrl lets :80 through, and https://x:80 is not a site).
  // (A name with no dot fails SITE_URL_SHAPE below.)
  if (u.port || IPV4.test(host) || host.includes(':')) return null
  const form = `https://${host}/`
  return form.length <= 300 && SITE_URL_SHAPE.test(form) ? form : null
}

export type SiteAddress =
  | { ok: true; siteUrl: string }
  | { ok: false; reason: 'bad_address' | 'no_answer'; detail?: string }
  /** `to`: where it went, so the operator can say "it goes to X; register X instead". */
  | { ok: false; reason: 'redirects_elsewhere'; to?: string }

/**
 * Where the site really lives: the registered form of the home page's FINAL address after
 * redirects. A redirect to another site (a link page, a store) is refused: that is not this
 * artist's site. `opts` is the guarded fetch's (tests inject a fake web).
 */
export async function resolveSiteAddress(input: string, opts: Pick<GuardedOptions, 'fetcher' | 'resolver'> = {}): Promise<SiteAddress> {
  const start = registrationForm(input)
  if (!start) return { ok: false, reason: 'bad_address' }
  const res = await guardedFetch(start, { ...opts, timeoutMs: 10_000, deadlineMs: 20_000, maxBytes: 64 * 1024 })
  // Only a 2xx is an answer: a redirect with nowhere to go (no Location) is not a site.
  if (!res.finalUrl || res.status == null || res.status < 200 || res.status >= 300) return { ok: false, reason: 'no_answer', ...(res.error ? { detail: res.error } : res.status ? { detail: `answered ${res.status}` } : {}) }
  const final = registrationForm(res.finalUrl)
  // Another site (a link page, a store), or another subdomain of this one: not this artist's site.
  if (!final || !sameSite(start, final)) return { ok: false, reason: 'redirects_elsewhere', to: res.finalUrl }
  return { ok: true, siteUrl: final }
}
