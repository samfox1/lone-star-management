'use server'

/**
 * Press-kit server actions.
 *
 * Deliberately its OWN actions file rather than more surface on the dashboard's shared
 * `actions.ts`: the press kit is a self-contained page with one write, and that file is
 * already ~1200 lines of generic content plumbing this has nothing to do with.
 *
 * The write itself lives in `lib/epk.ts` (pure over an injected client, so it is testable
 * without the cookie context). This wrapper is auth + revalidation only.
 */
import { revalidatePath } from 'next/cache'
import { type PressDocumentKind, readPressQuotesFromForm, savePressKit, setPressDocument } from '@/lib/epk'
import { createClient } from '@/lib/supabase/server'

export async function savePressKitAction(
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const res = await savePressKit(supabase, artistId, {
    pitch: formData.get('press_pitch'),
    quotes: readPressQuotesFromForm(formData),
  })
  if (!res.ok) return { error: res.error ?? 'Could not save the press kit.' }
  // The EPK page reads the artist row; the layout carries the dirty/publish state.
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

const DOCUMENT_KINDS: readonly PressDocumentKind[] = ['tech_rider', 'stage_plot']

/**
 * Point a press document at an uploaded PDF, or clear it.
 *
 * `kind` comes from the client, so it is checked against the allowed set rather than
 * trusted — otherwise this would be a general-purpose writer for any artists column.
 * The PATH is validated in `setPressDocument` (owned by this tenant, and in the private
 * documents folder).
 */
export async function savePressDocumentAction(
  artistId: string,
  kind: string,
  storagePath: string | null,
): Promise<{ error?: string }> {
  if (!DOCUMENT_KINDS.includes(kind as PressDocumentKind)) return { error: 'Unknown document.' }

  const supabase = await createClient()
  // RLS blocks a non-owner's write, but a row-filtered UPDATE matches zero rows and
  // returns no error — so without this an authorization failure reads as success.
  const { data: owned } = await supabase.from('artists').select('id').eq('id', artistId).maybeSingle()
  if (!owned) return { error: 'Not found.' }

  const res = await setPressDocument(supabase, artistId, kind as PressDocumentKind, storagePath)
  if (!res.ok) return { error: res.error ?? 'Could not save that document.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
