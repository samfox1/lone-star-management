import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'

/**
 * Visual editor page — a dashboard section (centered "Edit site" nav tab). Renders
 * the editor shell (left inspector + the site frame) below the top nav.
 * `requireArtist` is the non-owner → 404 gate. The inspector's Images tools read the
 * artist's real `gallery_image` media; the remaining component tools + saves land next.
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireArtist(id)

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('media')
    .select('id, storage_path')
    .eq('artist_id', id)
    .eq('purpose', 'gallery_image')
    .order('created_at', { ascending: false })

  const photos = (rows ?? []).map((m) => ({
    id: m.id as string,
    storage_path: m.storage_path as string,
  }))

  return <EditorShell artistId={id} photos={photos} />
}
