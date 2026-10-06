/**
 * ASKING Google and Bing for an artist's search numbers ("How fans find you"): the half of
 * search-stats.ts that talks to the outside. SERVER ONLY.
 *
 *   • Only where Tapir REGISTERED the site (site_verifications, verified, read through the service
 *     client by search-engines/registered.ts `readRegistered`, the same reader the AI test and the
 *     sitemap resend use), on the address exactly as registered. Nothing registered: no key is read.
 *   • Both engines at once, inside ONE deadline. Whatever hasn't answered by then is `timeout`;
 *     the deadline also aborts the requests. The other engine's answer still stands.
 *   • Google: the total first, the other five parts only if it answered (a refusal costs one
 *     request, not six; the first call also signs in, so the five reuse its token).
 *   • Never throws: anything that breaks is that engine's `error`.
 *
 * The caller must already have checked the signed-in manager owns the artist: this reads through
 * the service client. The keys are read only by `searchStatsDepsFromEnv`, which refuses under
 * vitest (tests load .env.local; 2026-09-30 a test printed part of the real Google key).
 */
import type { BingClient } from '@/lib/search-engines/bing'
import type { GoogleClient } from '@/lib/search-engines/google'
import type { SeoRegistration } from '@/lib/search-engines/registered'
import {
  GOOGLE_PARTS,
  couldntAsk,
  googleRequests,
  normaliseBing,
  normaliseGoogle,
  searchPeriod,
  type CouldntAsk,
  type EngineStats,
  type GoogleAnswers,
  type SearchEngineId,
  type SearchPeriod,
  type SearchPeriodKey,
} from './search-stats'

export type SearchClients = {
  google: Pick<GoogleClient, 'searchAnalytics'> | null
  bing: Pick<BingClient, 'trafficStats' | 'queryStats'> | null
}

export type SearchStatsDeps = {
  /** The site's VERIFIED registrations. Default: readRegistered through the service client. */
  readRegistered: (artistId: string) => Promise<SeoRegistration[]>
  /** The clients from the server's keys (null = no key). Their requests must listen to `signal`. */
  clients: (opts: { signal: AbortSignal }) => Promise<SearchClients>
  now?: () => number
  deadlineMs?: number
}

/** `added`: when Tapir registered the site with each engine (site_verifications.verified_at), or
 *  null. The Search tab says a NEW site's empty answer is normal ("added Sep 30 · usually within
 *  2 weeks"); it needs the date to know the site is new. */
export type SearchStatsAnswer = { period: SearchPeriod; askedAt: string; added: Record<SearchEngineId, string | null>; google: EngineStats; bing: EngineStats }

const NOT_ADDED: Record<SearchEngineId, string | null> = { google: null, bing: null }

/** Both engines must answer inside this. Each request also has its client's own 15 s limit. */
const DEADLINE_MS = 12_000

/** `p`'s value; `late` once `stop` aborts; `broke` if it throws. */
function untilStopped<T>(p: () => Promise<T>, stop: AbortSignal, late: T, broke: T): Promise<T> {
  if (stop.aborted) return Promise.resolve(late)
  return new Promise((resolve) => {
    const onAbort = () => resolve(late)
    stop.addEventListener('abort', onAbort, { once: true })
    Promise.resolve()
      .then(p)
      .then(resolve, () => resolve(broke))
      .finally(() => stop.removeEventListener('abort', onAbort))
  })
}

async function askGoogle(client: NonNullable<SearchClients['google']>, siteUrl: string, period: SearchPeriod): Promise<EngineStats> {
  const reqs = googleRequests(period)
  const total = await client.searchAnalytics(siteUrl, reqs.total)
  if (!total.ok) return normaliseGoogle(period, Object.fromEntries(GOOGLE_PARTS.map((p) => [p, total])) as GoogleAnswers)
  const rest = await Promise.all(GOOGLE_PARTS.filter((p) => p !== 'total').map(async (p) => [p, await client.searchAnalytics(siteUrl, reqs[p])] as const))
  return normaliseGoogle(period, { total, ...Object.fromEntries(rest) } as GoogleAnswers)
}

