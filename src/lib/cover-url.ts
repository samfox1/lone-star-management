/**
 * A cover URL sized for where it is DRAWN.
 *
 * Sam, 2026-09-10: "it takes way too long to bounce between the pages on the assets
 * page … Can we compress the image that we see to a lower quality so that its not as
 * much data loading?" Measured on Skeen's Music tab first: 30 covers, 5.8 MB — Spotify's
 * 640px art at ~276 KB each and one uploaded cover at 1.1 MB, all drawn 192px wide.
 *
 * NO PIPELINE. Every source already serves smaller variants by URL:
 *   Spotify     the image id's 16-char prefix IS the size — …b273 = 640, …1e02 = 300,
 *               …4851 = 64. Measured: the same cover is 74 KB at 640 and 17 KB at 300.
 *   SoundCloud  the filename suffix — t500x500 / t300x300 / t200x200.
 *   our bucket  the Pro-plan render endpoint, already used by the gallery (mediaThumbUrl).
 *
 * TOTAL, never null for a URL: an unknown host comes back untouched. A tile with no
 * picture is worse than a tile with a big one. And never UPSCALE — a request larger than
 * the variant on offer keeps the original.
 *
 * THE SIZE RULE: the smallest variant that is at least 1.25× the draw size. Exactly the
 * draw size looks soft on a dense screen; a full 2× would put the 640 back on every
 * 300px-plus tile and give most of the saving away. 1.25× is the hedge: a 192px tile gets
 * the 300, a 48px avatar gets the 64, and nothing below 300px ever fetches the 640.
 *
 * Tiles only. The modal's large image and the public site keep the full asset.
 */
import { MEDIA_OBJECT_PATH, mediaRenderPath } from './storage-url'

const SPOTIFY_ID = /\/image\/ab67616d0000(b273|1e02|4851)([0-9a-f]{24})$/i
const SOUNDCLOUD_SIZE = /-t(500x500|300x300|200x200)(\.[a-z]+)$/i

export function coverThumbUrl(url: string | null | undefined, size: number): string | null {
  if (!url) return null

  // Spotify: rewrite the size prefix. Pick the smallest variant that is still >= size.
  const sp = SPOTIFY_ID.exec(url)
  if (sp && /(^|\.)scdn\.co$/i.test(hostOf(url))) {
    const need = size * 1.25
    const want = need <= 64 ? '4851' : need <= 300 ? '1e02' : 'b273'
    return url.replace(SPOTIFY_ID, `/image/ab67616d0000${want}${sp[2]}`)
  }

  // SoundCloud: rewrite the suffix, same rule.
  if (SOUNDCLOUD_SIZE.test(url) && /(^|\.)sndcdn\.com$/i.test(hostOf(url))) {
    const need = size * 1.25
    const want = need <= 200 ? '200x200' : need <= 300 ? '300x300' : '500x500'
    return url.replace(SOUNDCLOUD_SIZE, `-t${want}$2`)
  }

  // Our own bucket, recognised by PATH SHAPE on whatever origin it sits on — not by
  // comparing against NEXT_PUBLIC_SUPABASE_URL. The first version did that and passed
  // everywhere except CI's mutation job, which runs the DB-free slice with no env: the
  // prefix was `undefined/…`, nothing matched, and the helper quietly returned the
  // full-size original. Rewritten on the URL's own origin, 2× the draw size for a crisp
  // retina tile, capped at the endpoint's 640 so nothing is upscaled.
  const u = parse(url)
  if (u && u.pathname.startsWith(MEDIA_OBJECT_PATH)) {
    const path = u.pathname.slice(MEDIA_OBJECT_PATH.length)
    return `${u.origin}${mediaRenderPath(path, { size: Math.min(640, Math.ceil(size * 2)) })}`
  }

  return url
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function hostOf(url: string): string {
  return parse(url)?.host ?? ''
}
