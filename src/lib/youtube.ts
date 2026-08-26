/**
 * youtubeClient — reads a channel's uploads via the QUOTA-CHEAP path:
 * channels.list → contentDetails.relatedPlaylists.uploads → playlistItems.list
 * (≈1 unit/page), NOT search.list (100 units). An `key` query param
 * authenticates. YouTube videos are embed-only (no hosted audio). A factory with
 * injectable fetch/sleep.
 */

import { httpGetJson } from '@/lib/http'

const API_BASE = 'https://www.googleapis.com/youtube/v3'

/** The shape the videos sync consumes (one YouTube upload). */
export type YouTubeVideoInput = {
  youtube_id: string
  title: string
  provider: 'youtube'
  embed_url: string
  /** True for a YouTube Short (vertical clip) vs a normal long-form upload. */
  is_short: boolean
  /** Global YouTube view count, filled by the client's `viewCounts` (optional). */
  views?: number | null
  /** When YouTube published it (playlistItems snippet.publishedAt) — VideoObject.uploadDate. */
  published_at?: string | null
}

type YtChannels = { items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }

/**
 * Build the channels.list selector for a user-supplied channel reference. Accepts a
 * raw channel id (UC…), an @handle (e.g. @Sskeen), a legacy username, or a pasted
 * channel URL (/channel/UC…, /@handle, /c/name, /user/name). Ids resolve via `id`,
 * handles via `forHandle`, legacy names via `forUsername` (all YouTube Data API v3).
 * Anything that isn't a UC id is treated as a handle — the common case for a name
 * someone types in (e.g. "Sskeen" or "@Sskeen").
 */
export function channelSelector(raw: string): string {
  const v = raw.trim()
  const url = v.match(
    /(?:youtube\.com|youtu\.be)\/(?:(?:channel\/)(UC[\w-]{22})|@([\w.-]+)|(?:c|user)\/([\w.-]+))/i,
  )
  if (url) {
    if (url[1]) return `id=${encodeURIComponent(url[1])}`
    if (url[2]) return `forHandle=${encodeURIComponent('@' + url[2])}`
    if (url[3]) return `forUsername=${encodeURIComponent(url[3])}`
  }
  if (/^UC[\w-]{22}$/.test(v)) return `id=${encodeURIComponent(v)}`
  return `forHandle=${encodeURIComponent('@' + v.replace(/^@/, ''))}`
}
type YtPlaylistItems = {
  items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[]
  nextPageToken?: string
}

type Options = {
  apiKey?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  maxPages?: number
}

export function createYouTubeClient(opts: Options = {}) {
  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const maxPages = opts.maxPages ?? 20

  function apiGet<T>(path: string): Promise<T> {
    if (!apiKey) throw new Error('YouTube API key not configured (YOUTUBE_API_KEY).')
    const url = `${API_BASE}${path}&key=${encodeURIComponent(apiKey)}`
    return httpGetJson<T>(url, { fetchImpl: doFetch, sleep, maxRetries, provider: 'YouTube' })
  }

  /**
   * Is this upload a Short? youtube.com/shorts/<id> serves the Short (200) but
   * 3xx-redirects a normal video to /watch. This is a plain web request (no API
   * quota) and the only reliable signal — duration alone misclassifies short
   * normal clips. `redirect: 'manual'` so the 3xx is observable, not followed.
   * Any failure defaults to false (a normal video is the safe landing bucket).
   */
  async function isShort(youtubeId: string): Promise<boolean> {
    // Node fetch has no default timeout; over up to ~1000 uploads a single stalled
    // connection would hang the whole import. Bound each probe.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await doFetch(`https://www.youtube.com/shorts/${encodeURIComponent(youtubeId)}`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      })
      return res.status === 200
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /** Global view counts for the given video ids (videos.list?part=statistics,
   *  batched 50/call — 1 quota unit each). Missing/non-numeric → omitted. */
  async function viewCounts(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50)
      const data = await apiGet<{ items?: { id?: string; statistics?: { viewCount?: string } }[] }>(
        `/videos?part=statistics&id=${encodeURIComponent(batch.join(','))}`,
      )
      for (const it of data.items ?? []) {
        // parseInt (not Number) so an empty-string viewCount is NaN, not 0.
        const n = Number.parseInt(it.statistics?.viewCount ?? '', 10)
        if (it.id && Number.isFinite(n)) map.set(it.id, n)
      }
    }
    return map
  }

  /** Run `fn` over `items` with at most `limit` in flight (bounds the Shorts probes). */
  async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) await fn(items[cursor++])
    })
    await Promise.all(workers)
  }

  /** Every video on a channel's uploads playlist (the cheap path). `channelRef` may
   *  be a channel id, an @handle, a legacy username, or a channel URL. */
  async function getChannelVideos(channelRef: string): Promise<YouTubeVideoInput[]> {
    const channels = await apiGet<YtChannels>(
      `/channels?part=contentDetails&${channelSelector(channelRef)}`,
    )
    const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) return []

    const out: YouTubeVideoInput[] = []
    let pageToken: string | undefined
    let pages = 0
    do {
      const page = await apiGet<YtPlaylistItems>(
        `/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(uploads)}` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''),
      )
      for (const it of page.items ?? []) {
        const videoId = it.snippet?.resourceId?.videoId
        if (!videoId) continue
        out.push({
          youtube_id: videoId,
          title: it.snippet?.title ?? '',
          provider: 'youtube',
          embed_url: `https://www.youtube.com/embed/${videoId}`,
          is_short: false,
          published_at: it.snippet?.publishedAt ?? null,
        })
      }
      pageToken = page.nextPageToken
      pages++
    } while (pageToken && pages < maxPages)

    // Classify Shorts vs normal uploads (bounded concurrency; no API quota).
    await eachLimit(out, 8, async (v) => {
      v.is_short = await isShort(v.youtube_id)
    })
    return out
  }

  return { getChannelVideos, viewCounts }
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>
