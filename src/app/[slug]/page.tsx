import { notFound } from 'next/navigation'
import { ArtistTemplate } from '@/components/artist-template'
import { createClient } from '@/lib/supabase/server'
import { getPublishedSite } from '@/lib/site'

// The public artist site. Unauthenticated; served through the public read path
// (get_public_site), which returns published snapshots and public-safe fields
// only. A logged-out fan reaches this; the proxy does not gate /[slug].
export default async function PublicArtistPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const site = await getPublishedSite(supabase, slug)
  if (!site) notFound()

  return <ArtistTemplate data={site} />
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const site = await getPublishedSite(supabase, slug)
  return { title: site ? site.artist.name : 'Not found' }
}
