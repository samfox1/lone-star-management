/**
 * How the public site turns a video row into something playable. A `provider='uploaded'`
 * video is a self-hosted file in the public `videos` bucket and renders as a native
 * `<video>`; a YouTube/SoundCloud video renders as an embed iframe. Kept pure + beside
 * the embed XSS gate so the branch is a unit-testable regression guard, not logic buried
 * in a template (where uploaded videos silently got filtered out).
 */

import { isSafeEmbedSrc } from './embed'

export type VideoLike = {
  provider: string
  embed_url: string | null
  storage_path: string | null
}

/** A stored path is exactly `{seg}/videos/{seg}.{mp4|webm|mov}` — no `..`, no absolute,
 *  no spaces. The public <video src> is only ever built from a path that matches. */
const SAFE_VIDEO_PATH = /^[\w-]+\/videos\/[\w.-]+\.(mp4|webm|mov)$/i

export function videoRenderMode(provider: string): 'video' | 'iframe' {
  return provider === 'uploaded' ? 'video' : 'iframe'
}

/** Can this video be safely rendered on the public site? Uploaded → a resolvable,
 *  shape-checked storage path; embed → a safe embed URL. The templates filter on this
 *  so an uploaded video (null embed_url) isn't dropped by the old embed-only check. */
export function isRenderableVideo(v: VideoLike): boolean {
  if (v.provider === 'uploaded') return publicVideoSrc(v) !== null
  return v.embed_url != null && isSafeEmbedSrc(v.embed_url)
}

/** Client mirror of the DB CHECK, but provider-aware: an uploaded video needs a file,
 *  an embedded one needs a URL. Testing both sides stops the two from drifting. */
export function embedOrStorageValid(v: VideoLike): boolean {
  return v.provider === 'uploaded' ? Boolean(v.storage_path) : Boolean(v.embed_url)
}

/** The playable src, or null if unresolvable. Uploaded → the videos-bucket public URL
 *  (built only from a shape-checked path); otherwise the embed URL. */
export function publicVideoSrc(v: VideoLike): string | null {
  if (v.provider !== 'uploaded') return v.embed_url
  if (!v.storage_path || v.storage_path.includes('..') || !SAFE_VIDEO_PATH.test(v.storage_path)) return null
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/videos/${v.storage_path}`
}
