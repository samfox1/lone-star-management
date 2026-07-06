/**
 * spotifyClient — reads public catalog data via the Client Credentials flow
 * (an app token, no user login). Owns token fetch + reuse, 429 backoff/retry,
 * pagination, and error shaping, so routes/sync jobs never touch raw fetch.
 *
 * A factory (not a singleton) so each caller — and each test — gets isolated
 * token state; fetch and sleep are injectable for deterministic tests.
 */

import { httpGetJson } from '@/lib/http'

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
}

type SpotifyAlbum = { id: string; name?: string; images?: { url: string }[] }
type SpotifyAlbumTrack = {
  id: string
  name: string
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

  /**
   * Pull the artist's discography as a flat, de-duplicated track list. Tracks
   * that appear on multiple releases (album + single + compilation) collapse to
   * the first seen, keyed by lowercased title.
   */
  async function getDiscographyTracks(artistId: string): Promise<SpotifyTrackInput[]> {
    const albums = await getArtistAlbums(artistId)
    const seen = new Set<string>()
    const out: SpotifyTrackInput[] = []
    for (const album of albums) {
      const tracks = await getAlbumTracks(album.id)
      for (const t of tracks) {
        const key = t.name.trim().toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          spotify_id: t.id,
          title: t.name,
          stream_url: t.external_urls?.spotify ?? null,
          cover_url: album.images?.[0]?.url ?? null,
          // Everyone on the track except the artist we're syncing (matched by
          // Spotify id, so it's robust to name variants / remixes).
          featured_artists: (t.artists ?? [])
            .filter((a) => a.id !== artistId)
            .map((a) => a.name),
          album_name: album.name ?? null,
        })
      }
    }
    return out
  }

  return { getAccessToken, getArtistAlbums, getAlbumTracks, getDiscographyTracks }
}

export type SpotifyClient = ReturnType<typeof createSpotifyClient>
