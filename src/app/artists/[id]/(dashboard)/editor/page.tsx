import { manifestFor } from '@/lib/site-editor/manifest'
import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'

/**
 * Visual editor page — a dashboard section (centered "Edit site" nav tab). Renders
 * the editor shell (left toolbar + the site frame) below the top nav. `requireArtist`
 * is the non-owner → 404 gate; the manifest tells the shell which regions this
 * artist's template exposes.
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  return <EditorShell artistId={id} manifest={manifestFor(artist.template) ?? null} />
}
