import { isSearchPeriodKey } from '@/lib/manager-tools/seo/search-stats'
import { requireArtist } from '../../../../_data'
import { loadSearchStats } from './load'
import { SearchTab } from './search-tab'

/**
 * SEARCH, "How fans find you" (Sam, 2026-10-02): Google's and Bing's numbers for the artist's
 * site, for the period in `?p=` (28 days unless it says 3 months). The engine (`?e=`) is only a
 * view, read by the tab itself (search-tab.tsx), so switching it asks nothing.
 *
 * The ownership gate (`requireArtist`, RLS) runs FIRST: the loader reads the registrations
 * through the service client. The loader keeps an answer six hours (search/load.ts), so
 * opening the tab asks Google and Bing at most once per period in that time.
 */
export default async function SeoSearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const key = isSearchPeriodKey(sp.p) ? sp.p : '28d'
  await requireArtist(id)
  const answer = await loadSearchStats(id, key)
  return <SearchTab answer={answer} />
}
