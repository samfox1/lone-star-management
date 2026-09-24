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
import { canonicalHex } from '@/lib/color'
import {
  diffEntities,
  listContent,
  publishContent,
  PUBLISHABLE,
  SNAPSHOT_DEFAULTS,
  type ContentRow,
  type EntityChange,
} from '@/lib/content'

/** The SINGLE-OCCUPANCY brand purposes: one row each, replaced by vacate-then-insert
 *  (`setBrandAsset`). `favicon` and `home_icon` are DERIVED from a logo rather than
 *  uploaded, but stored the same way so they publish, garbage collect and reach the site
 *  through the same path as every other asset. `logo` and `icon_source` are NOT here:
 *  there can be many of each, and a vacate by purpose would delete all of them. */
export type BrandPurpose = 'logo_primary' | 'logo_secondary' | 'favicon' | 'home_icon'
export const BRAND_ASSET_PURPOSES: readonly BrandPurpose[] = ['logo_primary', 'logo_secondary', 'favicon', 'home_icon']

/** EVERY media purpose the Brand page owns (20260924120000). The brand-scoped Publish bar
 *  and the brand revert both derive from this list, so a purpose added here is counted and
 *  reverted in the same edit — and a gallery photo never is. */
export const BRAND_MEDIA_PURPOSES = [
  'logo_primary',
  'logo_secondary',
  'logo',
  'favicon',
  'home_icon',
  'icon_source',
] as const
export type BrandMediaPurpose = (typeof BRAND_MEDIA_PURPOSES)[number]
export const isBrandMediaPurpose = (p: unknown): p is BrandMediaPurpose =>
  (BRAND_MEDIA_PURPOSES as readonly unknown[]).includes(p)

/** The logo rows: the two built-ins and the added ones. */
export const LOGO_PURPOSES = ['logo_primary', 'logo_secondary', 'logo'] as const
export type LogoPurpose = (typeof LOGO_PURPOSES)[number]

/** What an icon may be framed from: any logo, or an image uploaded just for it. Never a
 *  derived PNG (`favicon`, `home_icon`) — framing a framed icon compounds the crop. */
export const ICON_SOURCE_PURPOSES = [...LOGO_PURPOSES, 'icon_source'] as const

/** The two generated icons. Each has its own source and its own framing. */
export const ICON_TARGETS = ['favicon', 'home_icon'] as const
export type IconTarget = (typeof ICON_TARGETS)[number]
export const isIconTarget = (t: unknown): t is IconTarget => (ICON_TARGETS as readonly unknown[]).includes(t)

/** Where each icon's settings live on `artists`. Config, never published. */
const ICON_COLUMNS: Record<IconTarget, { source: string; zoom: string; offsetY: string }> = {
  favicon: { source: 'favicon_source_media_id', zoom: 'favicon_zoom', offsetY: 'favicon_offset_y' },
  home_icon: { source: 'home_icon_source_media_id', zoom: 'home_icon_zoom', offsetY: 'home_icon_offset_y' },
}

/** A title (added logo, colour, custom font slot) and a note: the database's own limits
 *  (20260924120000), stated once so the sentences below quote the same numbers. */
export const TITLE_MAX = 40
export const NOTE_MAX = 500

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

/** Two framings the sliders cannot tell apart (their step is 0.01), after cleaning. A
 *  framing moved back to where it was saved is not a change: re-saving it would upload a
 *  new PNG and swap the icon's row — a Publish bar for nothing. */
export function sameFraming(a: FaviconFraming, b: FaviconFraming): boolean {
  const x = cleanFraming(a)
  const y = cleanFraming(b)
  return Math.abs(x.zoom - y.zoom) < 0.005 && Math.abs(x.offsetY - y.offsetY) < 0.005
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
 * The replaced row's file goes at once when that row was NEVER published (`sweepReplaced`,
 * the delete-time rule of storage-gc.ts): the tab icon regenerates on every framing save,
 * and the Brand publish runs no sweep, so leaving them for "the next publish's GC" piled a
 * PNG per slider drag into a public bucket. A row that WAS published keeps its file — the
 * live site may be serving it — until the whole-media publish's sweep, which works only
 * because `brand` is listed in MEDIA_FOLDERS (storage-gc.ts).
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

  const del = await supabase
    .from('media')
    .delete()
    .eq('artist_id', artistId)
    .eq('purpose', purpose)
    .select('id, storage_path, source_path')
  if (del.error) return { ok: false, error: del.error.message }
  const replaced = (del.data ?? []) as ReplacedRow[]
  const res: Result = storagePath ? await insertBrandAsset(supabase, artistId, purpose, storagePath) : { ok: true }
  await sweepReplaced(supabase, replaced, [storagePath])
  return res
}

