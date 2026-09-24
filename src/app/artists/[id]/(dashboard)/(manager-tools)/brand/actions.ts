'use server'

/**
 * Brand server actions: logos, icons, the browser-bar colour, the palette and the fonts.
 *
 * Its own actions file rather than more surface on the dashboard's shared `actions.ts`,
 * for the same reason the press kit got one — a self-contained page with a small write
 * surface has no business in 1200 lines of generic content plumbing.
 *
 * The writes themselves live in `lib/brand.ts`, `lib/brand-colors.ts` and `lib/fonts.ts`
 * (pure over an injected client, so they are testable without the cookie context). Every
 * wrapper here is the same three steps: `callerOwns` FIRST (RLS row-filters a blocked
 * write into a silent success, see `_owns.ts`), then the lib call, then revalidate. A
 * refusal is `{ error }` with a sentence a manager can act on.
 */
import { revalidatePath } from 'next/cache'
import {
  BRAND_ASSET_PURPOSES,
  type BrandLogo,
  type BrandPurpose,
  type IconTarget,
  addIconSource,
  addLogo,
  deleteLogo,
  isIconTarget,
  renameLogo,
  restoreBrandToPublished,
  saveFraming,
  setBrandAsset,
  setIconSource,
  setLogoFile,
  setLogoNote,
  setThemeColor,
} from '@/lib/brand'
import {
  type BrandColor,
  type ColorSlot,
  addBrandColor,
  deleteBrandColor,
  isColorSlot,
  renameBrandColor,
  setBrandColorHex,
  setBrandColorNote,
  setSlotColor,
} from '@/lib/manager-tools/brand/brand-colors'
import {
  type FontSlot,
  type FontSlotMeta,
  clearCustomSlot,
  removeArtistFont,
  renameArtistFont,
  setArtistFont,
  setFontSlot,
  setFontSlotMeta,
} from '@/lib/fonts'
import { gcDeletedMediaObject, gcFontObjects } from '@/lib/storage-gc'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '../../_owns'

type Done = { error?: string }

/** Auth + ownership, then the write, then revalidate — the one shape every action has. */
async function owned<T extends { ok: boolean; error?: string }>(
  artistId: string,
  write: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<T>,
  fallback: string,
): Promise<{ error?: string; result?: T; supabase: Awaited<ReturnType<typeof createClient>> }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.', supabase }
  const result = await write(supabase)
  if (!result.ok) return { error: result.error ?? fallback, supabase }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { result, supabase }
}

export async function setBrandAssetAction(
  artistId: string,
  purpose: string,
  storagePath: string | null,
): Promise<Done> {
  // The purpose arrives from the client, so it is checked against the allowed set rather
  // than trusted — otherwise this action would be a general-purpose writer for ANY media
  // purpose, including ones with their own rules (gallery ordering, hero slots). The
  // write underneath vacates BY PURPOSE, so `logo` and `icon_source` (many rows each) are
  // refused too: accepting them would delete every added logo in one call.
  if (!BRAND_ASSET_PURPOSES.includes(purpose as BrandPurpose)) return { error: 'Unknown brand asset.' }
  const { error } = await owned(
    artistId,
    (s) => setBrandAsset(s, artistId, purpose as BrandPurpose, storagePath),
    'Could not save that logo.',
  )
  return error ? { error } : {}
}

/** Store how an icon is framed (the tab icon unless `target` says otherwise). Clamped in
 *  `lib/brand.ts` and again by a CHECK constraint — this is config, not published content. */
export async function saveFramingAction(
  artistId: string,
  framing: { zoom: number; offsetY: number },
  target: IconTarget = 'favicon',
): Promise<Done> {
  if (!isIconTarget(target)) return { error: 'Unknown icon.' }
  const { error } = await owned(artistId, (s) => saveFraming(s, artistId, framing, target), 'Could not save the icon framing.')
  return error ? { error } : {}
}

/* ── Logos ───────────────────────────────────────────────────────────────── */

/** Save an added logo: title, note and file in one write (performUpload's `writeRow` —
 *  an error means nothing was written, so the caller deletes the uploaded object). */
export async function addLogoAction(
  artistId: string,
  input: { title: string; note?: string | null; storagePath: string },
): Promise<{ error?: string; logo?: BrandLogo }> {
  const { error, result } = await owned(artistId, (s) => addLogo(s, artistId, input), 'Could not save that logo.')
  return error ? { error } : { logo: result?.logo }
}

export async function renameLogoAction(artistId: string, mediaId: string, title: string): Promise<Done> {
  const { error } = await owned(artistId, (s) => renameLogo(s, artistId, mediaId, title), 'Could not rename that logo.')
  return error ? { error } : {}
}

