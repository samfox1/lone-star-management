/**
 * deezerClient — reads Deezer's PUBLIC catalog API (no auth needed). Deezer is a
 * metadata + link-out source only (its ToS bars exposing audio), so a track maps
 * to title + cover + a deezer.com link, never a stream. Owns pagination, HTTP-429
 * backoff, and Deezer's quirk of signalling quota errors in the BODY (code 4)
 * with HTTP 200. A factory with injectable fetch/sleep for deterministic tests.
 */

import { httpGetJson } from '@/lib/http'

const API_BASE = 'https://api.deezer.com'

/** The shape the tracks sync consumes (one Deezer track). */
export type DeezerTrackInput = {
  deezer_id: string
  title: string
  cover_url: string | null
  provider_url: string | null
  /** Track length in ms (Deezer reports seconds; we normalize). Cross-platform match key. */
  duration_ms: number | null
}

type DeezerTrack = { id: number; title: string; link?: string; duration?: number; album?: { cover_medium?: string } }
type DeezerError = { code: number; type: string; message: string }
type DeezerPage = { data?: DeezerTrack[]; next?: string | null; error?: DeezerError }

type Options = {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  /** Hard cap on `next`-cursor pages, so a looping cursor can't spin forever. */
  maxPages?: number
}

export function createDeezerClient(opts: Options = {}) {
  // No credentials: Deezer's public catalog API needs none (see header).
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const maxPages = opts.maxPages ?? 50

  function apiGet(pathOrUrl: string): Promise<DeezerPage> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : API_BASE + pathOrUrl
    return httpGetJson<DeezerPage>(url, {
      fetchImpl: doFetch,
      sleep,
      maxRetries,
      provider: 'Deezer',
      // Deezer returns quota exhaustion in the body (code 4) with HTTP 200.
      onBody: (body) => {
        const err = (body as DeezerPage).error
        if (err?.code === 4) return 'retry'
        if (err) throw new Error(`Deezer API error: ${err.message}`)
      },
    })
  }

  /** Follow `next` cursors and concatenate every page's tracks. Bounded by
   *  maxPages and a seen-URL guard so a self-referential cursor can't loop. */
  async function getAllPages(firstPath: string): Promise<DeezerTrack[]> {
    const items: DeezerTrack[] = []
    const seen = new Set<string>()
    let url: string | null = firstPath
    let pages = 0
    while (url && pages < maxPages && !seen.has(url)) {
      seen.add(url)
      pages++
      const page = await apiGet(url)
      items.push(...(page.data ?? []))
      url = page.next ?? null
    }
    return items
  }

  /** The artist's top tracks as a flat, title-deduped list (link-out only). */
  async function getArtistTracks(artistId: string): Promise<DeezerTrackInput[]> {
    const tracks = await getAllPages(`/artist/${encodeURIComponent(artistId)}/top?limit=100`)
    const seen = new Set<string>()
    const out: DeezerTrackInput[] = []
    for (const t of tracks) {
      const key = t.title.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        deezer_id: String(t.id),
        title: t.title,
        cover_url: t.album?.cover_medium ?? null,
        provider_url: t.link ?? null,
        duration_ms: t.duration != null ? t.duration * 1000 : null,
      })
    }
    return out
  }

  return { getArtistTracks }
}

export type DeezerClient = ReturnType<typeof createDeezerClient>
