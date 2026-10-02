/** YouTube: link + sync, by handle (`youtube.com/@` [skeenmusic]); the channel's uploads
 *  pull into Videos. See README.md. */
import { at, type Service } from '../service'

export const youtube: Service = {
  slug: 'youtube',
  social: {
    key: 'youtube',
    method: {
      noun: 'handle',
      hosts: ['youtube.com', 'youtu.be'],
      rule: /^[A-Za-z0-9._-]{3,30}$/,
      example: 'skeenmusic',
      ...at('youtube.com'),
      // A channel link with no handle in it is still the channel: keep it, on the one host.
      fromPath: (segments) => {
        const [first, second] = segments
        if (first && ['channel', 'c', 'user'].includes(first) && second) return { url: `https://youtube.com/${first}/${second}` }
        return undefined
      },
    },
    // The link itself: `channelSelector` (lib/youtube) resolves any of its shapes
    // server-side, and guessing here would only duplicate that.
    idFromUrl: (url) => (/youtube\.com\//.test(url) ? url : null),
  },
  source: { key: 'youtube', label: 'YouTube', section: 'videos', idField: 'youtube_channel_id', placeholder: 'YouTube @handle, channel ID, or URL', pullLabel: 'Import uploads' },
}

/** "Connect with YouTube" (Google sign-in, `src/lib/youtube-oauth.ts`): where the button
 *  goes. Here, not in the OAuth file, because the Connect window is client code and that
 *  file is server-only (node:crypto). */
const YOUTUBE_START_PATH = '/api/youtube/start'

/** The button's address: the artist, and `sync=0` only when the manager switched Sync off. */
export function youtubeStartPath(artistId: string, sync: boolean): string {
  const q = new URLSearchParams({ artist: artistId })
  if (!sync) q.set('sync', '0')
  return `${YOUTUBE_START_PATH}?${q}`
}
