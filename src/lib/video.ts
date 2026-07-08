/**
 * Video auto-detect for the "Add" modal's Automatic mode: paste a YouTube/SoundCloud
 * URL and we return the safe embed URL (via embedInfo, the XSS gate) plus the title
 * and thumbnail from the provider's public oEmbed endpoint — no API key needed. If
 * oEmbed fails (private video, network), we still return the embed with an empty
 * title so the manager can fill it in.
 */
import { embedInfo } from './embed'
import { httpGetJson } from './http'

export type VideoMeta = {
  title: string
  provider: 'youtube' | 'soundcloud'
  embed_url: string
  thumbnail: string | null
}

const OEMBED: Record<'youtube' | 'soundcloud', string> = {
  youtube: 'https://www.youtube.com/oembed',
  soundcloud: 'https://soundcloud.com/oembed',
}

export async function resolveVideo(
  url: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<VideoMeta | null> {
  const info = embedInfo(url) // null for a non-YouTube/SoundCloud or unsafe URL
  if (!info) return null

  const endpoint = `${OEMBED[info.provider]}?url=${encodeURIComponent(url)}&format=json`
  try {
    const data = await httpGetJson<{ title?: string; thumbnail_url?: string }>(endpoint, {
      fetchImpl: opts.fetchImpl,
      maxRetries: 1,
      provider: 'oEmbed',
    })
    return {
      title: data.title ?? '',
      provider: info.provider,
      embed_url: info.embedUrl,
      thumbnail: data.thumbnail_url ?? null,
    }
  } catch {
    return { title: '', provider: info.provider, embed_url: info.embedUrl, thumbnail: null }
  }
}
