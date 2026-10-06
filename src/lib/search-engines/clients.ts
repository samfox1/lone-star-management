/**
 * Google's and Bing's clients from the SERVER'S KEYS: the one place they are built, for the AI
 * test's listing (seo-tests/run.ts), the Search tab's numbers (manager-tools/seo/search-stats-ask.ts)
 * and the sitemap resend (resubmit.ts). Three hand copies of this used to drift apart.
 *
 *   • A missing key is that engine's null, never a throw.
 *   • Loaded lazily (the client modules too), so a caller with nothing registered reads no key.
 *   • `signal`: every request the clients make also listens to it (they take a fetcher, not a
 *     signal), so a caller's deadline aborts the request itself, not just the wait.
 *   • Refuses under vitest: tests load .env.local (vitest.setup.ts), so a test that forgot to
 *     inject its own clients would call the real Google and Bing with the real keys.
 */
import type { BingClient } from './bing'
import type { GoogleClient } from './google'

export type EngineClients = { google: GoogleClient | null; bing: BingClient | null }

export async function engineClientsFromEnv(opts: { signal?: AbortSignal } = {}): Promise<EngineClients> {
  if (process.env.VITEST) throw new Error('engineClientsFromEnv is not for tests: inject the clients')
  const [{ googleClient, googleCredsFromEnv }, { bingClient }] = await Promise.all([import('./google'), import('./bing')])
  const creds = googleCredsFromEnv(process.env.GOOGLE_SEARCH_SERVICE_ACCOUNT_B64)
  const key = process.env.BING_WEBMASTER_API_KEY?.trim()
  const stop = opts.signal
  // Google's and Bing's own API hosts, never an artist's address: the plain fetch, as the clients use.
  const fetcher = stop
    ? ((input: string | URL | Request, init?: RequestInit) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, stop]) : stop })) as typeof fetch
    : undefined
  return { google: creds ? googleClient(creds, { fetcher }) : null, bing: key ? bingClient(key, { fetcher }) : null }
}
