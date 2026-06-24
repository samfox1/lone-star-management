/**
 * deezerClient — reads Deezer's PUBLIC catalog API (no auth needed). Deezer is a
 * metadata + link-out source only (its ToS bars exposing audio), so a track maps
 * to title + cover + a deezer.com link, never a stream. Owns pagination, HTTP-429
 * backoff, and Deezer's quirk of signalling quota errors in the BODY (code 4)
 * with HTTP 200. A factory with injectable fetch/sleep for deterministic tests.
 */

const API_BASE = 'https://api.deezer.com'

/** The shape the tracks sync consumes (one Deezer track). */
export type DeezerTrackInput = {
  deezer_id: string
  title: string
  cover_url: string | null
  provider_url: string | null
}

type DeezerTrack = { id: number; title: string; link?: string; album?: { cover_medium?: string } }
type DeezerError = { code: number; type: string; message: string }
type DeezerPage = { data?: DeezerTrack[]; next?: string | null; error?: DeezerError }

type Options = {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

export function createDeezerClient(opts: Options = {}) {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3

  async function apiGet(pathOrUrl: string): Promise<DeezerPage> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : API_BASE + pathOrUrl
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await doFetch(url)
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '1')
        await sleep(retryAfter * 1000)
        continue
      }
      if (!res.ok) throw new Error(`Deezer API error ${res.status} for ${url}`)

      const body = (await res.json()) as DeezerPage
      // Deezer returns quota exhaustion in the body (code 4) with HTTP 200.
      if (body.error) {
        if (body.error.code === 4) {
          await sleep(1000)
          continue
        }
        throw new Error(`Deezer API error: ${body.error.message}`)
      }
      return body
    }
    throw new Error(`Deezer API rate-limited after ${maxRetries} retries: ${pathOrUrl}`)
  }

  /** Follow `next` cursors and concatenate every page's tracks. */
  async function getAllPages(firstPath: string): Promise<DeezerTrack[]> {
    const items: DeezerTrack[] = []
    let url: string | null = firstPath
    while (url) {
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
      })
    }
    return out
  }

  return { getArtistTracks }
}

export type DeezerClient = ReturnType<typeof createDeezerClient>
