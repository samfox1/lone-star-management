import { createClient } from '@/lib/supabase/server'
import { fieldCurrentValue, manifestFor } from '@/lib/site-editor/manifest'
import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'

/**
 * Visual editor page — a dashboard section (centered "Edit site" nav tab). Renders
 * the editor shell (left toolbar + the site frame) below the top nav. `requireArtist`
 * is the non-owner → 404 gate; the manifest tells the shell which regions this
 * artist's template exposes, and `fieldValues` seeds the inspector controls with
 * each field's current draft value.
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const manifest = manifestFor(artist.template) ?? null

  const supabase = await createClient()
  const [{ data: profile }, { data: contentRows }] = await Promise.all([
    supabase.from('artists').select('bio, hero_image_url').eq('id', id).single(),
    supabase.from('site_content').select('key, value').eq('artist_id', id),
  ])
  const siteContent = Object.fromEntries(
    ((contentRows ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? '']),
  )

  const fieldValues: Record<string, string> = {}
  if (manifest) {
    const ctx = {
      template: artist.template,
      siteContent,
      artist: {
        name: artist.name,
        bio: (profile?.bio as string | null) ?? null,
        hero_image_url: (profile?.hero_image_url as string | null) ?? null,
      },
    }
    for (const f of manifest.fields) fieldValues[f.key] = fieldCurrentValue(f, ctx)
  }

  return <EditorShell artistId={id} manifest={manifest} fieldValues={fieldValues} />
}
