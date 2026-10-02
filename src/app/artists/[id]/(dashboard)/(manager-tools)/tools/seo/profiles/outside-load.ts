import { unstable_cache } from 'next/cache'
import { checkDiscogs, checkWikidata } from '@/lib/manager-tools/profiles/outside-check'
import { connectedIds, discogsPageUrl, knownMbid, profileSiteUrl, type DiscogsCheck, type OutsideChecks, type WikidataCheck } from '@/lib/manager-tools/profiles/outside'
import type { loadSeoBase } from '../load'

type Base = Awaited<ReturnType<typeof loadSeoBase>>

/** A day: an artist's Discogs page and Wikidata item change rarely, and opening the tab must
 *  not ask either service again. */
const DAY_S = 24 * 60 * 60

/** Thrown inside the cache so "couldn't check" is NEVER stored (`unstable_cache` keeps nothing
 *  when its function rejects): the next open asks again rather than repeating a failure all day. */
class NotCached extends Error {}

/** Keyed by what is asked (site, ids), so a new Connections link or site asks afresh. v2: the
 *  site became the custom site with its path (2026-10-01), so a v1 answer is never reused. */
const cachedWikidata = unstable_cache(
  async (siteUrl: string | null, mbid: string | null, item: string | null): Promise<WikidataCheck> => {
    const r = await checkWikidata({ siteUrl, mbid, item })
    if (r.kind === 'unknown') throw new NotCached()
    return r
  },
  ['profiles-wikidata-v2'],
  { revalidate: DAY_S },
)

const cachedDiscogs = unstable_cache(
  async (siteUrl: string | null, id: string | null): Promise<DiscogsCheck> => {
    const r = await checkDiscogs({ siteUrl, id })
    if (r.kind === 'unknown') throw new NotCached()
    return r
  },
  ['profiles-discogs-v2'],
  { revalidate: DAY_S },
)

/**
 * The Profiles tab's Discogs and Wikidata rows (lib/manager-tools/profiles/outside.ts): what the
 * manager connected, the MusicBrainz id the AI test found, and the artist's custom site, asked of
 * each service. Never throws: anything that fails is "couldn't check".
 *
 * The one read here (the newest AI test run's `mb` result) is RLS-scoped and runs after
 * loadSeoBase's ownership gate. Only `results` is read, not the crawl.
 */
export async function loadOutsideChecks(b: Base, links: readonly { url?: string | null }[]): Promise<OutsideChecks> {
  const id = b.artist.id as string
  const run = await b.supabase
    .from('seo_test_runs')
    .select('results')
    .eq('artist_id', id)
    .eq('status', 'done')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(
      (r) => r,
      () => null,
    )
  const results = Array.isArray(run?.data?.results) ? (run.data.results as { id?: unknown; status?: unknown; evidence?: unknown }[]) : []
  const mb = results.find((r) => r?.id === 'mb')
  const mbResult = mb && typeof mb.status === 'string' ? { status: mb.status, evidence: Array.isArray(mb.evidence) ? (mb.evidence as { value: string }[]) : [] } : null

  const ids = connectedIds(links)
  const mbid = knownMbid(links, mbResult)
  // The custom site only, path kept (profileSiteUrl), never b.siteUrl: for a template artist
  // that is `<this app>/<slug>`, whose host every artist shares.
  const site = profileSiteUrl(b.artist)
  const [wikidata, discogs] = await Promise.all([
    cachedWikidata(site, mbid, ids.wikidata).catch((): WikidataCheck => ({ kind: 'unknown' })),
    cachedDiscogs(site, ids.discogs).catch((): DiscogsCheck => ({ kind: 'unknown', url: ids.discogs ? discogsPageUrl(ids.discogs) : null })),
  ])
  return { wikidata, discogs }
}
