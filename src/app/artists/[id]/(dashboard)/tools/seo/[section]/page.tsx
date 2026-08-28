import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FAQ_KEYS, SEO_FIELDS } from '@/lib/site-content-schema'
import { mediaUrl } from '@/lib/storage-url'
import { publicSiteOrigin } from '@/lib/custom-site'
import { requireArtist } from '../../../_data'
import { isSeoSection } from '../sections'
import { ListingSection } from '../sections/listing'
import { LogoSection } from '../sections/logo'
import { FactsSection } from '../sections/facts'
import { AboutSection } from '../sections/about'
import { AltSection, type AltPhoto } from '../sections/alt'
import { AiSection } from '../sections/ai'
import { TestSection } from '../sections/test'
import type { OgSource } from '../og-image-picker'

export default async function SeoSectionPage({ params }: { params: Promise<{ id: string; section: string }> }) {
  const { id, section } = await params
  if (!isSeoSection(section)) notFound()
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const [{ data: rows }, { data: facts }] = await Promise.all([
    supabase.from('site_content').select('key, value').eq('artist_id', id),
    supabase.from('artists').select('bio, genre, location, schema_type, hero_image_url').eq('id', id).single(),
  ])
  const content = Object.fromEntries((rows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']))
  const seo = Object.fromEntries(SEO_FIELDS.map((f) => [f.key, content[f.key] ?? '']))
  const bio = ((facts?.bio as string | null) ?? '').trim()
  const siteUrl = publicSiteOrigin(artist)
  const schemaType = (facts?.schema_type as string | null) ?? 'MusicGroup'

  if (section === 'listing') return <ListingSection artistId={id} name={artist.name} bio={bio} siteUrl={siteUrl} initial={seo} />
  if (section === 'facts') {
    return <FactsSection artistId={id} initial={{ genre: (facts?.genre as string | null) ?? '', location: (facts?.location as string | null) ?? '', schema_type: schemaType }} />
  }
  if (section === 'about') return <AboutSection artistId={id} initialBio={bio} initial={seo} />
  if (section === 'ai') return <AiSection artistId={id} name={artist.name} schemaType={schemaType} initial={Object.fromEntries(FAQ_KEYS.map((k) => [k, content[k] ?? '']))} />
  if (section === 'test') return <TestSection artistId={id} siteUrl={siteUrl} />
  if (section === 'logo') {
    const { data: mediaRows } = await supabase.from('media').select('purpose, storage_path').eq('artist_id', id).in('purpose', ['logo_primary', 'logo_secondary', 'profile_photo'])
    const LABEL: Record<string, string> = { logo_primary: 'Primary logo', logo_secondary: 'Secondary logo', profile_photo: 'Profile photo' }
    const ORDER = ['logo_primary', 'logo_secondary', 'profile_photo']
    const sources: OgSource[] = (mediaRows ?? [])
      .sort((a, b) => ORDER.indexOf(a.purpose as string) - ORDER.indexOf(b.purpose as string))
      .map((m) => ({ url: mediaUrl(m.storage_path as string), label: LABEL[m.purpose as string] ?? 'Image' }))
    const heroUrl = (facts?.hero_image_url as string | null) ?? null
    if (heroUrl) sources.push({ url: heroUrl, label: 'Hero image' })
    return <LogoSection artistId={id} sources={sources} currentUrl={content.og_image ?? ''} />
  }
  // alt
  const { data: gallery } = await supabase
    .from('media')
    .select('id, storage_path, alt, slug, site_role')
    .eq('artist_id', id)
    .eq('purpose', 'gallery_image')
    .eq('on_site', true)
    .order('sort_order')
  const photos: AltPhoto[] = (gallery ?? []).map((m) => {
    const path = m.storage_path as string
    const role = (m.site_role as string | null) ?? null
    return {
      id: m.id as string,
      url: mediaUrl(path),
      alt: (m.alt as string | null) ?? '',
      slug: (m.slug as string | null) ?? path.split('/').pop()!.replace(/\.[a-z0-9]+$/i, ''),
      // A slot photo's caption lives next to it in site_content (`polaroid_3_caption`).
      caption: role ? content[role.replace(/_photo$/, '_caption')] ?? null : null,
    }
  })
  return <AltSection artistId={id} artistName={artist.name} photos={photos} />
}