export async function setLogoNoteAction(artistId: string, mediaId: string, note: string | null): Promise<Done> {
  const { error } = await owned(artistId, (s) => setLogoNote(s, artistId, mediaId, note), 'Could not save that note.')
  return error ? { error } : {}
}

/** Delete an added logo, then its files — unless it was ever published, when the next
 *  publish's sweep takes them (the live site may still be serving one). */
export async function deleteLogoAction(artistId: string, mediaId: string): Promise<Done> {
  const { error, result, supabase } = await owned(artistId, (s) => deleteLogo(s, artistId, mediaId), 'Could not remove that logo.')
  if (error) return { error }
  await gcDeletedMediaObject(supabase, mediaId, result?.storagePath ?? null, result?.sourcePath ?? null)
  return {}
}

/** "Upload new" on a logo row that keeps its id, title and note (an added logo, or a
 *  built-in edited in place). The new file is its own original. */
export async function replaceLogoFileAction(artistId: string, mediaId: string, storagePath: string): Promise<Done> {
  const { error } = await owned(
    artistId,
    (s) => setLogoFile(s, artistId, mediaId, storagePath, { keepOriginal: false }),
    'Could not save that logo.',
  )
  return error ? { error } : {}
}

/** "Remove background": the cut-out becomes the logo's file and the file it replaces is
 *  kept as `source_path` (the first original, if it is already a cut-out). */
export async function cutOutLogoAction(artistId: string, mediaId: string, storagePath: string): Promise<Done> {
  const { error } = await owned(
    artistId,
    (s) => setLogoFile(s, artistId, mediaId, storagePath, { keepOriginal: true }),
    'Could not save the cut-out.',
  )
  return error ? { error } : {}
}

/* ── Icons + browser bar ─────────────────────────────────────────────────── */

/** Frame an icon from one of this artist's logos or icon images; `null` = the primary logo. */
export async function setIconSourceAction(artistId: string, target: IconTarget, mediaId: string | null): Promise<Done> {
  if (!isIconTarget(target)) return { error: 'Unknown icon.' }
  const { error } = await owned(artistId, (s) => setIconSource(s, artistId, target, mediaId), 'Could not change the icon.')
  return error ? { error } : {}
}

/** An image uploaded just for one icon, made that icon's source (performUpload's `writeRow`). */
export async function addIconSourceAction(
  artistId: string,
  target: IconTarget,
  storagePath: string,
): Promise<{ error?: string; mediaId?: string }> {
  if (!isIconTarget(target)) return { error: 'Unknown icon.' }
  const { error, result } = await owned(
    artistId,
    (s) => addIconSource(s, artistId, target, storagePath),
    'Could not save that image.',
  )
  return error ? { error } : { mediaId: result?.mediaId }
}

export async function setThemeColorAction(artistId: string, hex: string | null): Promise<Done> {
  const { error } = await owned(artistId, (s) => setThemeColor(s, artistId, hex), 'Could not save that color.')
  return error ? { error } : {}
}

/* ── Colors ──────────────────────────────────────────────────────────────── */

export async function addBrandColorAction(
  artistId: string,
  input: { name: string; hex: string; note?: string | null },
): Promise<{ error?: string; color?: BrandColor }> {
  const { error, result } = await owned(artistId, (s) => addBrandColor(s, artistId, input), 'Could not add that color.')
  return error ? { error } : { color: result?.color }
}

export async function renameBrandColorAction(artistId: string, colorId: string, name: string): Promise<Done> {
  const { error } = await owned(artistId, (s) => renameBrandColor(s, artistId, colorId, name), 'Could not rename that color.')
  return error ? { error } : {}
}

export async function setBrandColorHexAction(artistId: string, colorId: string, hex: string): Promise<Done> {
  const { error } = await owned(artistId, (s) => setBrandColorHex(s, artistId, colorId, hex), 'Could not change that color.')
  return error ? { error } : {}
}

export async function setBrandColorNoteAction(artistId: string, colorId: string, note: string | null): Promise<Done> {
  const { error } = await owned(artistId, (s) => setBrandColorNote(s, artistId, colorId, note), 'Could not save that note.')
  return error ? { error } : {}
}

export async function deleteBrandColorAction(artistId: string, colorId: string): Promise<Done> {
  const { error } = await owned(artistId, (s) => deleteBrandColor(s, artistId, colorId), 'Could not remove that color.')
  return error ? { error } : {}
}

/** Primary or Secondary gets its colour: the first pick makes the row, later ones change
 *  it (one upsert). The slot arrives from the client, so it is checked, not trusted. */
export async function setBrandColorSlotAction(
  artistId: string,
  slot: ColorSlot,
  hex: string,
): Promise<{ error?: string; color?: BrandColor }> {
  if (!isColorSlot(slot)) return { error: 'Unknown color.' }
  const { error, result } = await owned(artistId, (s) => setSlotColor(s, artistId, slot, hex), 'Could not save that color.')
  return error ? { error } : { color: result?.color }
}

