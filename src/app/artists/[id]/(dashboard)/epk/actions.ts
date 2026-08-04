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
import { readPressQuotesFromForm, savePressKit } from '@/lib/epk'
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
