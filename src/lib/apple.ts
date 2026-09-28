/**
 * appleMusicClient — reads public catalog data from the FREE iTunes Search API
 * (no key, no developer token). Apple Music's authenticated MusicKit API needs a
 * paid membership; the iTunes `lookup` endpoint returns the same catalog metadata
 * (title, album, artwork, duration, store link) for free. Apple is a metadata +
 * link-out source here (no hosted/downloadable audio).
 *
 * RELEASES (2026-09-28). Every song row already names its collection (id, name, link,
 * artwork, a per-song date), so the release each song belongs to costs no extra request:
 * it rides on the song as `release`, and the sync folds songs back into releases
 * (`groupReleases`, lib/sync-match).
 *
 * A factory with injectable fetch/sleep so tests exercise the mapping / 429
 * backoff without hitting the network.
 */
import { httpGetJson } from '@/lib/http'
import { classifyRelease, type CatalogReleaseRef, type PlatformReleaseKind } from '@/lib/sync-match'

const API_BASE = 'https://itunes.apple.com'

/** The shape the tracks sync consumes (one Apple Music / iTunes song). */
export type AppleTrackInput = {
  apple_id: string
  title: string
  /** The collection's name with Apple's " - Single" / " - EP" decoration removed. */
  album_name: string | null
  cover_url: string | null
  provider_url: string | null
  duration_ms: number | null
  /** The artist's own release this song came from, or null (a compilation, an
   *  appearance on someone else's record, no collection). Absent = not grouped. */
  release?: CatalogReleaseRef | null
}

/** One iTunes Search result row (only the fields we read; the API returns more). */
type ITunesResult = {
  wrapperType?: string
  kind?: string
  artistId?: number
  artistName?: string
  trackId?: number
  trackName?: string
  collectionId?: number
  collectionName?: string
  /** Set only when the collection is credited to someone other than the song's artist:
   *  a Various Artists compilation carries its id, an appearance only a name. */
  collectionArtistId?: number
  collectionArtistName?: string
  collectionViewUrl?: string
  artworkUrl100?: string
  trackViewUrl?: string
  trackTimeMillis?: number
  /** ISO timestamp — the SONG's date (see groupReleases on why the album takes the max). */
  releaseDate?: string
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

/**
 * Apple's store names every non-album release "<title> - Single" or "<title> - EP". That
 * suffix is Apple's explicit release type (a song row has no type field), and it is
 * decoration, not the title: Spotify and Deezer call the same record plain "<title>".
 * An unsuffixed collection is an album. Only a suffix at the very END counts.
 */
export function appleCollection(name: string): { title: string; kind: PlatformReleaseKind } {
  const m = /^(.*\S)\s+-\s+(Single|EP)$/.exec(name)
  if (!m) return { title: name, kind: 'album' }
  return { title: m[1], kind: m[2] === 'EP' ? 'ep' : 'single' }
}

/**
 * Is this song's collection the artist's OWN release? Mirrors Spotify's pull, which asks
 * only for the artist's `album,single` groups — never compilations or appearances.
 *  - a Various Artists compilation names another collection artist by id;
 *  - an appearance on someone else's album names another collection credit, on a song
 *    by another artist id ("Paula Fuga & Jack Johnson" on Paula Fuga's album).
 * A joint credit that includes the artist ("TSG: AP! & Skeen") has its own artist id but
 * no other collection credit — it IS theirs, and Spotify lists it among their singles.
 */
function ownCollection(r: ITunesResult, artistId: string): boolean {
  if (r.collectionArtistId != null && String(r.collectionArtistId) !== artistId) return false
  if (r.collectionArtistName != null && r.collectionArtistName !== r.artistName && String(r.artistId) !== artistId) return false
  return true
}

/** The album's own page: a song's collectionViewUrl points INTO it (`?i=<track>&uo=4`). */
function collectionUrl(url: string | undefined): string | null {
  return url ? url.split('?')[0] : null
}

/** An ISO timestamp's calendar date, or null for anything else. */
function isoDate(d: string | undefined): string | null {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null
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

  function map(r: ITunesResult, artistId: string): AppleTrackInput {
    const collection = r.collectionName != null ? appleCollection(r.collectionName) : null
    const cover = upsizeArtwork(r.artworkUrl100)
    return {
      apple_id: String(r.trackId),
      title: r.trackName ?? '',
      album_name: collection?.title ?? null,
      cover_url: cover,
      provider_url: r.trackViewUrl ?? null,
      duration_ms: r.trackTimeMillis ?? null,
      release:
        r.collectionId != null && collection && ownCollection(r, artistId)
          ? {
              id: String(r.collectionId),
              title: collection.title,
              // Apple's suffix is explicit, so the count never decides (classifyRelease).
              release_type: classifyRelease(collection.kind, null),
              cover_url: cover,
              release_date: isoDate(r.releaseDate),
              url: collectionUrl(r.collectionViewUrl),
            }
          : null,
    }
  }

  /**
   * The artist's songs via the free iTunes `lookup` endpoint. `lookup` returns the
   * artist row first, then their songs — we drop the artist and keep the tracks.
   * One request (no cursor paging); `limit` caps the result set at iTunes' max 200.
   * Each song carries the release it belongs to (see the header).
   */
  async function getArtistTracks(artistId: string): Promise<AppleTrackInput[]> {
    const path =
      `/lookup?id=${encodeURIComponent(artistId)}` +
      `&entity=song&limit=${limit}&country=${encodeURIComponent(country)}`
    const page = await apiGet(path)
    return (page.results ?? [])
      .filter((r) => r.trackId != null && (r.wrapperType === 'track' || r.kind === 'song'))
      .map((r) => map(r, artistId))
  }

  return { getArtistTracks }
}

export type AppleMusicClient = ReturnType<typeof createAppleMusicClient>
