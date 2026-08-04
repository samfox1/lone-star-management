/**
 * Brand: the artist's logos, and how the primary one becomes a favicon.
 *
 * Two logos, because one file cannot do both jobs:
 *   • PRIMARY   — the full lockup. The EPK header, the social card, anywhere with room.
 *   • SECONDARY — the icon or monogram, for dark backgrounds and small spaces.
 * Both are `media` rows (purposes `logo_primary` / `logo_secondary`), single-occupancy
 * exactly like `profile_photo`, so publishing, garbage collection and the public site
 * payload all come for free rather than being reinvented here.
 *
 * THE FAVICON IS DERIVED, NOT UPLOADED. It is generated from the PRIMARY logo, framed by
 * the manager. That matters because a favicon is a static file: there is no CSS at
 * display time, so a zoom or a nudge has to be baked into the pixels. The Brand page
 * draws the logo into a canvas with these numbers and saves exactly what it drew — and
 * because the preview and the export call the SAME `drawFavicon`, "what you see is
 * the file you get" is enforced by construction rather than by care.
 *
 * The framing numbers are CONFIG, not published content: the derived image publishes as
 * a media row, while zoom/offset exist only so reopening the page restores the controls.
 * Keeping them out of ARTIST_SNAPSHOT keeps them out of every public site payload.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwnedStoragePath } from '@/lib/upload'

/** The `media.purpose` values this module owns. `favicon` is DERIVED from the primary
 *  logo rather than uploaded, but it is stored the same way so it publishes, garbage
 *  collects and reaches the site through the same path as every other asset. */
export type BrandPurpose = 'logo_primary' | 'logo_secondary' | 'favicon'

/** The storage folder every brand object lives under: `{artistId}/brand/<uuid>.png`.
 *  Exported because THREE places must agree and only one of them fails loudly — the two
 *  upload call sites, and `MEDIA_FOLDERS` in storage-gc.ts. A folder missing from that
 *  list is invisible until objects go unswept forever. */
export const BRAND_FOLDER = 'brand'

/** The saved favicon's side, in pixels. Deliberately larger than the 32px browser tab:
 *  browsers downscale cleanly, and the same file covers the iPhone home-screen icon
 *  (180px) without a second asset or a second decision. */
export const FAVICON_SIZE = 180

/** What the manager judges the result at. A tab icon is tiny and unforgiving, so the
 *  preview shows TRUE size rather than a flattering enlargement. */
export const FAVICON_PREVIEW_SIZE = 32

/** 1 = the whole logo visible. Above that crops into it, which is the point for a wide
 *  wordmark: at 32px a full lockup is unreadable, so you zoom into the mark. The ceiling
 *  is where even a large source PNG stops surviving the upscale. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 6

/** How far the logo may be nudged, as a fraction of the canvas. ±1 is a full canvas in
 *  either direction — enough to bring any part of a tall lockup into frame, bounded so
 *  the logo can never be pushed entirely out of view and leave a blank tab icon. */
export const OFFSET_LIMIT = 1

export type FaviconFraming = {
  /** Multiplier on the contain-fit. 1 shows the whole logo. */
  zoom: number
  /** Vertical nudge as a fraction of the canvas: negative is up. */
  offsetY: number
}

/** Whole logo, centred. What an artist gets before touching anything. */
export const DEFAULT_FRAMING: FaviconFraming = { zoom: 1, offsetY: 0 }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Coerce a stored (or posted) framing into one we can draw with. Junk becomes the
 *  default rather than throwing: a bad row must never break the tab icon, and the icon
 *  has no error state to show. */
export function cleanFraming(raw: unknown): FaviconFraming {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_FRAMING
  const r = raw as Record<string, unknown>
  const zoom = typeof r.zoom === 'number' && Number.isFinite(r.zoom) ? clamp(r.zoom, ZOOM_MIN, ZOOM_MAX) : null
  const offsetY =
    typeof r.offsetY === 'number' && Number.isFinite(r.offsetY)
      ? clamp(r.offsetY, -OFFSET_LIMIT, OFFSET_LIMIT)
      : null
  if (zoom === null && offsetY === null) return DEFAULT_FRAMING
  return { zoom: zoom ?? DEFAULT_FRAMING.zoom, offsetY: offsetY ?? DEFAULT_FRAMING.offsetY }
}

/** Where to draw the logo on a `size`×`size` canvas. */
export type DrawBox = { x: number; y: number; width: number; height: number }

/**
 * The one piece of maths behind both the preview and the exported file.
 *
 * Base fit is CONTAIN — the whole logo, letterboxed — so the manager starts from the
 * complete mark and zooms IN to the part they want, rather than starting from a crop
 * someone else chose. Zoom then scales about the centre, so growing the logo never makes
 * it drift sideways, and the nudge is expressed as a FRACTION of the canvas so the same
 * framing lands in the same place at 32px and at 180px.
 */
