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
 * waits on the gate to be safe, only to render. A tab's own reads that need only the id start
 * in that same round too: pass the page's `client` here and to them (Details does).
 */
export async function loadSeoBase(id: string, client?: Supabase) {
  const supabase = client ?? (await createClient())
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

type Supabase = Awaited<ReturnType<typeof createClient>>
type Base = Awaited<ReturnType<typeof loadSeoBase>>
type MediaRow = Record<string, unknown>

const SHARE_LABEL: Record<string, string> = { logo_primary: 'Primary logo', logo_secondary: 'Secondary logo', profile_photo: 'Profile photo' }
const SHARE_ORDER = ['logo_primary', 'logo_secondary', 'profile_photo']

/** The logos and profile photo the share image can be made from. By id alone, so the Details
 *  page starts it beside loadSeoBase rather than after it; `shareSources` shapes it. */
export async function readShareMedia(supabase: Supabase, id: string): Promise<MediaRow[]> {
  const { data } = await supabase.from('media').select('purpose, storage_path').eq('artist_id', id).in('purpose', SHARE_ORDER)
  return data ?? []
}

/** The pictures the share image can be made from (Details → Share): the logos and profile photo
 *  in SHARE_ORDER, then the hero image (an artists column, so it comes with the base). */
export function shareSources(rows: MediaRow[], heroUrl: string | null): OgSource[] {
  const sources: OgSource[] = [...rows]
    .sort((x, y) => SHARE_ORDER.indexOf(x.purpose as string) - SHARE_ORDER.indexOf(y.purpose as string))
    .map((m) => ({ url: mediaUrl(m.storage_path as string), label: SHARE_LABEL[m.purpose as string] ?? 'Image' }))
  if (heroUrl) sources.push({ url: heroUrl, label: 'Hero image' })
  return sources
}

/** The site's photos, in site order. By id alone, like readShareMedia; `altPhotos` shapes it. */
export async function readAltMedia(supabase: Supabase, id: string): Promise<MediaRow[]> {
  const { data } = await supabase
    .from('media')
    .select('id, storage_path, alt, slug, site_role')
    .eq('artist_id', id)
    .eq('purpose', 'gallery_image')
    .eq('on_site', true)
    .order('sort_order')
  return data ?? []
}

/** The site's photos and their descriptions (Details → Alt text). A slot photo's caption comes
 *  from the base's site_content. */
export function altPhotos(rows: MediaRow[], content: Base['content']): AltPhoto[] {
  return rows.map((m) => {
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
