import { createClient } from '@/lib/supabase/server'
import { publicSiteOrigin } from '@/lib/custom-site'
import { seoSiteOrigin } from '@/lib/seo-tests/known'
import { SEO_TEST_IDS, type SeoTestId } from '@/lib/seo-tests/types'
import { requireArtist } from '../../../../_data'
import { loadTestTab } from './load'
import { TestTab } from './test-tab'

/**
 * TEST: the 24 plain-language tests (test-tab.tsx). `siteConnected` is the same rule the run
 * uses to decide there is a site to fetch (known.ts `seoSiteOrigin`: a custom site at a public
 * address), so the page never offers a run that could only come back "no site".
 */
export default async function SeoTestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const artist = await requireArtist(id) // the ownership gate, before any read below renders
  const data = await loadTestTab(await createClient(), id)
  // `?open=<test>`: the Overview's to-do rows land here with that test's dropdown open. Only a
  // real test id is taken; anything else opens nothing.
  const open = (await searchParams).open
  const initialOpen = typeof open === 'string' && (SEO_TEST_IDS as readonly string[]).includes(open) ? (open as SeoTestId) : null
  return <TestTab artistId={id} data={data} siteConnected={!!seoSiteOrigin(artist)} siteUrl={publicSiteOrigin(artist)} initialOpen={initialOpen} />
}
