'use server'

/**
 * Brand server actions: the two logos, and the favicon derived from the primary one.
 *
 * Its own actions file rather than more surface on the dashboard's shared `actions.ts`,
 * for the same reason the press kit got one — a self-contained page with a small write
 * surface has no business in 1200 lines of generic content plumbing.
 *
 * The writes themselves live in `lib/brand.ts` (pure over an injected client, so they are
 * testable without the cookie context). These wrappers are auth + revalidation only.
 */
import { revalidatePath } from 'next/cache'
import { type BrandPurpose, saveFraming, setBrandAsset } from '@/lib/brand'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '../_owns'

const PURPOSES: readonly BrandPurpose[] = ['logo_primary', 'logo_secondary', 'favicon']

export async function setBrandAssetAction(
  artistId: string,
  purpose: string,
  storagePath: string | null,
): Promise<{ error?: string }> {
  // The purpose arrives from the client, so it is checked against the allowed set rather
  // than trusted — otherwise this action would be a general-purpose writer for ANY media
  // purpose, including ones with their own rules (gallery ordering, hero slots).
  if (!PURPOSES.includes(purpose as BrandPurpose)) return { error: 'Unknown brand asset.' }

  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }
  const res = await setBrandAsset(supabase, artistId, purpose as BrandPurpose, storagePath)
  if (!res.ok) return { error: res.error ?? 'Could not save that logo.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Store how the primary logo is framed into the tab icon. Clamped in `lib/brand.ts`
 *  and again by a CHECK constraint — this is config, not published content. */
export async function saveFramingAction(
  artistId: string,
  framing: { zoom: number; offsetY: number },
): Promise<{ error?: string }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }
  const res = await saveFraming(supabase, artistId, framing)
  if (!res.ok) return { error: res.error ?? 'Could not save the icon framing.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
