import { createClient } from '@/lib/supabase/server'
import { seoSiteOrigin } from '@/lib/seo-tests/known'
import { SEO_TEST_IDS, type SeoTestId } from '@/lib/seo-tests/types'
import { requireArtist } from '../../../../_data'
import { loadTestTab } from './load'
import { TestTab } from './test-tab'

/**
 * AI TEST: the 24 plain-language tests (test-tab.tsx). `currentSite` is the same rule the run uses
 * to decide there is a site to fetch (known.ts `seoSiteOrigin`: a custom site at a public
 * address), so the page never offers a run that could only come back "no site", and can say
 * when the last run tested an address the site no longer has. The artist's name is for the
 * start drawing (the page under the magnifying glass).
 */
export default async function SeoTestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const artist = await requireArtist(id) // the ownership gate, before any read below renders
  const data = await loadTestTab(await createClient(), id)
  // `?open=<test>`: a link to one test lands here with that test's row open. Only a real test
  // id is taken; anything else opens nothing.
  const open = (await searchParams).open
  const initialOpen = typeof open === 'string' && (SEO_TEST_IDS as readonly string[]).includes(open) ? (open as SeoTestId) : null
  return <TestTab artistId={id} data={data} currentSite={seoSiteOrigin(artist)} artistName={artist.name ?? ''} initialOpen={initialOpen} />
}
