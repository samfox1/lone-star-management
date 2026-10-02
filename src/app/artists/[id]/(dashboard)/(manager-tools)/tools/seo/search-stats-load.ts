import { unstable_cache } from 'next/cache'
import { askSearchStats, isCacheable, searchStatsDepsFromEnv, type SearchStatsAnswer } from '@/lib/manager-tools/seo/search-stats-ask'
import { couldntAsk, searchPeriod, type SearchPeriodKey } from '@/lib/manager-tools/seo/search-stats'

/** Six hours: Google adds a day's numbers about once a day, Bing its searches weekly, so opening
 *  the tab must not ask either engine again every time (Search Console's quota is per site). */
const SIX_HOURS_S = 6 * 60 * 60

/** Thrown inside the cache to hand back an answer WITHOUT storing it (`unstable_cache` keeps
 *  nothing when its function rejects): a refusal, an error or a timeout is asked again next open. */
class NotCached extends Error {
  constructor(readonly answer: SearchStatsAnswer) {
    super('not cached')
  }
}

/**
 * Keyed by artist, period AND the period's last day, so a new day is a new entry (yesterday's
 * window is never served as today's). `unstable_cache`, not `use cache`: this app has not opted
 * into cacheComponents (see api/merch/[slug]/route.ts). Tag `search-stats`: revalidate it when
 * Tapir registers a site, so "not registered" doesn't outlive the registration.
 */
const cachedStats = unstable_cache(
  async (artistId: string, key: SearchPeriodKey, end: string): Promise<SearchStatsAnswer> => {
    const answer = await askSearchStats(artistId, key, searchStatsDepsFromEnv())
    // Past midnight (Pacific) between the key and the asking: the answer is another day's window,
    // so it isn't stored under this one.
    if (!isCacheable(answer) || answer.period.end !== end) throw new NotCached(answer)
    return answer
  },
  ['search-stats-v1'],
  { revalidate: SIX_HOURS_S, tags: ['search-stats'] },
)

/**
 * "How fans find you": the artist's Google and Bing numbers for the period
 * (lib/manager-tools/seo/search-stats.ts has the shape and its rules). Never throws.
 *
 * CALL ONLY AFTER THE OWNERSHIP GATE (loadSeoBase / requireArtist): the registration read inside
 * goes through the service client.
 */
export async function loadSearchStats(artistId: string, key: SearchPeriodKey): Promise<SearchStatsAnswer> {
  const period = searchPeriod(key, Date.now())
  try {
    return await cachedStats(artistId, key, period.end)
  } catch (e) {
    if (e instanceof NotCached) return e.answer
    return { period, askedAt: new Date().toISOString(), google: couldntAsk('google', period, 'error'), bing: couldntAsk('bing', period, 'error') }
  }
}
