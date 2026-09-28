/** YouTube Music: link only, by artist link. Its own site has no handle scheme — the
 *  artist page is a channel-id link, same id as the regular YouTube channel underneath it.
 *  See README.md. */
import type { Service } from '../service'

export const youtubeMusic: Service = {
  slug: 'youtube-music',
  social: { key: 'youtube music', method: { kind: 'link' } },
}
