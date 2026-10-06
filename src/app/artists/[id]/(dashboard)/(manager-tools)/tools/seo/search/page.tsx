import { isSearchPeriodKey } from '@/lib/manager-tools/seo/search-stats'
import { requireArtist } from '../../../../_data'
import { loadAiVisits, loadSearchStats } from './load'
import { SearchTab } from './search-tab'

/**
 * SEARCH, "How fans find you" (Sam, 2026-10-02): Google's and Bing's numbers for the artist's
 * site, for the period in `?p=` (28 days unless it says 3 months). The engine (`?e=`) is only a
 * view, read by the tab itself (search-tab.tsx), so switching it asks nothing.
 *
 * The ownership gate (`requireArtist`, RLS) runs FIRST: the loader reads the registrations
 * through the service client. The loader keeps an answer six hours (search/load.ts), so
 * opening the tab asks Google and Bing at most once per period in that time. The artist's name
 * picks out the searches for them ("your spot"); the AI visits are read for the same days.
 */
export default async function SeoSearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const key = isSearchPeriodKey(sp.p) ? sp.p : '28d'
  const artist = await requireArtist(id)
  // One period: the seen / clicked chart asks for its other one only when it is clicked
  // (search/actions.ts; the review, 2026-10-06: waiting on every period made every open wait on
  // the slowest, and a refused one is never cached).
  const answer = await loadSearchStats(id, key)
  const ai = await loadAiVisits(id, answer.period)
  return <SearchTab artistId={id} answer={answer} name={artist.name} ai={ai} />
}
