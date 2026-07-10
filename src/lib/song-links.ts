/**
 * Streaming-link handling for the add-song flow: map pasted service URLs onto
 * the union-model columns, and RESOLVE the song's metadata (title, cover,
 * contributors) from the service so the manager never types what the platform
 * already knows. Resolution is best-effort per service, tried richest-first:
 *   Deezer (public API: title + contributors + cover) → Spotify (oEmbed: title
 *   + cover) → Apple (iTunes lookup: title + cover) → SoundCloud (oEmbed:
 *   title + cover). Injectable fetch for deterministic tests.
 */

export const STREAMING_SERVICES = [
  { key: 'spotify', label: 'Spotify', placeholder: 'https://open.spotify.com/track/…' },
  { key: 'apple', label: 'Apple Music', placeholder: 'https://music.apple.com/…' },
  { key: 'soundcloud', label: 'SoundCloud', placeholder: 'https://soundcloud.com/…' },
  { key: 'deezer', label: 'Deezer', placeholder: 'https://www.deezer.com/track/…' },
] as const

export type StreamingUrls = Partial<Record<(typeof STREAMING_SERVICES)[number]['key'], string>>

/**
 * Map pasted service URLs onto the union-model columns: Spotify/Deezer ids
 * parse out of their URLs (badges/links rebuild from ids); Apple + SoundCloud
 * store the URL itself. Unknown-shaped URLs still save to their URL column.
 */
export function parseStreamingLinks(urls: StreamingUrls): Record<string, string> {
  const out: Record<string, string> = {}
  const spotify = urls.spotify?.trim()
  if (spotify) {
    out.stream_url = spotify
    const id = spotify.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/)?.[1]
    if (id) out.spotify_id = id
  }
  const apple = urls.apple?.trim()
  if (apple) {
    out.apple_url = apple
    const id = appleTrackId(apple)
    if (id) out.apple_id = id
  }
  const soundcloud = urls.soundcloud?.trim()
  if (soundcloud) out.soundcloud_url = soundcloud
  const deezer = urls.deezer?.trim()
  if (deezer) {
    out.provider_url = deezer
    const id = deezer.match(/deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/)?.[1]
    if (id) out.deezer_id = id
  }
  return out
}

export type ResolvedSong = { title: string; cover_url: string | null; contributors: string[] }

/** Apple track id from a music.apple.com URL: album deep-link `?i=<id>` or a /song/ path. */
function appleTrackId(url: string): string | null {
  return url.match(/[?&]i=(\d+)/)?.[1] ?? url.match(/\/song\/[^/]*\/(\d+)/)?.[1] ?? null
}

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T | null> {
  try {
    const res = await fetchImpl(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * The song's metadata from the first service that answers. Throws a friendly
 * error when nothing resolves — the caller should tell the manager to check
 * the links.
 */
export async function resolveStreamingSong(
  urls: StreamingUrls,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedSong> {
  // Deezer — richest: title, contributor list (first entry = the main artist), cover.
  const deezerId = urls.deezer?.match(/deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/)?.[1]
  if (deezerId) {
    const t = await getJson<{
      title?: string
      album?: { cover_medium?: string }
      contributors?: { name: string }[]
    }>(fetchImpl, `https://api.deezer.com/track/${deezerId}`)
    if (t?.title) {
      return {
        title: t.title,
        cover_url: t.album?.cover_medium ?? null,
        contributors: (t.contributors ?? []).slice(1).map((c) => c.name),
      }
    }
  }

  // Spotify — public oEmbed: title + thumbnail (no credentials).
  const spotify = urls.spotify?.trim()
  if (spotify) {
    const o = await getJson<{ title?: string; thumbnail_url?: string }>(
      fetchImpl,
      `https://open.spotify.com/oembed?url=${encodeURIComponent(spotify)}`,
    )
    if (o?.title) return { title: o.title, cover_url: o.thumbnail_url ?? null, contributors: [] }
  }

  // Apple — free iTunes lookup by track id.
  const appleId = urls.apple ? appleTrackId(urls.apple) : null
  if (appleId) {
    const r = await getJson<{ results?: { trackName?: string; artworkUrl100?: string }[] }>(
      fetchImpl,
      `https://itunes.apple.com/lookup?id=${appleId}`,
    )
    const hit = r?.results?.[0]
    if (hit?.trackName) {
      return {
        title: hit.trackName,
        cover_url: hit.artworkUrl100?.replace('100x100', '600x600') ?? null,
        contributors: [],
      }
    }
  }

  // SoundCloud — public oEmbed: title ("Title by Author") + thumbnail.
  const soundcloud = urls.soundcloud?.trim()
  if (soundcloud) {
    const o = await getJson<{ title?: string; thumbnail_url?: string; author_name?: string }>(
      fetchImpl,
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(soundcloud)}`,
    )
    if (o?.title) {
      // oEmbed title is "Track by Author". A greedy strip on the FIRST " by "
      // mangles titles that themselves contain " by "; strip the exact
      // " by <author_name>" suffix when we have it, else the LAST " by ".
      let title = o.title
      const suffix = o.author_name ? ` by ${o.author_name}` : null
      if (suffix && title.endsWith(suffix)) {
        title = title.slice(0, -suffix.length)
      } else {
        const at = title.lastIndexOf(' by ')
        if (at > 0) title = title.slice(0, at)
      }
      return { title, cover_url: o.thumbnail_url ?? null, contributors: [] }
    }
  }

  throw new Error("Couldn't read the song's details from those links — check them and try again.")
}
