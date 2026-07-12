import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { fieldCurrentValue, manifestFor } from '@/lib/site-editor/manifest'
import type { SiteContent } from '@/lib/site'
import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'
import type { EditorLink, EditorTextField } from './editor-inspector'

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
      .select('id, storage_path')
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
  }))

  const linkRows = await listContent(supabase, 'link', id)
  const links: EditorLink[] = linkRows.map((r) => ({
    id: r.id,
    label: (r.label as string | null) ?? '',
    url: (r.url as string | null) ?? '',
  }))

  return <EditorShell artistId={id} photos={photos} textFields={textFields} links={links} />
}