/* ── Custom fonts (lib/fonts.ts) ──────────────────────────────────────────── */

/** Add a font; with `slot`, it fills that slot too (Sam, 2026-09-13: a font is uploaded
 *  FROM a slot's picker, so the upload is the choice), and `meta` is that added row's
 *  title and note, saved with it.
 *
 *  This runs as `performUpload`'s `writeRow`, whose contract is "an error means the row
 *  was NOT written, so delete the object". Once the row is in, the answer can never be
 *  an error — the file would be deleted from under a row that still names it, and the
 *  picker would offer a font that 404s on the site. A slot that will not take it is a
 *  `warning`: the font stays, the manager can still pick it, and the caller says so. */
export async function addArtistFontAction(
  artistId: string,
  input: { label: string; storagePath: string; format: string; weight?: number | null },
  slot?: FontSlot,
  meta?: FontSlotMeta,
): Promise<{ error?: string; warning?: string }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }
  const res = await setArtistFont(supabase, artistId, input)
  if (!res.ok) return { error: res.error ?? 'Could not save that font.' }
  if (slot && res.font) {
    const placed = await setFontSlot(supabase, artistId, slot, res.font.id, meta)
    if (!placed.ok) {
      revalidatePath(`/artists/${artistId}`, 'layout')
      return { warning: placed.error ?? 'The font was added but could not be placed.' }
    }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Remove a font, then sweep the bucket. The sweep keeps anything a PUBLISHED revision
 *  still names, so removing a font that is live on the site does not pull the file out
 *  from under it before the removal is published. */
export async function removeArtistFontAction(artistId: string, fontId: string): Promise<Done> {
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

/** Rename an uploaded font — its label, never its family token. The label is published
 *  (the artist_font snapshot), so this raises the Publish bar. */
export async function renameArtistFontAction(artistId: string, fontId: string, label: string): Promise<Done> {
  const { error } = await owned(artistId, (s) => renameArtistFont(s, artistId, fontId, label), 'Could not rename that font.')
  return error ? { error } : {}
}

/**
 * Point a site-wide slot at a font, or empty it with `fontId: null`. `meta` (added slots
 * only) is the row's title and note, written in the same statement.
 *
 * SLOT-keyed, not font-keyed: the same font may fill several slots, so "which font is in
 * this slot" is the only question with one answer. `slot` arrives from the client and is
 * checked against FONT_SLOTS inside `setFontSlot` rather than trusted into a write.
 */
export async function setFontSlotAction(
  artistId: string,
  slot: FontSlot,
  fontId: string | null,
  meta?: FontSlotMeta,
): Promise<Done> {
  const { error } = await owned(artistId, (s) => setFontSlot(s, artistId, slot, fontId, meta), 'Could not change that font.')
  return error ? { error } : {}
}

/** Rename an added font row or change its note. */
export async function setFontSlotMetaAction(artistId: string, slot: FontSlot, meta: FontSlotMeta): Promise<Done> {
  const { error } = await owned(artistId, (s) => setFontSlotMeta(s, artistId, slot, meta), 'Could not save that.')
  return error ? { error } : {}
}

/** Delete an added font row. The font stays in the artist's library. */
export async function clearCustomFontSlotAction(artistId: string, slot: FontSlot): Promise<Done> {
  const { error } = await owned(artistId, (s) => clearCustomSlot(s, artistId, slot), 'Could not remove that font.')
  return error ? { error } : {}
}

/* ── Revert ──────────────────────────────────────────────────────────────── */

/**
 * The Publish bar's Revert: the Brand page's logos, icons and fonts back to what the site
 * shows (`restoreBrandToPublished`). Dashboard-only settings — colours, notes, slot titles,
 * framing, the browser-bar colour — are not published this round, so there is no published
 * version of them to go back to and they are kept. The one exception is an icon's source,
 * which follows the icon image the revert puts back or removes (see `settleIconSources`).
 */
export async function revertBrandAction(artistId: string): Promise<{ error?: string; changed?: number }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }
  try {
    const { changed, hasPublished, skipped } = await restoreBrandToPublished(supabase, artistId)
    if (!hasPublished) return { error: 'Nothing is on the site yet, so there is nothing to go back to.' }
    revalidatePath(`/artists/${artistId}`, 'layout')
    // A type that was never published is skipped rather than wiped (see the lib). If that
    // left nothing to do, say so: a Revert that silently does nothing reads as broken.
    if (changed === 0 && skipped.length > 0)
      return { error: 'These changes have never been on the site, so there is nothing to go back to.' }
    return { changed }
  } catch (e) {
    revalidatePath(`/artists/${artistId}`, 'layout')
    return { error: e instanceof Error ? e.message : 'Could not undo those changes.' }
  }
}
