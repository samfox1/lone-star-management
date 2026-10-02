'use server'

import { revalidatePath } from 'next/cache'
import { artistNameError } from '@/lib/manager-tools/profile/profile'
import { createClient } from '@/lib/supabase/server'

/**
 * PROFILE'S OWN SAVE: the artist's name (moved from Settings › General, 2026-10-02). The other
 * rows save through the dashboard's shared actions (saveArtistFactAction, saveSeoFieldAction,
 * saveEditorFieldAction), as they did on the SEO / GEO Facts tab.
 *
 * The name is a profile column (artists.name), so this writes the DRAFT the site reads once
 * published, like the bio and the city. It answers with `{ error }` rather than throwing, so the
 * row can say why.
 */
export async function saveArtistNameAction(artistId: string, name: string): Promise<{ error?: string }> {
  const bad = artistNameError(name)
  if (bad) return { error: bad }
  const supabase = await createClient()
  const { error } = await supabase.from('artists').update({ name: name.trim() }).eq('id', artistId).select('id').single()
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
