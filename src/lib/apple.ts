/**
 * appleMusicClient — reads public catalog data from the FREE iTunes Search API
 * (no key, no developer token). Apple Music's authenticated MusicKit API needs a
 * paid membership; the iTunes `lookup` endpoint returns the same catalog metadata
 * (title, album, artwork, duration, store link) for free. Apple is a metadata +
 * link-out source here (no hosted/downloadable audio).
 *
 * A factory with injectable fetch/sleep so tests exercise the mapping / 429
 * backoff without hitting the network.
 */
import { httpGetJson } from '@/lib/http'

const API_BASE = 'https://itunes.apple.com'

/** The shape the tracks sync consumes (one Apple Music / iTunes song). */
export type AppleTrackInput = {
  apple_id: string
  title: string
  album_name: string | null
  cover_url: string | null
  provider_url: string | null
  duration_ms: number | null
}

/** One iTunes Search result row (only the fields we read; the API returns more). */
type ITunesResult = {
  wrapperType?: string
  kind?: string
  trackId?: number
  trackName?: string
  collectionName?: string
  artworkUrl100?: string
  trackViewUrl?: string
  trackTimeMillis?: number
}
type ITunesResponse = { resultCount?: number; results?: ITunesResult[] }

type Options = {
  /** iTunes storefront country (e.g. 'us'). */
  country?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  /** Max songs to pull in one lookup (iTunes caps at 200). */
  limit?: number
}

/** iTunes artwork is served sized (…/100x100bb.jpg); request a larger square. */
function upsizeArtwork(url: string | undefined, px = 600): string | null {
  if (!url) return null
  return url.replace(/\/\d+x\d+bb\.(jpg|png)/, `/${px}x${px}bb.$1`)
}

export function createAppleMusicClient(opts: Options = {}) {
  const country = opts.country ?? process.env.APPLE_STOREFRONT ?? 'us'
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const limit = Math.min(opts.limit ?? 200, 200)

  function apiGet(path: string): Promise<ITunesResponse> {
    return httpGetJson<ITunesResponse>(API_BASE + path, {
      fetchImpl: doFetch,
      sleep,
      maxRetries,
      provider: 'Apple Music',
    })
  }

  function map(r: ITunesResult): AppleTrackInput {
    return {
      apple_id: String(r.trackId),
      title: r.trackName ?? '',
      album_name: r.collectionName ?? null,
      cover_url: upsizeArtwork(r.artworkUrl100),
      provider_url: r.trackViewUrl ?? null,
      duration_ms: r.trackTimeMillis ?? null,
    }
  }

  /**
   * The artist's songs via the free iTunes `lookup` endpoint. `lookup` returns the
   * artist row first, then their songs — we drop the artist and keep the tracks.
   * One request (no cursor paging); `limit` caps the result set at iTunes' max 200.
   */
  async function getArtistTracks(artistId: string): Promise<AppleTrackInput[]> {
    const path =
      `/lookup?id=${encodeURIComponent(artistId)}` +
      `&entity=song&limit=${limit}&country=${encodeURIComponent(country)}`
    const page = await apiGet(path)
    return (page.results ?? [])
      .filter((r) => r.trackId != null && (r.wrapperType === 'track' || r.kind === 'song'))
      .map(map)
  }

  return { getArtistTracks }
}

export type AppleMusicClient = ReturnType<typeof createAppleMusicClient>
