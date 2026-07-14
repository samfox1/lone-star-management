import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { releaseBucket, trackBucket, type MusicBucket } from '@/lib/music'
import { fieldCurrentValue, manifestFor } from '@/lib/site-editor/manifest'
import type { SiteContent } from '@/lib/site'
import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'
import type {
  EditorLink,
  EditorMerch,
  EditorSong,
  EditorTextField,
  EditorVideo,
} from './editor-inspector'

/** YouTube poster thumbnail from an embed URL (mirrors the Videos page helper). */
function youtubePoster(url: string, provider: string): string | null {
  if (provider !== 'youtube') return null
  const m = url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/**
 * Visual editor page — a dashboard section (centered "Edit site" nav tab). Renders
 * the editor shell (left inspector + the site frame) below the top nav.
 * `requireArtist` is the non-owner → 404 gate. The inspector reads the artist's real
 * data: `gallery_image` media (Images) and the manifest's text fields with their
 * current draft values (Text). Remaining component types + saves land next.
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const manifest = manifestFor(artist.template) ?? null

  const supabase = await createClient()
  const [{ data: profile }, { data: contentRows }, { data: mediaRows }] = await Promise.all([
    supabase.from('artists').select('bio, hero_image_url').eq('id', id).single(),
    supabase.from('site_content').select('key, value').eq('artist_id', id),
    supabase
      .from('media')
      .select('id, storage_path, on_site')
      .eq('artist_id', id)
      .eq('purpose', 'gallery_image')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const siteContent = Object.fromEntries(
    ((contentRows ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? '']),
  ) as SiteContent

  const ctx = {
    template: artist.template,
    siteContent,
    artist: {
      name: artist.name,
      bio: (profile?.bio as string | null) ?? null,
      hero_image_url: (profile?.hero_image_url as string | null) ?? null,
    },
  }

  const textFields: EditorTextField[] = manifest
    ? manifest.fields
        .filter((f) => f.type === 'text' || f.type === 'email')
        .map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type as 'text' | 'email',
          value: fieldCurrentValue(f, ctx),
          multiline: f.key === 'artist_bio' || f.key.endsWith('_copy'),
        }))
    : []

  const photos = (mediaRows ?? []).map((m) => ({
    id: m.id as string,
    storage_path: m.storage_path as string,
    onSite: (m.on_site as boolean | null) ?? false,
  }))

  const [linkRows, videoRows, merchRows, releaseRows, trackRows] = await Promise.all([
    listContent(supabase, 'link', id),
    listContent(supabase, 'video', id),
    listContent(supabase, 'merch', id),
    listContent(supabase, 'release', id),
    listContent(supabase, 'track', id),
  ])
  const links: EditorLink[] = linkRows.map((r) => ({
    id: r.id,
    label: (r.label as string | null) ?? '',
    url: (r.url as string | null) ?? '',
  }))
  const videos: EditorVideo[] = videoRows.map((r) => {
    const provider = String(r.provider ?? '')
    return {
      id: r.id,
      title: (r.title as string | null) ?? '',
      provider: provider || null,
      poster: youtubePoster(String(r.embed_url ?? ''), provider),
    }
  })
  const merch: EditorMerch[] = merchRows.map((r) => ({
    id: r.id,
    title: (r.title as string | null) ?? '',
    price: r.price == null ? '' : String(r.price),
    url: (r.url as string | null) ?? '',
    image_url: (r.image_url as string | null) ?? null,
  }))

  // Classify each release once; songs inherit the bucket through their release_id
  // (mirrors the Music page's derivation, lib/music.ts).
  const relBucket = new Map<string, MusicBucket>(
    releaseRows.map((r) => [
      r.id,
      releaseBucket({
        source: (r.source as string | null) ?? null,
        spotify_id: (r.spotify_id as string | null) ?? null,
        links: r.links,
        released: (r.released as boolean | null) ?? false,
      }),
    ]),
  )
  const songs: EditorSong[] = trackRows.map((r) => {
    const bucket = trackBucket(
      {
        release_id: (r.release_id as string | null) ?? null,
        source: (r.source as string | null) ?? null,
        audio_path: (r.audio_path as string | null) ?? null,
        spotify_id: (r.spotify_id as string | null) ?? null,
        apple_id: (r.apple_id as string | null) ?? null,
        deezer_id: (r.deezer_id as string | null) ?? null,
        provider_url: (r.provider_url as string | null) ?? null,
        stream_url: (r.stream_url as string | null) ?? null,
        apple_url: (r.apple_url as string | null) ?? null,
        soundcloud_url: (r.soundcloud_url as string | null) ?? null,
        released: (r.released as boolean | null) ?? false,
      },
      (rid) => relBucket.get(rid),
    )
    return {
      id: r.id,
      title: (r.title as string | null) ?? '',
      cover_url: (r.cover_url as string | null) ?? null,
      released: bucket === 'released',
      onSite: (r.on_site as boolean | null) ?? false,
    }
  })

  return (
    <EditorShell
      artistId={id}
      photos={photos}
      textFields={textFields}
      links={links}
      videos={videos}
      merch={merch}
      songs={songs}
    />
  )
}
