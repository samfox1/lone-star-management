/**
 * embedInfo — the XSS gate for video embeds. A video's embed_url becomes an
 * <iframe src> on the public site, so only known providers (YouTube, SoundCloud)
 * are allowed; a parsed URL on a non-http(s) scheme or an unknown host returns
 * null (the caller renders nothing). Returns the provider + a normalized, safe
 * embed URL.
 */
export type EmbedInfo = { provider: 'youtube' | 'soundcloud'; embedUrl: string; isShort?: boolean }

const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/

/** The video id plus whether the source URL was a Short (/shorts/<id>). */
function youtubeVideoId(u: URL, host: string): { id: string; isShort: boolean } | null {
  const ok = (id: string, isShort = false) => (VIDEO_ID.test(id) ? { id, isShort } : null)
  if (host === 'youtu.be') return ok(u.pathname.slice(1).split('/')[0])
  const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com') // www, m
  if (!isYouTube) return null
  if (u.pathname === '/watch') return ok(u.searchParams.get('v') ?? '')
  if (u.pathname.startsWith('/embed/')) return ok(u.pathname.slice('/embed/'.length).split('/')[0])
  if (u.pathname.startsWith('/shorts/')) return ok(u.pathname.slice('/shorts/'.length).split('/')[0], true)
  return null
}

export function embedInfo(raw: string): EmbedInfo | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Reject javascript:/data:/etc. — only real web URLs can be embedded.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.toLowerCase()

  const yt = youtubeVideoId(parsed, host)
  if (yt) return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${yt.id}`, isShort: yt.isShort }

  if ((host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) && parsed.pathname.length > 1) {
    return { provider: 'soundcloud', embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}` }
  }
  return null
}

/**
 * Render-time guard: is this a safe value for an <iframe src>? Embed URLs are
 * produced by embedInfo at write time, but a stored value (e.g. a direct insert)
 * could be anything — only allow the exact provider embed origins.
 */
export function isSafeEmbedSrc(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return (
      (host === 'www.youtube.com' && u.pathname.startsWith('/embed/')) ||
      (host === 'w.soundcloud.com' && u.pathname.startsWith('/player'))
    )
  } catch {
    return false
  }
}
