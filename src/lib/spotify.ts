/**
 * spotifyClient — reads public catalog data via the Client Credentials flow
 * (an app token, no user login). Owns token fetch + reuse, 429 backoff/retry,
 * pagination, and error shaping, so routes/sync jobs never touch raw fetch.
 *
 * A factory (not a singleton) so each caller — and each test — gets isolated
 * token state; fetch and sleep are injectable for deterministic tests.
 */

import { httpGetJson } from '@/lib/http'
import { type ReleaseType } from '@/lib/releases'

const ACCOUNTS_URL = 'https://accounts.spotify.com/api/token'
const API_BASE = 'https://api.spotify.com/v1'

/** The shape the tracks sync consumes (one Spotify track). */
export type SpotifyTrackInput = {
  spotify_id: string
  title: string
  cover_url: string | null
  stream_url: string | null
  /** Collaborators on the track, primary artist excluded. */
  featured_artists: string[]
  /** Title of the release (album / EP / single) the track belongs to. */
  album_name: string | null
  /** Track length in ms — cross-platform match key + display. */
  duration_ms: number | null
}

/** The shape the releases sync consumes (one Spotify album/EP/single). */
export type SpotifyReleaseInput = {
  spotify_id: string
  title: string
  release_type: ReleaseType
  cover_url: string | null
  /** Normalized to YYYY-MM-DD (Spotify may give year/month precision). */
  release_date: string | null
  /** The album's Spotify page — seeds one DSP link on the smart-link. */
  spotify_url: string | null
  /** Member track Spotify ids, for linking tracks.release_id. */
  track_spotify_ids: string[]
}

type SpotifyAlbum = {
  id: string
  name?: string
  album_type?: string
  release_date?: string
  total_tracks?: number
  images?: { url: string }[]
  external_urls?: { spotify?: string }
}
type SpotifyAlbumTrack = {
  id: string
  name: string
  duration_ms?: number
  external_urls?: { spotify?: string }
  artists?: { id: string; name: string }[]
}

type Options = {
  clientId?: string
  clientSecret?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

export function createSpotifyClient(opts: Options = {}) {
  const clientId = opts.clientId ?? process.env.SPOTIFY_CLIENT_ID
  const clientSecret = opts.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3

  let token: string | null = null
  let tokenExpiresAt = 0

  async function getAccessToken(): Promise<string> {
    if (token && Date.now() < tokenExpiresAt) return token
    if (!clientId || !clientSecret) {
      throw new Error('Spotify credentials not configured (SPOTIFY_CLIENT_ID/SECRET).')
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await doFetch(ACCOUNTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new Error(`Spotify auth failed (${res.status}).`)
    const data = (await res.json()) as { access_token: string; expires_in: number }
    token = data.access_token
    // Refresh a minute early to avoid races near expiry.
    tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000
    return token
  }

  /** GET a path or absolute URL, retrying on 429 with Retry-After backoff. */
  function apiGet<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : API_BASE + pathOrUrl
    return httpGetJson<T>(url, {
      fetchImpl: doFetch,
      sleep,
      maxRetries,
      provider: 'Spotify',
      headers: async () => ({ Authorization: `Bearer ${await getAccessToken()}` }),
    })
  }

  /** Follow `next` cursors and concatenate every page's items. */
  async function getAllPages<T>(firstPath: string): Promise<T[]> {
    const items: T[] = []
    let url: string | null = firstPath
    while (url) {
      const page: { items: T[]; next: string | null } = await apiGet(url)
      items.push(...page.items)
      url = page.next
    }
    return items
  }

  // Note: no `limit` param — Spotify rejects it (400 "Invalid limit") for apps
  // in Development mode. Default page size + `next` pagination works in both
  // modes, so we let the API default and follow cursors.
  function getArtistAlbums(artistId: string): Promise<SpotifyAlbum[]> {
    return getAllPages<SpotifyAlbum>(
      `/artists/${artistId}/albums?include_groups=album,single`,
    )
  }

  function getAlbumTracks(albumId: string): Promise<SpotifyAlbumTrack[]> {
    return getAllPages<SpotifyAlbumTrack>(`/albums/${albumId}/tracks`)
  }

  /** album_type + track count → our release type (Spotify has no 'ep' group). */
  function classifyRelease(album: SpotifyAlbum): ReleaseType {
    if (album.album_type === 'album') return 'album'
    return (album.total_tracks ?? 1) >= 4 ? 'ep' : 'single'
  }

  /** Spotify release_date is year / year-month / full — pad to a valid DATE. */
  function normalizeDate(d: string | undefined): string | null {
    if (!d) return null
    if (/^\d{4}$/.test(d)) return `${d}-01-01`
    if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`
    return d
  }

  /**
   * Pull the artist's discography as a de-duplicated track list PLUS the releases
   * (albums/EPs/singles) they belong to — one albums+tracks fetch feeds both.
   * Tracks that appear on multiple releases collapse to the first seen (keyed by
   * lowercased title), so a track links to whichever release's version was kept.
   */
  async function getDiscography(
    artistId: string,
  ): Promise<{ tracks: SpotifyTrackInput[]; releases: SpotifyReleaseInput[] }> {
    const albums = await getArtistAlbums(artistId)
    const seen = new Set<string>()
    const tracks: SpotifyTrackInput[] = []
    const releases: SpotifyReleaseInput[] = []
    for (const album of albums) {
      const albumTracks = await getAlbumTracks(album.id)
      releases.push({
        spotify_id: album.id,
        title: album.name ?? '',
        release_type: classifyRelease(album),
        cover_url: album.images?.[0]?.url ?? null,
        release_date: normalizeDate(album.release_date),
        spotify_url: album.external_urls?.spotify ?? null,
        track_spotify_ids: albumTracks.map((t) => t.id),
      })
      for (const t of albumTracks) {
        const key = t.name.trim().toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        tracks.push({
          spotify_id: t.id,
          title: t.name,
          stream_url: t.external_urls?.spotify ?? null,
          cover_url: album.images?.[0]?.url ?? null,
          // Everyone on the track except the artist we're syncing (matched by
          // Spotify id, so it's robust to name variants / remixes).
          featured_artists: (t.artists ?? []).filter((a) => a.id !== artistId).map((a) => a.name),
          album_name: album.name ?? null,
          duration_ms: t.duration_ms ?? null,
        })
      }
    }
    return { tracks, releases }
  }

  /** Tracks-only convenience (the catalog-only path). */
  async function getDiscographyTracks(artistId: string): Promise<SpotifyTrackInput[]> {
    return (await getDiscography(artistId)).tracks
  }

  return { getAccessToken, getArtistAlbums, getAlbumTracks, getDiscography, getDiscographyTracks }
}

export type SpotifyClient = ReturnType<typeof createSpotifyClient>
