import { createClient } from '@/lib/supabase/server'
import { FAQ_EXTRA, FAQ_KEYS, SEO_FIELDS } from '@/lib/site-content-schema'
import { mediaUrl } from '@/lib/storage-url'
import { publicSiteOrigin } from '@/lib/custom-site'
import { listContent } from '@/lib/content'
import { autoFaqAnswer } from '@samfox1/site-bridge/seo'
import type { SiteRelease, SiteTourDate } from '@samfox1/site-bridge/payload'
import { requireArtist } from '../../../_data'
import type { OgSource } from './og-image-picker'
import type { AltPhoto } from './details/details-tab'

/**
 * What the Details, Answers and Profiles tabs read, moved here from the old seven-section
 * `[section]/page.tsx` (2026-09-29) so each tab's page asks only for what it shows. Every query
 * is RLS-scoped and flies in ONE round beside the ownership gate (`requireArtist`): nothing
 * waits on the gate to be safe, only to render.
 */
export async function loadSeoBase(id: string) {
  const supabase = await createClient()
  const [artist, { data: rows }, { data: facts }] = await Promise.all([
    requireArtist(id),
    supabase.from('site_content').select('key, value').eq('artist_id', id),
    supabase.from('artists').select('bio, genre, location, schema_type, hero_image_url').eq('id', id).single(),
  ])
  const content = Object.fromEntries((rows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']))
  const seo = Object.fromEntries(SEO_FIELDS.map((f) => [f.key, content[f.key] ?? '']))
  const schemaType = ((facts?.schema_type as string | null) ?? 'MusicGroup') as 'MusicGroup' | 'Person'
  return {
    supabase,
    artist,
    content,
    seo,
    bio: ((facts?.bio as string | null) ?? '').trim(),
    genre: (facts?.genre as string | null) ?? null,
    location: (facts?.location as string | null) ?? null,
    heroUrl: (facts?.hero_image_url as string | null) ?? null,
    schemaType,
    siteUrl: publicSiteOrigin(artist),
  }
}

type Base = Awaited<ReturnType<typeof loadSeoBase>>

const SHARE_LABEL: Record<string, string> = { logo_primary: 'Primary logo', logo_secondary: 'Secondary logo', profile_photo: 'Profile photo' }
const SHARE_ORDER = ['logo_primary', 'logo_secondary', 'profile_photo']

/** The pictures the share image can be made from (Listing → Share). */
export async function loadShareSources(b: Base): Promise<OgSource[]> {
  const { data } = await b.supabase.from('media').select('purpose, storage_path').eq('artist_id', b.artist.id).in('purpose', SHARE_ORDER)
  const sources: OgSource[] = (data ?? [])
    .sort((x, y) => SHARE_ORDER.indexOf(x.purpose as string) - SHARE_ORDER.indexOf(y.purpose as string))
    .map((m) => ({ url: mediaUrl(m.storage_path as string), label: SHARE_LABEL[m.purpose as string] ?? 'Image' }))
  if (b.heroUrl) sources.push({ url: b.heroUrl, label: 'Hero image' })
  return sources
}

/** The site's photos and their descriptions (Listing → Alt text). */
export async function loadAltPhotos(b: Base): Promise<AltPhoto[]> {
  const { data } = await b.supabase
    .from('media')
    .select('id, storage_path, alt, slug, site_role')
    .eq('artist_id', b.artist.id)
    .eq('purpose', 'gallery_image')
    .eq('on_site', true)
    .order('sort_order')
  return (data ?? []).map((m) => {
    const path = m.storage_path as string
    const role = (m.site_role as string | null) ?? null
    return {
      id: m.id as string,
      url: mediaUrl(path),
      alt: (m.alt as string | null) ?? '',
      slug: (m.slug as string | null) ?? path.split('/').pop()!.replace(/\.[a-z0-9]+$/i, ''),
      // A slot photo's caption lives next to it in site_content (`polaroid_3_caption`).
      caption: role ? b.content[role.replace(/_photo$/, '_caption')] ?? null : null,
    }
  })
}

/**
 * The Answers tab: the automatic answers, from the DRAFT data the manager sees (what they
 * publish is what the site answers with), and the written ones.
 */
export async function loadAnswers(b: Base) {
  const [tours, releases] = await Promise.all([listContent(b.supabase, 'tour_date', b.artist.id), listContent(b.supabase, 'release', b.artist.id)])
  const src = {
    artist: { ...b.artist, bio: b.bio, genre: b.genre, location: b.location, schema_type: b.schemaType },
    site_content: b.content,
    tour_dates: tours as unknown as SiteTourDate[],
    releases: releases as unknown as SiteRelease[],
    origin: b.siteUrl ?? undefined,
    today: new Date().toISOString().slice(0, 10),
  }
  const auto = [1, 2, 3, 4, 5].map((n) => autoFaqAnswer(n, src))
  const initial = Object.fromEntries([...FAQ_KEYS, ...FAQ_EXTRA.flatMap((e) => [e.q, e.a])].map((k) => [k, b.content[k] ?? '']))
  return { auto, initial }
}