async function insertBrandAsset(
  supabase: SupabaseClient,
  artistId: string,
  purpose: BrandPurpose,
  storagePath: string,
): Promise<Result> {
  const { error } = await supabase.from('media').insert({
    artist_id: artistId,
    purpose,
    storage_path: storagePath,
    on_site: true,
    sort_order: Math.floor(Date.now() / 1000),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** A media row's id and the files it named, as a delete or a replace left them. */
type ReplacedRow = { id: string; storage_path: string | null; source_path?: string | null }

/**
 * Remove the files replaced rows no longer name — only where the row was NEVER published
 * (`gcDeletedMediaObject`: a published row's file may still be served, and a failed count
 * is "unknown", which keeps it). `keep` is every path the rows name NOW, so a file the new
 * state still uses is never removed, even if the old row named the same path. Best-effort,
 * like every GC: an unremoved object costs storage, a thrown error would cost the save.
 */
async function sweepReplaced(
  supabase: SupabaseClient,
  rows: readonly ReplacedRow[],
  keep: readonly (string | null | undefined)[],
): Promise<void> {
  if (rows.length === 0) return
  const kept = new Set(keep.filter(Boolean))
  const { gcDeletedMediaObject } = await import('@/lib/storage-gc')
  for (const r of rows) {
    const [file, original] = [r.storage_path, r.source_path ?? null].map((p) => (p && !kept.has(p) ? p : null))
    if (file || original) await gcDeletedMediaObject(supabase, String(r.id), file, original)
  }
}

/** Read the stored framing for one icon (the tab icon by default; the home-screen icon has
 *  its own pair, 20260924120000). Missing or junk values become the default rather than an
 *  error: an icon has no way to report a problem, so it must always have something
 *  drawable. */
export async function loadFraming(
  supabase: SupabaseClient,
  artistId: string,
  target: IconTarget = 'favicon',
): Promise<FaviconFraming> {
  const cols = ICON_COLUMNS[isIconTarget(target) ? target : 'favicon']
  const { data } = await supabase.from('artists').select(`${cols.zoom}, ${cols.offsetY}`).eq('id', artistId).single()
  if (!data) return DEFAULT_FRAMING
  const row = data as unknown as Record<string, number | null>
  return cleanFraming({ zoom: row[cols.zoom] ?? undefined, offsetY: row[cols.offsetY] ?? undefined })
}

/** Store one icon's framing, clamped. Config, not published content — deliberately NOT in
 *  ARTIST_SNAPSHOT, so it never joins a public site payload where nothing can use it. */
export async function saveFraming(
  supabase: SupabaseClient,
  artistId: string,
  raw: unknown,
  target: IconTarget = 'favicon',
): Promise<{ ok: boolean; error?: string }> {
  if (!isIconTarget(target)) return { ok: false, error: 'Unknown icon.' }
  const cols = ICON_COLUMNS[target]
  const framing = cleanFraming(raw)
  const { error } = await supabase
    .from('artists')
    .update({ [cols.zoom]: framing.zoom, [cols.offsetY]: framing.offsetY })
    .eq('id', artistId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/* ── Titles, notes and the database's refusals ───────────────────────────────── */

/** A one-line title or note as typed: runs of whitespace (a pasted line break included)
 *  become one space, then trimmed. The DATABASE decides whether what is left is allowed —
 *  these only stop a stray newline from turning a good title into a refusal. */
export function cleanLine(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

/** A note, where empty means "no note" (the row then shows "Add a note…"). */
export function cleanNote(raw: unknown): string | null {
  return cleanLine(raw) || null
}

/** What a manager is told when the database refuses a brand write. Keyed on the
 *  CONSTRAINT NAME in the message, never on the SQLSTATE alone: every CHECK is 23514, and
 *  "that is not a colour" is no help to someone whose title was too long. */
const REFUSALS: [RegExp, string][] = [
  [/brand color cap reached/, 'You can keep up to 24 colors. Remove one first.'],
  [/brand_colors_hex|artists_theme_color_hex/, 'Use a color code like #1a2b3c.'],
  [/brand_colors_name/, `Give the color a name, up to ${TITLE_MAX} characters.`],
  [/media_logo_title/, `Give the logo a name, up to ${TITLE_MAX} characters.`],
  [/artist_font_slots_label_custom/, `Give the font a name, up to ${TITLE_MAX} characters.`],
  [/_note_clean|_note_custom|brand_colors_note/, `Keep the note to one line, up to ${NOTE_MAX} characters.`],
  [/artists_(favicon|home_icon)_source_fk/, 'Pick one of this artist’s logos.'],
  [/artist_fonts_weight_range/, 'Font weight must be between 100 and 900.'],
]

export function brandRefusal(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  const msg = error?.message ?? ''
  for (const [re, sentence] of REFUSALS) if (re.test(msg)) return sentence
  if (error?.code === '42501') return 'You can’t change this artist’s brand.'
  return fallback
}

type Result = { ok: boolean; error?: string }

/* ── Logos: the page's list, and the added ones ───────────────────────────────── */

/** One logo row as the Brand page draws it. `sourcePath` is the original behind a
 *  background cut-out, or null. `label` is the added logo's title (null on built-ins,
 *  which have fixed titles); `note` is dashboard-only. */
export type BrandLogo = {
  id: string
  purpose: LogoPurpose
  label: string | null
  note: string | null
  storagePath: string
  sourcePath: string | null
  sortOrder: number
}

export type BrandLogos = { primary: BrandLogo | null; secondary: BrandLogo | null; added: BrandLogo[] }

const LOGO_COLUMNS = 'id, purpose, label, note, storage_path, source_path, sort_order, created_at'

function toLogo(r: Record<string, unknown>): BrandLogo {
  return {
    id: String(r.id),
    purpose: r.purpose as LogoPurpose,
    label: (r.label as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    storagePath: String(r.storage_path),
    sourcePath: (r.source_path as string | null) ?? null,
    sortOrder: Number(r.sort_order ?? 0),
  }
}

/** Every logo the Brand page lists: the two built-ins (or null) and the added ones in
 *  sort order. Built-ins are single-occupancy, but a stray second row (a script, a race)
 *  must not throw — the newest wins, which is the row a replace would have kept. */
export async function loadBrandLogos(supabase: SupabaseClient, artistId: string): Promise<BrandLogos> {
  const { data, error } = await supabase
    .from('media')
    .select(LOGO_COLUMNS)
    .eq('artist_id', artistId)
    .in('purpose', LOGO_PURPOSES as unknown as string[])
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toLogo)
  const last = (p: LogoPurpose) => rows.filter((r) => r.purpose === p).at(-1) ?? null
  return { primary: last('logo_primary'), secondary: last('logo_secondary'), added: rows.filter((r) => r.purpose === 'logo') }
}

/**
 * Save an ADDED logo: title, optional note and file in one write, because the row exists
 * only once it has its file (BRAND_PAGE_PLAN: "a row is saved when it gets its thing").
 * Runs as performUpload's `writeRow`, so an error means NOTHING was written and the
 * uploaded object is deleted by the caller.
 */
export async function addLogo(
  supabase: SupabaseClient,
  artistId: string,
  input: { title: string; note?: string | null; storagePath: string },
): Promise<Result & { logo?: BrandLogo }> {
  if (!isOwnedStoragePath(artistId, input.storagePath)) return { ok: false, error: 'That file location is not valid.' }
  const { data, error } = await supabase
    .from('media')
    .insert({
      artist_id: artistId,
      purpose: 'logo',
      label: cleanLine(input.title),
      note: cleanNote(input.note),
      storage_path: input.storagePath,
      on_site: true,
      sort_order: Math.floor(Date.now() / 1000),
    })
    .select(LOGO_COLUMNS)
    .single()
  if (error) return { ok: false, error: brandRefusal(error, 'Could not save that logo.') }
  if (!data) return { ok: false, error: 'Could not save that logo.' }
  return { ok: true, logo: toLogo(data as Record<string, unknown>) }
}

/** An update or delete scoped to one of this artist's ADDED logos. Zero rows back is the
 *  only sign RLS (or a stale id) refused it — AGENTS.md rule 3 — so it is an error. */
async function writeAddedLogo(
  supabase: SupabaseClient,
  artistId: string,
  mediaId: string,
  patch: Record<string, unknown>,
  fallback: string,
): Promise<Result> {
  const { data, error } = await supabase
    .from('media')
    .update(patch)
    .eq('id', mediaId)
    .eq('artist_id', artistId)
    .eq('purpose', 'logo')
    .select('id')
  if (error) return { ok: false, error: brandRefusal(error, fallback) }
  if (!(data ?? []).length) return { ok: false, error: 'That logo is no longer there.' }
  return { ok: true }
}

/** Rename an added logo. The title is `media.label`, which IS published. */
export function renameLogo(supabase: SupabaseClient, artistId: string, mediaId: string, title: string): Promise<Result> {
  return writeAddedLogo(supabase, artistId, mediaId, { label: cleanLine(title) }, 'Could not rename that logo.')
}

/** Set (or clear, with empty) an added logo's note. Dashboard-only: never published. */
export function setLogoNote(
  supabase: SupabaseClient,
  artistId: string,
  mediaId: string,
  note: string | null,
): Promise<Result> {
  return writeAddedLogo(supabase, artistId, mediaId, { note: cleanNote(note) }, 'Could not save that note.')
}

/** Delete an added logo and hand back its files for the caller to sweep. Built-in logos
 *  are cleared through `setBrandAsset(…, null)`, never here. */
export async function deleteLogo(
  supabase: SupabaseClient,
  artistId: string,
  mediaId: string,
): Promise<Result & { storagePath?: string; sourcePath?: string | null }> {
  const { data, error } = await supabase
    .from('media')
    .delete()
    .eq('id', mediaId)
    .eq('artist_id', artistId)
    .eq('purpose', 'logo')
    .select('storage_path, source_path')
  if (error) return { ok: false, error: brandRefusal(error, 'Could not remove that logo.') }
  const row = (data ?? [])[0] as { storage_path?: string; source_path?: string | null } | undefined
  if (!row) return { ok: false, error: 'That logo is no longer there.' }
  return { ok: true, storagePath: row.storage_path, sourcePath: row.source_path ?? null }
}

/**
 * Point a logo row (built-in or added) at a new file, keeping its id, title and note.
 *
 * `keepOriginal` is the background cut-out: the new file is the cut-out and the file it
 * replaces goes to `source_path` — unless there already is one, because a second cut-out
 * of a cut-out must still remember the FIRST original. Without it (a fresh upload), the
 * new file is its own original and `source_path` clears.
 *
 * A file the row stops naming goes at once if the row was never published
 * (`sweepReplaced`); a published row keeps it — the live site may still serve it — until
 * the whole-media publish's sweep.
 *
 * The update is conditional on the path it read, so two editors racing cannot both
 * "keep the original" of each other's cut-out.
 */
export async function setLogoFile(
  supabase: SupabaseClient,
  artistId: string,
  mediaId: string,
  storagePath: string,
  opts: { keepOriginal: boolean },
): Promise<Result> {
  if (!isOwnedStoragePath(artistId, storagePath)) return { ok: false, error: 'That file location is not valid.' }
  const { data: row } = await supabase
    .from('media')
    .select('storage_path, source_path')
    .eq('id', mediaId)
    .eq('artist_id', artistId)
    .in('purpose', LOGO_PURPOSES as unknown as string[])
    .maybeSingle()
  if (!row) return { ok: false, error: 'That logo is no longer there.' }
  const current = row as { storage_path: string; source_path: string | null }
  const source_path = opts.keepOriginal ? (current.source_path ?? current.storage_path) : null

  const { data, error } = await supabase
    .from('media')
    .update({ storage_path: storagePath, source_path })
    .eq('id', mediaId)
    .eq('artist_id', artistId)
    .eq('storage_path', current.storage_path)
    .select('id')
  if (error) return { ok: false, error: brandRefusal(error, 'Could not save that logo.') }
  if (!(data ?? []).length) return { ok: false, error: 'That logo changed while you were editing it. Try again.' }
  await sweepReplaced(supabase, [{ id: mediaId, ...current }], [storagePath, source_path])
  return { ok: true }
}

/* ── Icons: where each comes from, and the browser-bar colour ─────────────────── */

export type IconSettings = {
  favicon: { sourceMediaId: string | null; framing: FaviconFraming }
  homeIcon: { sourceMediaId: string | null; framing: FaviconFraming }
  themeColor: string | null
}

/** The Tab icon tab's saved state. `sourceMediaId: null` means the primary logo. */
export async function loadIconSettings(supabase: SupabaseClient, artistId: string): Promise<IconSettings> {
  const { data } = await supabase
    .from('artists')
    .select(
      'favicon_source_media_id, favicon_zoom, favicon_offset_y, home_icon_source_media_id, home_icon_zoom, home_icon_offset_y, theme_color',
    )
    .eq('id', artistId)
    .maybeSingle()
  const r = (data ?? {}) as Record<string, unknown>
  const framing = (zoom: unknown, offsetY: unknown) =>
    cleanFraming({ zoom: zoom ?? undefined, offsetY: offsetY ?? undefined })
  return {
    favicon: {
      sourceMediaId: (r.favicon_source_media_id as string | null) ?? null,
      framing: framing(r.favicon_zoom, r.favicon_offset_y),
    },
    homeIcon: {
      sourceMediaId: (r.home_icon_source_media_id as string | null) ?? null,
      framing: framing(r.home_icon_zoom, r.home_icon_offset_y),
    },
    themeColor: (r.theme_color as string | null) ?? null,
  }
}

/** One write to this artist's own `artists` row, with the zero-row check. */
async function writeArtist(
  supabase: SupabaseClient,
  artistId: string,
  patch: Record<string, unknown>,
  fallback: string,
): Promise<Result> {
  const { data, error } = await supabase.from('artists').update(patch).eq('id', artistId).select('id')
  if (error) return { ok: false, error: brandRefusal(error, fallback) }
  if (!(data ?? []).length) return { ok: false, error: 'Not found.' }
  return { ok: true }
}

/**
 * Choose what an icon is framed from: a logo or an uploaded icon image of THIS artist, or
 * `null` for the primary logo. The composite FK (20260924120000) already refuses another
 * artist's media; the purpose rule — never a derived PNG — lives here, where there is a
 * sentence to say. Afterwards, uploaded icon images neither icon uses any more are removed.
 */
export async function setIconSource(
  supabase: SupabaseClient,
  artistId: string,
  target: IconTarget,
  mediaId: string | null,
): Promise<Result> {
  if (!isIconTarget(target)) return { ok: false, error: 'Unknown icon.' }
  if (mediaId !== null) {
    const { data: m } = await supabase
      .from('media')
      .select('id, purpose')
      .eq('id', mediaId)
      .eq('artist_id', artistId)
      .maybeSingle()
    const purpose = (m as { purpose?: string } | null)?.purpose
    if (!m || !(ICON_SOURCE_PURPOSES as readonly string[]).includes(purpose ?? ''))
      return { ok: false, error: 'Pick one of this artist’s logos.' }
  }
  const res = await writeArtist(supabase, artistId, { [ICON_COLUMNS[target].source]: mediaId }, 'Could not change the icon.')
  if (res.ok) await pruneIconSources(supabase, artistId)
  return res
}

/**
 * An image uploaded just for one icon: store it (`icon_source`, off-site) and make it that
 * icon's source, as ONE call — performUpload's `writeRow`, so an error means nothing is
 * left behind (the row is removed again if it cannot be made the source).
 */
export async function addIconSource(
  supabase: SupabaseClient,
  artistId: string,
  target: IconTarget,
  storagePath: string,
): Promise<Result & { mediaId?: string }> {
  if (!isIconTarget(target)) return { ok: false, error: 'Unknown icon.' }
  if (!isOwnedStoragePath(artistId, storagePath)) return { ok: false, error: 'That file location is not valid.' }
  const { data, error } = await supabase
    .from('media')
    .insert({
      artist_id: artistId,
      purpose: 'icon_source',
      storage_path: storagePath,
      on_site: false,
      sort_order: Math.floor(Date.now() / 1000),
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: brandRefusal(error, 'Could not save that image.') }
  const mediaId = String((data as { id: string }).id)
  const set = await setIconSource(supabase, artistId, target, mediaId)
  if (!set.ok) {
    await supabase.from('media').delete().eq('id', mediaId).eq('artist_id', artistId)
    return set
  }
  return { ok: true, mediaId }
}

/** Remove `icon_source` rows neither icon points at. Best-effort: a leftover image costs a
 *  row and a file, a failure here must not cost the manager the change they just made.
 *  The files follow the delete-time rule (kept if the row was ever published). */
async function pruneIconSources(supabase: SupabaseClient, artistId: string): Promise<void> {
  try {
    const [{ data: artist }, { data: sources }] = await Promise.all([
      supabase
        .from('artists')
        .select('favicon_source_media_id, home_icon_source_media_id')
        .eq('id', artistId)
        .maybeSingle(),
      supabase.from('media').select('id, storage_path').eq('artist_id', artistId).eq('purpose', 'icon_source'),
    ])
    if (!artist || !sources) return
    const a = artist as { favicon_source_media_id: string | null; home_icon_source_media_id: string | null }
    const inUse = new Set([a.favicon_source_media_id, a.home_icon_source_media_id].filter(Boolean))
    const { gcDeletedMediaObject } = await import('@/lib/storage-gc')
    for (const s of sources as { id: string; storage_path: string }[]) {
      if (inUse.has(s.id)) continue
      const { error } = await supabase.from('media').delete().eq('id', s.id).eq('artist_id', artistId)
      if (!error) await gcDeletedMediaObject(supabase, s.id, s.storage_path)
    }
  } catch {
    // best-effort, see above
  }
}

/** The browser-bar colour, or `null` to leave it to the browser. The typed value is
 *  normalised (`ABC` → `#aabbcc`); the database's CHECK is what decides it is a colour. */
export function setThemeColor(supabase: SupabaseClient, artistId: string, hex: string | null): Promise<Result> {
  const value = hex === null || cleanLine(hex) === '' ? null : canonicalHex(hex) || cleanLine(hex).toLowerCase()
  return writeArtist(supabase, artistId, { theme_color: value }, 'Could not save that color.')
}

/* ── The brand-scoped Publish bar ──────────────────────────────────────────────── */

/** What the Brand bar says. `message` is '' when there is nothing to publish.
 *  `canRevert`: Revert would change something — there is a pending change of a kind that
 *  HAS been published. Revert skips a never-published kind rather than wipe it
 *  (`restoreBrandToPublished`), so without this the bar offered a button that could only
 *  answer "nothing to go back to". */
export type BrandPending = { dirty: boolean; message: string; canRevert: boolean }

/** The row name a manager recognises, per single-occupancy purpose. */
const PURPOSE_NOUN: Record<Exclude<BrandMediaPurpose, 'logo' | 'icon_source'>, string> = {
  logo_primary: 'Primary logo',
  logo_secondary: 'Secondary logo',
  favicon: 'Tab icon',
  home_icon: 'Home-screen icon',
}

type Subject = { noun: string; changes: EntityChange['change'][]; viaSource: boolean }

/**
 * Group the diff into the things a manager changed. One subject per ROW NAME, not per
 * database row: replacing the primary logo is a delete and an insert (vacate-then-insert)
 * but it is ONE change, "Primary logo changed". An uploaded icon image rides with the icon
 * it feeds, so a new tab icon reads as one change rather than two.
 */
export function brandSubjects(
  media: EntityChange[],
  fonts: EntityChange[],
  sources: { favicon: string | null; homeIcon: string | null } = { favicon: null, homeIcon: null },
): Subject[] {
  const subjects = new Map<string, Subject>()
  const add = (key: string, noun: string, change: EntityChange['change'], viaSource = false) => {
    const s = subjects.get(key) ?? { noun, changes: [], viaSource: false }
    s.changes.push(change)
    s.viaSource ||= viaSource
    subjects.set(key, s)
  }
  for (const c of media) {
    const purpose = c.snapshot.purpose as BrandMediaPurpose
    if (purpose === 'logo') add(`logo:${c.id}`, cleanLine(c.snapshot.label) || 'Logo', c.change)
    else if (purpose === 'icon_source') {
      if (c.id === sources.favicon) add('favicon', PURPOSE_NOUN.favicon, c.change, true)
      else if (c.id === sources.homeIcon) add('home_icon', PURPOSE_NOUN.home_icon, c.change, true)
      else add('icons', 'Icons', c.change, true)
    } else add(purpose, PURPOSE_NOUN[purpose], c.change)
  }
  for (const c of fonts) add('fonts', 'Fonts', c.change)
  return [...subjects.values()]
}

/** "Primary logo changed", "Tour logo added", "3 changes" — or '' when clean. */
export function brandPendingMessage(subjects: Subject[]): string {
  if (subjects.length === 0) return ''
  if (subjects.length > 1) return `${subjects.length} changes`
  const [s] = subjects
  const verb =
    !s.viaSource && s.changes.every((c) => c === 'added')
      ? 'added'
      : !s.viaSource && s.changes.every((c) => c === 'deleted')
        ? 'removed'
        : 'changed'
  return `${s.noun} ${verb}`
}

type LatestRow = { entity_type: string; entity_id: string | null; data: Record<string, unknown> }

/** The kinds a brand revert may touch: those with ANY published revision. A kind never
 *  published has no published state to go back to, so "not in the log" must not read as
 *  "delete every row" — the revert skips it, and the bar hides Revert for it. */
function revertableTypes(latest: LatestRow[]): Set<string> {
  return new Set(latest.map((r) => r.entity_type))
}

async function latestRevisions(supabase: SupabaseClient, artistId: string): Promise<LatestRow[]> {
  const { data, error } = await supabase.rpc('latest_revisions', { p_artist_id: artistId })
  if (error) throw new Error(error.message)
  return (data ?? []) as LatestRow[]
}

/**
 * Is anything the Brand page publishes different from the live site? BRAND-SCOPED: only
 * the brand media purposes and the fonts, never a gallery photo — the bar on this page
 * must not light up for a change made somewhere else. Built on `diffEntities`, the same
 * comparison `diffUnpublished` uses, so the two can never disagree about one row.
 *
 * Uncached on purpose: the bar has to appear the moment a change lands.
 * Dashboard-only settings (notes, colours, icon sources, framing, the browser-bar colour)
 * are not published this round, so they are never "not on the site yet".
 */
export async function brandPending(supabase: SupabaseClient, artistId: string): Promise<BrandPending> {
  const [latest, media, fonts, { data: artist }] = await Promise.all([
    latestRevisions(supabase, artistId),
    listContent(supabase, 'media', artistId),
    listContent(supabase, 'artist_font', artistId),
    supabase
      .from('artists')
      .select('favicon_source_media_id, home_icon_source_media_id')
      .eq('id', artistId)
      .maybeSingle(),
  ])
  const byKey = new Map<string, Record<string, unknown>>()
  for (const r of latest) if (r.entity_id) byKey.set(`${r.entity_type}:${r.entity_id}`, r.data)
  const a = (artist ?? {}) as { favicon_source_media_id?: string | null; home_icon_source_media_id?: string | null }
  const mediaChanges = diffEntities('media', media, byKey, BRAND_MEDIA_SLICE.keep)
  const fontChanges = diffEntities('artist_font', fonts, byKey)
  const subjects = brandSubjects(mediaChanges, fontChanges, {
    favicon: a.favicon_source_media_id ?? null,
    homeIcon: a.home_icon_source_media_id ?? null,
  })
  const message = brandPendingMessage(subjects)
  // The revert's own skip rule (`revertableTypes`), so the button and the action agree.
  const revertable = revertableTypes(latest)
  const canRevert =
    (mediaChanges.length > 0 && revertable.has('media')) || (fontChanges.length > 0 && revertable.has('artist_font'))
  return { dirty: message !== '', message, canRevert }
}

/* ── Publish: the Brand page's slice, and nothing else ─────────────────────────── */

/** The media the Brand page publishes: its own purposes, judged on the snapshot so a
 *  deleted logo is still recognised by its last published copy. The SAME predicate the
 *  bar (`brandPending`) and Revert use — what the bar counts is what Publish sends. */
export const BRAND_MEDIA_SLICE = { keep: (snap: Record<string, unknown>) => isBrandMediaPurpose(snap.purpose) }

/**
 * The Brand page's Publish: brand media (never a gallery photo, hero or profile draft)
 * and the fonts with their slots. Returns the revision rows written.
 *
 * No storage sweep here, deliberately. `gcMediaObjects` treats every object no WORKING row
 * names as an orphan, which is only true straight after a WHOLE-media publish. After this
 * one, a gallery photo deleted in draft is still live on the site (its tombstone was not
 * written), and its file must outlive it until the gallery itself is published.
 */
export async function publishBrand(supabase: SupabaseClient, artistId: string, publishedBy?: string): Promise<number> {
  const media = await publishContent(supabase, 'media', artistId, publishedBy, BRAND_MEDIA_SLICE)
  const fonts = await publishContent(supabase, 'artist_font', artistId, publishedBy)
  return media + fonts
}

/* ── Revert: the Brand page back to what the site shows ───────────────────────── */

type IconSources = Record<IconTarget, string | null>

async function readIconSources(supabase: SupabaseClient, artistId: string): Promise<IconSources> {
  const { data, error } = await supabase
    .from('artists')
    .select('favicon_source_media_id, home_icon_source_media_id')
    .eq('id', artistId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const a = (data ?? {}) as { favicon_source_media_id?: string | null; home_icon_source_media_id?: string | null }
  return { favicon: a.favicon_source_media_id ?? null, home_icon: a.home_icon_source_media_id ?? null }
}

/**
 * What each icon should be framed from once a revert has put the brand media back.
 *
 * The sources are dashboard-only — not in the log, so there is no published value to
 * restore. But an icon IMAGE (`icon_source`) is brand media, and the revert removes one
 * uploaded since the publish; its FK then nulls the icon's source, silently, to the primary
 * logo — while the PNG just put back may have been cut from something else. So:
 *
 *   1. an icon whose source row the revert removed loses that source (null, the primary),
 *      written here rather than left to the FK;
 *   2. an icon image in the PUBLISHED log that no icon now uses was, at publish time, some
 *      icon's source — `pruneIconSources` keeps no unused image, so every published one fed
 *      an icon. When exactly one such image and exactly one icon that needs it can be paired,
 *      the icon points at it again: first an icon whose source the revert removed, else one
 *      whose PNG the revert put back while it names no published image;
 *   3. anything ambiguous (two images, two icons) is left at the primary — a guess could
 *      pair a PNG with the wrong picture. The framing is not in the log either, so it stays
 *      as the manager left it; the next edit regenerates the icon from both.
 */
export function settleIconSources(o: {
  before: IconSources
  /** Brand media ids the revert deleted. */
  removed: ReadonlySet<string>
  /** The brand media rows as they were before the revert. */
  live: readonly Record<string, unknown>[]
  /** The published brand media, by id. */
  wanted: ReadonlyMap<string, Record<string, unknown>>
}): IconSources {
  /** The revert put this icon's published PNG back: there is one, and the draft had a
   *  different file (or none) in its place. */
  const pngPutBack = (t: IconTarget) =>
    [...o.wanted].some(
      ([id, snap]) =>
        snap.purpose === t && !o.live.some((r) => String(r.id) === id && r.storage_path === snap.storage_path),
    )
  const next: IconSources = { ...o.before }
  const lost = ICON_TARGETS.filter((t) => next[t] !== null && o.removed.has(next[t]!))
  for (const t of lost) next[t] = null

  const publishedImage = (id: string | null) => id !== null && o.wanted.get(id)?.purpose === 'icon_source'
  const orphans = [...o.wanted.keys()].filter(
    (id) => publishedImage(id) && id !== next.favicon && id !== next.home_icon,
  )
  const needy = lost.length > 0 ? lost : ICON_TARGETS.filter((t) => pngPutBack(t) && !publishedImage(next[t]))
  if (orphans.length === 1 && needy.length === 1) next[needy[0]] = orphans[0]
  return next
}

/** Media columns a brand revert puts back: the whole published snapshot (a logo is its
 *  file, its title, its order), minus the id it is matched by. Derived from PUBLISHABLE,
 *  so a column that joins the snapshot is restored in the same edit. */
const MEDIA_RESTORE = PUBLISHABLE.media.snapshot.filter((c) => c !== 'id')
/** Font row columns (the view's `slots` is rebuilt separately, from every font at once). */
const FONT_RESTORE = PUBLISHABLE.artist_font.snapshot.filter((c) => c !== 'id' && c !== 'slots')

const snapValue = (type: 'media' | 'artist_font', snap: Record<string, unknown>, col: string) =>
  col in snap ? (snap[col] ?? null) : ((SNAPSHOT_DEFAULTS[type] ?? {})[col] ?? null)

export type BrandRevert = { changed: number; hasPublished: boolean; skipped: ('media' | 'artist_font')[] }

/**
 * Put the Brand page's DRAFT back to the last publish: brand media rows and fonts (with
 * their slots). The inverse of the brand publish, read from the same log
 * (`latest_revisions`), in the three cases `restoreToPublished` names — published and
 * changed (put the columns back), added since (remove), deleted since (re-insert, id and
 * all).
 *
 * WHY THIS IS NOT `restoreToPublished` + EDITOR_RESTORE: that one restores what the SITE
 * EDITOR owns — for media only `site_role`, and it only ever "unplaces" a photo, never
 * removes one. Adding brand media there would make the editor's Undo delete logos, and
 * fonts are two tables (slots ride the font's snapshot). So this is its own restore, over
 * the brand slice only; the gallery is never read for writing.
 *
 * SAFE TO RE-INSERT: a published row's file outlives its deletion. Delete-time GC keeps
 * the object of anything ever published, and the publish-time sweeps (media: after a media
 * publish; fonts: keeps every path a live revision names) run only once the deletion
 * itself is published — at which point the row is no longer "published" here.
 *
 * DASHBOARD-ONLY DATA (never in the log, so never "restored" — but never silently lost):
 *   • a surviving row keeps its own: a logo's note and cut-out original, a font's weight;
 *   • a custom font slot's title and note are read BEFORE any font is deleted and written
 *     back, because deleting a font uploaded since the publish cascades its slot row away;
 *   • each icon's source is settled by `settleIconSources`: removing an icon image uploaded
 *     since the publish no longer leaves the icon silently on the primary logo while the
 *     PNG put back was cut from a published image;
 *   • colours, the browser-bar colour and icon framing are not touched at all.
 * What does go: a row ADDED since the publish, with whatever note it had — it was never on
 * the site, which is what Revert undoes. A row the manager deleted comes back without the
 * note it had (the delete took it, and the log never had it).
 *
 * The same two guards as `restoreToPublished`: nothing published at all → change nothing;
 * a type with no published revision ever → skip it rather than read "never published" as
 * "delete every row" (reported in `skipped`). Not atomic — each statement is its own
 * request, as there. A failure throws, and running it again finishes the job.
 */
export async function restoreBrandToPublished(supabase: SupabaseClient, artistId: string): Promise<BrandRevert> {
  const latest = await latestRevisions(supabase, artistId)
  if (latest.length === 0) return { changed: 0, hasPublished: false, skipped: [] }

  const everPublished = revertableTypes(latest)
  const publishedOf = (type: string, keep: (d: Record<string, unknown>) => boolean = () => true) => {
    const out = new Map<string, Record<string, unknown>>()
    for (const r of latest) {
      if (r.entity_type !== type || !r.entity_id || r.data?._deleted === true || !keep(r.data)) continue
      out.set(r.entity_id, r.data)
    }
    return out
  }
  const fail = (e: { message: string } | null) => {
    if (e) throw new Error(e.message)
  }

  let changed = 0
  const skipped: BrandRevert['skipped'] = []

  /* Media: the brand purposes only. */
  if (!everPublished.has('media')) skipped.push('media')
  else {
    const wanted = publishedOf('media', (d) => isBrandMediaPurpose(d.purpose))
    const live = (await listContent(supabase, 'media', artistId)).filter((r) => isBrandMediaPurpose(r.purpose))
    const liveIds = new Set(live.map((r) => String(r.id)))
    const { gcDeletedMediaObject } = await import('@/lib/storage-gc')
    // Read BEFORE any delete: removing an icon image nulls its icon's source (the FK), and
    // `settleIconSources` needs to know what each icon was framed from until now.
    const sourcesBefore = await readIconSources(supabase, artistId)
    const removed = new Set<string>()

    for (const row of live) {
      const id = String(row.id)
      const snap = wanted.get(id)
      if (!snap) {
        const { error } = await supabase.from('media').delete().eq('id', id).eq('artist_id', artistId)
        fail(error)
        await gcDeletedMediaObject(supabase, id, row.storage_path as string, (row.source_path as string | null) ?? null)
        removed.add(id)
        changed++
        continue
      }
      const patch: Record<string, unknown> = {}
      for (const col of MEDIA_RESTORE) {
        const next = snapValue('media', snap, col)
        if (JSON.stringify(row[col] ?? null) !== JSON.stringify(next)) patch[col] = next
      }
      // Back to the published file: a cut-out's original is that file, not an original of it.
      if ('storage_path' in patch && row.source_path === patch.storage_path) patch.source_path = null
      if (Object.keys(patch).length === 0) continue
      const { error } = await supabase.from('media').update(patch).eq('id', id).eq('artist_id', artistId)
      fail(error)
      changed++
    }
    for (const [id, snap] of wanted) {
      if (liveIds.has(id)) continue
      const insert: Record<string, unknown> = { id, artist_id: artistId }
      for (const col of MEDIA_RESTORE) insert[col] = snapValue('media', snap, col)
      const { error } = await supabase.from('media').insert(insert)
      fail(error)
      changed++
    }

    const after = settleIconSources({ before: sourcesBefore, removed, live, wanted })
    for (const target of ICON_TARGETS) {
      if (after[target] === sourcesBefore[target]) continue
      const { error } = await supabase
        .from('artists')
        .update({ [ICON_COLUMNS[target].source]: after[target] })
        .eq('id', artistId)
      fail(error)
    }
  }

  /* Fonts, then their slots (a slot names a font, so the fonts must exist first). */
  if (!everPublished.has('artist_font')) skipped.push('artist_font')
  else {
    const wanted = publishedOf('artist_font')
    const live: ContentRow[] = await listContent(supabase, 'artist_font', artistId)
    const liveIds = new Set(live.map((r) => String(r.id)))

    // A custom slot's title and note live on the SLOT row, which the font FK cascades away
    // when its font is deleted below (a font uploaded since the publish). Read them FIRST,
    // so a slot that comes back gets them back — the log never had them to restore.
    const { data: slotsBefore, error: metaErr } = await supabase
      .from('artist_font_slots')
      .select('slot, font_id, label, note')
      .eq('artist_id', artistId)
    fail(metaErr)
    const slotMeta = new Map(
      ((slotsBefore ?? []) as { slot: string; label: string | null; note: string | null }[]).map((s) => [s.slot, s]),
    )

    // Removals first: a font uploaded since may hold the family token a re-inserted one
    // needs (unique per artist).
    for (const row of live) {
      const id = String(row.id)
      if (wanted.has(id)) continue
      const { error } = await supabase.from('artist_fonts').delete().eq('id', id).eq('artist_id', artistId)
      fail(error)
      changed++
    }
    for (const row of live) {
      const id = String(row.id)
      const snap = wanted.get(id)
      if (!snap) continue
      const patch: Record<string, unknown> = {}
      for (const col of FONT_RESTORE) {
        const next = snapValue('artist_font', snap, col)
        if (JSON.stringify(row[col] ?? null) !== JSON.stringify(next)) patch[col] = next
      }
      if (Object.keys(patch).length === 0) continue
      const { error } = await supabase.from('artist_fonts').update(patch).eq('id', id).eq('artist_id', artistId)
      fail(error)
      changed++
    }
    for (const [id, snap] of wanted) {
      if (liveIds.has(id)) continue
      const insert: Record<string, unknown> = { id, artist_id: artistId }
      for (const col of FONT_RESTORE) insert[col] = snapValue('artist_font', snap, col)
      const { error } = await supabase.from('artist_fonts').insert(insert)
      fail(error)
      changed++
    }

    // Slots: the published map is the union of every published font's `slots`.
    const wantedSlots = new Map<string, string>()
    for (const [id, snap] of wanted) for (const slot of (snap.slots as string[] | null) ?? []) wantedSlots.set(slot, id)
    const { data: liveSlots, error: slotErr } = await supabase
      .from('artist_font_slots')
      .select('slot, font_id')
      .eq('artist_id', artistId)
    fail(slotErr)
    const liveSlotMap = new Map(((liveSlots ?? []) as { slot: string; font_id: string }[]).map((s) => [s.slot, s.font_id]))
    for (const [slot] of liveSlotMap) {
      if (wantedSlots.has(slot)) continue
      const { error } = await supabase.from('artist_font_slots').delete().eq('artist_id', artistId).eq('slot', slot)
      fail(error)
      changed++
    }
    for (const [slot, fontId] of wantedSlots) {
      if (liveSlotMap.get(slot) === fontId) continue
      // The upsert names a title or note only when the slot had one before the revert: a
      // surviving slot keeps its own (a column not named is not touched), a cascaded one
      // gets its own back, and a null is never written over one.
      const meta = slotMeta.get(slot)
      const { error } = await supabase.from('artist_font_slots').upsert(
        {
          artist_id: artistId,
          slot,
          font_id: fontId,
          ...(meta?.label != null ? { label: meta.label } : {}),
          ...(meta?.note != null ? { note: meta.note } : {}),
        },
        { onConflict: 'artist_id,slot' },
      )
      fail(error)
      changed++
    }
  }

  return { changed, hasPublished: true, skipped }
}