async function askBing(client: NonNullable<SearchClients['bing']>, siteUrl: string, period: SearchPeriod): Promise<EngineStats> {
  const [traffic, queries] = await Promise.all([client.trafficStats(siteUrl), client.queryStats(siteUrl)])
  return normaliseBing(period, { traffic, queries })
}

/** One artist's search numbers for the period, from every engine the site is registered with. */
export async function askSearchStats(artistId: string, key: SearchPeriodKey, deps: SearchStatsDeps): Promise<SearchStatsAnswer> {
  const now = deps.now ?? Date.now
  const period = searchPeriod(key, now())
  const askedAt = new Date(now()).toISOString()
  const both = (state: CouldntAsk): SearchStatsAnswer => ({ period, askedAt, added: NOT_ADDED, google: couldntAsk('google', period, state), bing: couldntAsk('bing', period, state) })

  let registered: SeoRegistration[]
  try {
    registered = await deps.readRegistered(artistId)
  } catch {
    return both('error')
  }
  const where = (engine: SearchEngineId) => registered.find((r) => r.provider === engine)?.siteUrl ?? null
  const google = where('google')
  const bing = where('bing')
  if (!google && !bing) return both('not_registered')
  const addedOn = (engine: SearchEngineId) => registered.find((r) => r.provider === engine)?.verifiedAt ?? null
  const added = { google: addedOn('google'), bing: addedOn('bing') }

  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), deps.deadlineMs ?? DEADLINE_MS)
  try {
    let clients: SearchClients
    try {
      clients = await deps.clients({ signal: stop.signal })
    } catch {
      return both('error')
    }
    const one = <C>(engine: SearchEngineId, siteUrl: string | null, client: C | null, ask: (c: C, siteUrl: string) => Promise<EngineStats>): Promise<EngineStats> => {
      if (!siteUrl) return Promise.resolve(couldntAsk(engine, period, 'not_registered'))
      if (!client) return Promise.resolve(couldntAsk(engine, period, 'no_key'))
      return untilStopped(() => ask(client, siteUrl), stop.signal, couldntAsk(engine, period, 'timeout'), couldntAsk(engine, period, 'error'))
    }
    const [g, b] = await Promise.all([
      one('google', google, clients.google, (c, s) => askGoogle(c, s, period)),
      one('bing', bing, clients.bing, (c, s) => askBing(c, s, period)),
    ])
    return { period, askedAt, added, google: g, bing: b }
  } finally {
    clearTimeout(timer)
    stop.abort()
  }
}

/** Worth keeping for hours: everything but a refusal, an error or a timeout, which are asked
 *  again next time, and NOTHING registered at all. Registration runs from the CLI
 *  (scripts/site-register.ts), which can't clear the Next cache, so a stored "Site not added yet"
 *  would outlive it by up to 6 hours; that answer asks no engine (one service-role read), so it is
 *  cheap to ask again. One engine `not_registered` beside an answer IS kept: a Google-only site
 *  would otherwise ask Google six times on every open. Adding the second engine later therefore
 *  waits out the 6 hours (nothing purges the cache yet). `no_key` is kept: it changes only with a
 *  deploy. */
const PASSING = new Set<EngineStats['state']>(['quota', 'error', 'timeout'])
export const isCacheable = (a: SearchStatsAnswer) =>
  !(a.google.state === 'not_registered' && a.bing.state === 'not_registered') && !PASSING.has(a.google.state) && !PASSING.has(a.bing.state)

/** The real deps: the service client and the server's keys (a missing key is that engine's
 *  null). Loaded lazily, so nothing registered reads no key. Refuses under vitest. */
export function searchStatsDepsFromEnv(): SearchStatsDeps {
  if (process.env.VITEST) throw new Error('searchStatsDepsFromEnv is not for tests: inject deps')
  return {
    readRegistered: async (artistId) => {
      const [{ createAdminClient }, { readRegistered }] = await Promise.all([import('@/lib/supabase/admin'), import('@/lib/search-engines/registered')])
      return readRegistered(createAdminClient(), artistId)
    },
    // Every request listens to the deadline too (search-engines/clients.ts).
    clients: ({ signal }) => import('@/lib/search-engines/clients').then((m) => m.engineClientsFromEnv({ signal })),
  }
}
