/**
 * Public URLs for objects in the `media` storage bucket.
 *
 * A tiny leaf module so BOTH the server-heavy site builder (lib/site) and modules that
 * must stay light (site-editor/save) can build the same string without one importing
 * the other — the URL shape has one home instead of per-file copies.
 */

/** Public URL for an object in the `media` storage bucket. */
export function mediaUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`
}

/**
 * A DOWNSCALED, compressed variant of a `media` object, via Supabase's image render
 * endpoint (Pro plan). For editor THUMBNAILS only — the slots, gallery cards, and picker
 * tiles display an image a few hundred px wide but were downloading the full multi-
 * megapixel original (a real gallery photo: 3744x5616, 4.4MB).
 *
 * `resize=contain` inside a SQUARE bounding box returns the WHOLE image scaled to fit —
 * never cropped to a portion, never distorted (that 3744x5616 becomes ~427x640, ~20KB).
 * NB: passing width WITHOUT height does NOT preserve aspect — it stretches the image to
 * that width at the original height — so the box (both dims) is required. The server
 * negotiates WebP, alpha preserved (transparent handwriting PNGs stay transparent). The
 * public SITE still uses `mediaUrl` at full quality; this only shrinks editor previews.
 */
export function mediaThumbUrl(path: string, opts?: { size?: number; quality?: number }): string {
  const { size = 640, quality = 62 } = opts ?? {}
  const q = new URLSearchParams({
    width: String(size),
    height: String(size),
    resize: 'contain',
    quality: String(quality),
  })
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/render/image/public/media/${path}?${q}`
}
