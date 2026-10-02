import { FACT_CONTENT_KEYS } from '@samfox1/site-bridge/seo'
import { listContent } from '@/lib/content'
import { mediaThumbUrl, mediaUrl } from '@/lib/storage-url'
import { photoTypeOf, type BioPackInput, type BioPackRelease } from '@/lib/manager-tools/seo/profiles/bio-pack'
import type { loadSeoBase } from '../load'

type Base = Awaited<ReturnType<typeof loadSeoBase>>

/** A photo the manager can send: the full file, a small preview, its type. */
export type PackPhoto = { url: string; thumb: string; type: string | null; name: string }

/** At most this many photos to choose from. */
const MAX_PHOTOS = 12

/**
 * What the Apple Music & Amazon bio email is built from (lib/manager-tools/seo/profiles/bio-pack.ts).
 * Everything but the releases is the DRAFT the manager sees on the other SEO tabs (loadSeoBase):
 * the bio, genre, city, the Facts tab's region and country, the links. The releases are the
 * PUBLISHED ones (`get_public_releases`), so nothing still being drafted goes out to Xperi.
 *
 * Every read is RLS-scoped and runs after loadSeoBase's ownership gate.
 */
export async function loadBioPack(b: Base): Promise<{ input: Omit<BioPackInput, 'photo'>; photos: PackPhoto[] }> {
  const id = b.artist.id as string
  const [links, releases, media, user] = await Promise.all([
    listContent(b.supabase, 'link', id),
    b.supabase.rpc('get_public_releases', { p_slug: b.artist.slug }),
    b.supabase
      .from('media')
      .select('purpose, storage_path, kind, on_site, sort_order')
      .eq('artist_id', id)
      .in('purpose', ['profile_photo', 'gallery_image'])
      .order('sort_order'),
    b.supabase.auth.getUser(),
  ])

  // A profile photo first, then the site's own photos, then the rest of the library. Artwork
  // (a cover) and pieces marked "none" are not press photos; only files a mail app can attach.
  const rank = (m: { purpose: string; on_site: boolean | null }) => (m.purpose === 'profile_photo' ? 0 : m.on_site ? 1 : 2)
  const photos: PackPhoto[] = ((media.data ?? []) as { purpose: string; storage_path: string; kind: string | null; on_site: boolean | null }[])
    .filter((m) => m.kind !== 'artwork' && m.kind !== 'none' && photoTypeOf(m.storage_path))
    .sort((x, y) => rank(x) - rank(y))
    .map((m) => ({ url: mediaUrl(m.storage_path), thumb: mediaThumbUrl(m.storage_path, { size: 160 }), type: photoTypeOf(m.storage_path), name: m.storage_path.split('/').pop() ?? 'photo' }))
  if (b.heroUrl && photoTypeOf(b.heroUrl) && b.heroUrl.startsWith('https://')) photos.push({ url: b.heroUrl, thumb: b.heroUrl, type: photoTypeOf(b.heroUrl), name: 'hero' })

  const meta = (user.data.user?.user_metadata ?? {}) as Record<string, unknown>
  const managerName = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && !!v.trim()) ?? null

  return {
    input: {
      artist: {
        name: b.artist.name as string,
        bio: b.bio,
        genre: b.genre,
        location: b.location,
        spotify_artist_id: (b.artist.spotify_artist_id as string | null) ?? null,
        schema_type: b.schemaType,
      },
      // Only the two place facts: the rest of the site's text never goes to the browser here.
      site_content: { [FACT_CONTENT_KEYS.region]: b.content[FACT_CONTENT_KEYS.region] ?? '', [FACT_CONTENT_KEYS.country]: b.content[FACT_CONTENT_KEYS.country] ?? '' },
      site_url: b.siteUrl,
      links: links.map((l) => ({ label: (l.label as string | null) ?? null, url: (l.url as string | null) ?? null, role: (l.role as string | null) ?? null })),
      // Only what the email and the Released rule read (releaseIsReleased: source, spotify_id,
      // links, the manual flag).
      releases: ((releases.data as BioPackRelease[] | null) ?? []).map((r) => ({
        title: r.title,
        release_date: r.release_date ?? null,
        release_type: r.release_type ?? null,
        released: r.released ?? null,
        source: r.source ?? null,
        spotify_id: r.spotify_id ?? null,
        links: r.links ?? null,
      })),
      manager_name: managerName,
    },
    photos: photos.slice(0, MAX_PHOTOS),
  }
}
