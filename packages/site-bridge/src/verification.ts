/**
 * SEARCH-ENGINE VERIFICATION: the codes that prove to Google and Bing that Tapir controls this
 * site, so Tapir can register it in Search Console and Bing Webmaster Tools, send its sitemap and
 * read whether its pages are listed (site-bridge 0.44.0, lone-star ADD_WEBSITE_PLAN.md).
 *
 * How it fits together:
 *   1. lone-star keeps one Google and one Bing code per artist in a table only its server can
 *      write (20260930120000_site_verifications.sql). They are CONFIG, not content: no publish,
 *      no revision, nothing a manager or "Restore version" can change.
 *   2. `get_public_site` hands them to the site as `verification: { google, bing }`.
 *   3. The site spreads `siteVerification(payload)` into its ROOT metadata (CONNECTING.md §10):
 *
 *        // app/layout.tsx
 *        export async function generateMetadata() {
 *          const payload = await getSite()
 *          return { …, verification: siteVerification(payload, { google: process.env.GOOGLE_SITE_VERIFICATION }) }
 *        }
 *
 *      Next renders `<meta name="google-site-verification">` and `<meta name="msvalidate.01">`
 *      on every page. Google and Bing re-check them for as long as the site is registered, so
 *      they must stay: never render them conditionally on a page or a route.
 *
 * The one rule here: a value that is not a code in its provider's shape is NEVER emitted. It
 * lands in an HTML attribute on the artist's own domain; without the shape check a payload
 * value could carry a quote or a bracket into the page. The shapes are the database's own CHECKs
 * (the suite pins them against the migration), so a stored code always passes.
 *
 * Pure: no DOM, no fetch, no clock. The returned object is exactly Next's `Metadata['verification']`
 * shape, but nothing here imports Next.
 */

/** Google's `google-site-verification` content: base64url, 20 to 128 characters. */
export const GOOGLE_VERIFICATION_SHAPE = /^[A-Za-z0-9_-]{20,128}$/

/** Bing's `msvalidate.01` content: 32 hex digits, either case. */
export const BING_VERIFICATION_SHAPE = /^[0-9A-Fa-f]{32}$/

export function isGoogleVerification(value: unknown): value is string {
  return typeof value === 'string' && GOOGLE_VERIFICATION_SHAPE.test(value)
}

export function isBingVerification(value: unknown): value is string {
  return typeof value === 'string' && BING_VERIFICATION_SHAPE.test(value)
}

/** What `get_public_site` sends (20260930120000). Null before a site is registered. */
export type SiteVerificationCodes = { google?: string | null; bing?: string | null }

/** Anything with the payload's `verification` field: the full `PublicSitePayload`, or null when
 *  the site is unconfigured or unpublished. */
type WithVerification = { verification?: SiteVerificationCodes | null } | null | undefined

/** Next's `Metadata['verification']`, as far as these two providers go. */
export type SiteVerificationMeta = { google?: string[]; other?: { 'msvalidate.01': string } }

/**
 * The verification tags for the site's root metadata, or undefined when there are none.
 *
 * `own.google`: a Google code the site already proves ownership with (skeen's
 * GOOGLE_SITE_VERIFICATION env var). It is kept BESIDE Tapir's, never replaced: dropping it would
 * silently unverify whoever set it up. Checked just as strictly as the payload's.
 *
 * A malformed value is dropped, never repaired: a trimmed or escaped code wouldn't verify anyway.
 */
export function siteVerification(payload: WithVerification, own?: { google?: string | null }): SiteVerificationMeta | undefined {
  const codes = payload?.verification
  const google = [codes?.google, own?.google].filter(isGoogleVerification)
  const unique = google.filter((code, i) => google.indexOf(code) === i)
  const bing = isBingVerification(codes?.bing) ? codes.bing : null
  if (!unique.length && !bing) return undefined
  return {
    ...(unique.length ? { google: unique } : {}),
    ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
  }
}
