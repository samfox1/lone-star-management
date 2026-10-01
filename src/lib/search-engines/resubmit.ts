/**
 * RESEND THE SITEMAP TO GOOGLE after a publish that changed a page's words (VISIBILITY_RECIPE.md:
 * "The sitemap is resent to Google when content changed"). Google has no IndexNow (lib/indexnow.ts
 * tells Bing and the rest); Search Console's sitemaps.submit is its nearest thing: "this list
 * changed, read it again".
 *
 * ONLY FOR A SITE TAPIR REGISTERED: the artist's `site_verifications` row for Google, VERIFIED, at
 * an https root address (the Search Console property exactly: https://www.example.com/). It is
 * read through the SERVICE client (the table is closed to every signed-in user) by seo-tests/run.ts
 * `readRegistered`, the same reader the AI test's listing uses. The sitemap is `<property>sitemap.xml`,
 * the one registration sent (register.ts).
 *
 * THE KEY (GOOGLE_SEARCH_SERVICE_ACCOUNT_B64) owns every client site in Search Console. It is read
 * only once a verified row exists, never under vitest (tests load .env.local), and never logged: an
 * outcome carries Google's reason code and status, never Google's words, the key or a token.
 *
 * Nothing here may fail or slow a Publish: it runs after the response (`after`), every error
 * becomes an outcome, and the scheduler only logs it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readRegistered } from '@/lib/seo-tests/run'
import { googleClient, googleCredsFromEnv, type GoogleClient, type GoogleReason } from './google'

export type ResubmitOutcome =
  | { sent: true; siteUrl: string; sitemapUrl: string }
  | { sent: false; reason: 'not-registered' | 'no-key' | 'error' }
  | { sent: false; reason: 'rejected'; code: GoogleReason; status?: number }

export type ResubmitDeps = {
  /** The service-role client that reads site_verifications. Default: `serviceFromEnv`. */
  service?: () => SupabaseClient
  /** The Google client, asked for only once a verified row exists; null = no key on the server.
   *  Default: `googleFromEnv`. */
  google?: () => Promise<Pick<GoogleClient, 'submitSitemap'> | null>
}

/** Tests load .env.local (vitest.setup.ts): a test that forgot to inject its own clients would read
 *  the hosted database and call the real Google with the real key. Under vitest the real ones refuse. */
function refuseUnderVitest(what: string) {
  if (process.env.VITEST) throw new Error(`${what} is not for tests: inject deps`)
}

/** The real service-role client. Refuses under vitest. */
export function serviceFromEnv(): SupabaseClient {
  refuseUnderVitest('serviceFromEnv')
  return createAdminClient()
}

/** The real Google client from the server's key, or null when there is none. Refuses under vitest. */
export async function googleFromEnv(): Promise<Pick<GoogleClient, 'submitSitemap'> | null> {
  refuseUnderVitest('googleFromEnv')
  const creds = googleCredsFromEnv(process.env.GOOGLE_SEARCH_SERVICE_ACCOUNT_B64)
  return creds ? googleClient(creds) : null
}

/** Resend one artist's sitemap to Search Console, if Tapir registered the site. Never throws; at
 *  most ONE submit. */
export async function resubmitSitemap(artistId: string, deps: ResubmitDeps = {}): Promise<ResubmitOutcome> {
  try {
    const registered = await readRegistered((deps.service ?? serviceFromEnv)(), artistId)
    const google = registered.find((r) => r.provider === 'google')
    if (!google) return { sent: false, reason: 'not-registered' }
    const client = await (deps.google ?? googleFromEnv)()
    if (!client) return { sent: false, reason: 'no-key' }
    const sitemapUrl = `${google.siteUrl}sitemap.xml`
    const r = await client.submitSitemap(google.siteUrl, sitemapUrl)
    if (r.ok) return { sent: true, siteUrl: google.siteUrl, sitemapUrl }
    return { sent: false, reason: 'rejected', code: r.reason, ...(r.status ? { status: r.status } : {}) }
  } catch {
    return { sent: false, reason: 'error' }
  }
}

/** The log line for an outcome worth a look, or null. A site Tapir never registered is the usual
 *  case and says nothing. Reason codes and a status only: no message text from anywhere. */
export function resubmitLogLine(artistId: string, out: ResubmitOutcome): string | null {
  if (out.sent || out.reason === 'not-registered') return null
  const why = out.reason === 'rejected' ? `${out.code}${out.status ? ` ${out.status}` : ''}` : out.reason
  return `[search-console] sitemap not resent (artist ${artistId}): ${why}`
}

/**
 * Schedule the resend for after the Publish's response has gone. Call it once per successful
 * publish that ships page words (publishGated, beside the IndexNow ping). A failure anywhere,
 * `after` itself included (outside a request), is logged quietly and goes no further.
 */
export function scheduleSitemapResubmit(artistId: string, deps: ResubmitDeps = {}): void {
  try {
    after(async () => {
      const line = resubmitLogLine(artistId, await resubmitSitemap(artistId, deps))
      if (line) console.warn(line)
    })
  } catch (e) {
    console.warn('[search-console] sitemap resend not scheduled:', e instanceof Error ? e.message : e)
  }
}
