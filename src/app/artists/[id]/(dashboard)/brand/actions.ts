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
import { type FontRole, removeArtistFont, setArtistFont, setFontRole } from '@/lib/fonts'
import { gcFontObjects } from '@/lib/storage-gc'
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

/* ── Custom fonts (lib/fonts.ts) ──────────────────────────────────────────── */

/**
 * Record a font the browser has just uploaded to the `fonts` bucket.
 *
 * `callerOwns` first, before anything else, for the reason `_owns.ts` documents: RLS
 * ROW-FILTERS a blocked write rather than failing it, so without this a non-manager's
 * call returns `{}` and reads as success in the UI.
 */
export async function addArtistFontAction(
  artistId: string,
  input: { label: string; storagePath: string; format: string },
): Promise<{ error?: string }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }
  const res = await setArtistFont(supabase, artistId, input)
  if (!res.ok) return { error: res.error ?? 'Could not save that font.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Remove a font, then sweep the bucket. The sweep keeps anything a PUBLISHED revision
 *  still names, so removing a font that is live on the site does not pull the file out
 *  from under it before the removal is published. */
export async function removeArtistFontAction(artistId: string, fontId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }
  const res = await removeArtistFont(supabase, artistId, fontId)
  if (!res.ok) return { error: res.error ?? 'Could not remove that font.' }
  // Best-effort and deliberately after the row is gone: an uncollected object costs
  // storage, a failed sweep must not cost the manager their delete.
  await gcFontObjects(supabase, artistId)
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Assign or clear a site-wide role. `role` arrives from the client, so it is checked
 *  against the allowed set in `setFontRole` rather than trusted into an UPDATE. */
export async function setFontRoleAction(
  artistId: string,
  fontId: string,
  role: FontRole | null,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }
  const res = await setFontRole(supabase, artistId, fontId, role)
  if (!res.ok) return { error: res.error ?? 'Could not change that font.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
