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
}

type YtChannels = { items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }
type YtPlaylistItems = {
  items?: { snippet?: { title?: string; resourceId?: { videoId?: string } } }[]
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

  /** Every video on a channel's uploads playlist (the cheap path). */
  async function getChannelVideos(channelId: string): Promise<YouTubeVideoInput[]> {
    const channels = await apiGet<YtChannels>(
      `/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`,
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
        })
      }
      pageToken = page.nextPageToken
      pages++
    } while (pageToken && pages < maxPages)
    return out
  }

  return { getChannelVideos }
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>