export function faviconDrawBox(
  image: { width: number; height: number },
  framing: FaviconFraming,
  size: number,
): DrawBox {
  // A zero dimension would make the contain-fit infinite. A logo with no size has
  // nothing to draw, so report an empty box instead of poisoning the canvas with NaN.
  if (!(image.width > 0) || !(image.height > 0)) return { x: 0, y: 0, width: 0, height: 0 }

  const contain = Math.min(size / image.width, size / image.height)
  const scale = contain * framing.zoom
  const width = image.width * scale
  const height = image.height * scale
  return {
    x: (size - width) / 2,
    y: (size - height) / 2 + framing.offsetY * size,
    width,
    height,
  }
}

/**
 * Paint the framed logo onto a square canvas context.
 *
 * The PREVIEW and the EXPORT both call this, which is what makes "what you see at 32px
 * is the file that gets served" true by construction rather than by remembering to keep
 * two code paths in step.
 *
 * The clear is not incidental: a logo PNG is transparent, so its empty pixels paint
 * nothing over what is already there. Without clearing, dragging the zoom slider leaves
 * every previous frame stacked underneath.
 */
export function drawFavicon(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  framing: FaviconFraming,
  size: number,
): void {
  ctx.clearRect(0, 0, size, size)
  const box = faviconDrawBox(image, framing, size)
  if (box.width <= 0 || box.height <= 0) return
  ctx.drawImage(image, box.x, box.y, box.width, box.height)
}

/**
 * Put one brand asset in its slot, or clear it with `storagePath: null`.
 *
 * Single occupancy by vacate-then-insert, the same shape `setImageField` uses for
 * `profile_photo`: a clear is just the delete, and a replace cannot leave two rows
 * claiming one slot even if the insert fails. Pure over an injected client — RLS scopes
 * the write to the caller's tenant — so it is testable without the action's cookie
 * context.
 *
 * The replaced object is not deleted here. It drops out of `referenced` and the next
 * publish's storage GC sweeps it, which is how every other media replacement behaves —
 * but ONLY because `brand` is listed in MEDIA_FOLDERS (storage-gc.ts). Adding a media
 * purpose without adding its folder there strands every replaced object in a public
 * bucket forever; that has already happened once in this codebase.
 */
export async function setBrandAsset(
  supabase: SupabaseClient,
  artistId: string,
  purpose: BrandPurpose,
  storagePath: string | null,
): Promise<{ ok: boolean; error?: string }> {
  // The path comes from the client (the browser uploads direct-to-Storage, then asks us
  // to record where). Storage RLS pins the UPLOAD to this tenant's folder and row RLS
  // pins the ROW, but nothing tied the two together — so without this a manager could
  // record a row pointing anywhere at all.
  if (storagePath !== null && !isOwnedStoragePath(artistId, storagePath))
    return { ok: false, error: 'That file location is not valid.' }

  const del = await supabase.from('media').delete().eq('artist_id', artistId).eq('purpose', purpose)
  if (del.error) return { ok: false, error: del.error.message }
  if (!storagePath) return { ok: true }
  const { error } = await supabase.from('media').insert({
    artist_id: artistId,
    purpose,
    storage_path: storagePath,
    on_site: true,
    sort_order: Math.floor(Date.now() / 1000),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Read the stored favicon framing. Missing or junk values become the default rather
 *  than an error: the tab icon has no way to report a problem, so it must always have
 *  something drawable. */
export async function loadFraming(supabase: SupabaseClient, artistId: string): Promise<FaviconFraming> {
  const { data } = await supabase
    .from('artists')
    .select('favicon_zoom, favicon_offset_y')
    .eq('id', artistId)
    .single()
  if (!data) return DEFAULT_FRAMING
  const row = data as { favicon_zoom: number | null; favicon_offset_y: number | null }
  return cleanFraming({ zoom: row.favicon_zoom ?? undefined, offsetY: row.favicon_offset_y ?? undefined })
}

/** Store the framing, clamped. Config, not published content — deliberately NOT in
 *  ARTIST_SNAPSHOT, so it never joins a public site payload where nothing can use it. */
export async function saveFraming(
  supabase: SupabaseClient,
  artistId: string,
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const framing = cleanFraming(raw)
  const { error } = await supabase
    .from('artists')
    .update({ favicon_zoom: framing.zoom, favicon_offset_y: framing.offsetY })
    .eq('id', artistId)
  return error ? { ok: false, error: error.message } : { ok: true }
}
