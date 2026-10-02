/**
 * deezerClient — reads Deezer's PUBLIC catalog API (no auth needed). Deezer is a
 * metadata + link-out source only (its ToS bars exposing audio), so a track maps
 * to title + cover + a deezer.com link, never a stream. Owns pagination, HTTP-429
 * backoff, and Deezer's quirk of signalling quota errors in the BODY (code 4)
 * with HTTP 200. A factory with injectable fetch/sleep for deterministic tests.
 *
 * THE DISCOGRAPHY WALK (2026-09-28). The pull used to read `/artist/{id}/top`. Measured
 * against the live API that day, `top` returned ONE track for an artist with six releases
 * and ZERO for artists with eight and nineteen: it ranks popularity, and the artists this
 * app serves barely register. Grouping songs into releases (Sam: Deezer songs get grouped
 * into albums, EPs and singles like Spotify's) needs every release's songs, so the client
 * now walks the catalog the way Spotify's pull does — the artist's releases, then each
 * release's tracks — and every song carries the release it came from.
 *
 * REQUEST BUDGET. One albums request (paged) plus one tracks request per release: an
 * artist with 19 releases costs 20 requests. Deezer's quota is per-window, and a hit
 * arrives as `{ error: { code: 4 } }` with HTTP 200; `onBody` backs off and retries it
 * like a 429 (lib/http). Compilations are skipped before their tracks are requested.
 */

import { httpGetJson } from '@/lib/http'
import { classifyRelease, type CatalogReleaseRef, type PlatformReleaseKind } from '@/lib/sync-match'

const API_BASE = 'https://api.deezer.com'

/** The shape the tracks sync consumes (one Deezer track). */
export type DeezerTrackInput = {
  deezer_id: string
  title: string
  cover_url: string | null
  /** Parent album's title. The sync writes it as an enrichment field, and the match reads
   *  it to pair a single's copy with the single (lib/sync-match). */
  album_name: string | null
  provider_url: string | null
  /** Track length in ms (Deezer reports seconds; we normalize). Cross-platform match key. */
  duration_ms: number | null
  /** The release this song came from. Absent = not grouped (older callers/fixtures). */
  release?: CatalogReleaseRef | null
}

/** One entry of `/artist/{id}/albums` (only the fields we read). */
type DeezerAlbum = {
  id: number
  title?: string
  link?: string
  cover_medium?: string
  cover_big?: string
  release_date?: string
  /** 'album' | 'ep' | 'single' | 'compile' — Deezer names the type explicitly. */
  record_type?: string
}
/** One entry of `/album/{id}/tracks`. */
type DeezerTrack = {
  id: number
  title: string
  link?: string
  duration?: number
}
type DeezerError = { code: number; type: string; message: string }
type DeezerPage<T> = { data?: T[]; next?: string | null; error?: DeezerError }

type Options = {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  /** Hard cap on `next`-cursor pages per list, so a looping cursor can't spin forever. */
  maxPages?: number
}

/**
 * Deezer's `record_type` → our kind. 'compile' is null: a compilation is not the artist's
 * own release, and Spotify's pull (only the `album,single` groups) never takes one either.
 * A type Deezer did not name falls back to Spotify's rule — the count decides.
 */
function deezerKind(recordType: string | undefined): PlatformReleaseKind | null {
  if (recordType === 'compile') return null
  if (recordType === 'album' || recordType === 'ep' || recordType === 'single') return recordType
  return 'single-or-ep'
}

/** Deezer dates are YYYY-MM-DD, with "0000-00-00" for unknown. */
function deezerDate(d: string | undefined): string | null {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.startsWith('0000') ? d : null
}

export function createDeezerClient(opts: Options = {}) {
  // No credentials: Deezer's public catalog API needs none (see header).
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const maxPages = opts.maxPages ?? 50

  function apiGet<T>(pathOrUrl: string): Promise<DeezerPage<T>> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : API_BASE + pathOrUrl
    return httpGetJson<DeezerPage<T>>(url, {
      fetchImpl: doFetch,
      sleep,
      maxRetries,
      provider: 'Deezer',
      // Deezer returns quota exhaustion in the body (code 4) with HTTP 200.
      onBody: (body) => {
        const err = (body as DeezerPage<T>).error
        if (err?.code === 4) return 'retry'
        if (err) throw new Error(`Deezer API error: ${err.message}`)
      },
    })
  }

  /** Follow `next` cursors and concatenate every page's items. Bounded by
   *  maxPages and a seen-URL guard so a self-referential cursor can't loop. */
  async function getAllPages<T>(firstPath: string): Promise<T[]> {
    const items: T[] = []
    const seen = new Set<string>()
    let url: string | null = firstPath
    let pages = 0
    while (url && pages < maxPages && !seen.has(url)) {
      seen.add(url)
      pages++
      const page: DeezerPage<T> = await apiGet<T>(url)
      items.push(...(page.data ?? []))
      url = page.next ?? null
    }
    return items
  }

  /**
   * Every song on the artist's own releases (albums, EPs, singles), each carrying the
   * release it came from. ONE ROW PER RELEASE (Sam, 2026-09-11): a single that is also an
   * album track comes through twice, once per release — Deezer gives each copy its own id.
   * Only a literal repeat of one track id is dropped. (This used to de-dupe by lowercased
   * title, which handed the album's copy to whichever release came first.)
   */
  async function getArtistTracks(artistId: string): Promise<DeezerTrackInput[]> {
    const albums = await getAllPages<DeezerAlbum>(`/artist/${encodeURIComponent(artistId)}/albums?limit=100`)
    const seen = new Set<number>()
    const out: DeezerTrackInput[] = []
    for (const album of albums) {
      const kind = deezerKind(album.record_type)
      if (!kind) continue
      const tracks = await getAllPages<DeezerTrack>(`/album/${encodeURIComponent(String(album.id))}/tracks?limit=100`)
      const cover = album.cover_big ?? album.cover_medium ?? null
      const release: CatalogReleaseRef = {
        id: String(album.id),
        title: album.title ?? '',
        release_type: classifyRelease(kind, tracks.length),
        cover_url: cover,
        release_date: deezerDate(album.release_date),
        url: album.link ?? null,
      }
      for (const t of tracks) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        out.push({
          deezer_id: String(t.id),
          title: t.title,
          album_name: album.title ?? null,
          cover_url: cover,
          provider_url: t.link ?? null,
          duration_ms: t.duration != null ? t.duration * 1000 : null,
          release,
        })
      }
    }
    return out
  }

  return { getArtistTracks }
}
