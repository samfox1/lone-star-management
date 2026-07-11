import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'

/**
 * Visual editor page — a dashboard section (centered "Edit site" nav tab). Renders
 * the editor shell (left inspector + the site frame) below the top nav.
 * `requireArtist` is the non-owner → 404 gate. The inspector's tools currently run
 * against placeholder data; the real component/collection data + saves are wired next.
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireArtist(id)
  return <EditorShell artistId={id} />
}
