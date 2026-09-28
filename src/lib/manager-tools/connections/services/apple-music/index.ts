/** Apple Music: link + sync. The artist link is pasted, and the artist id inside it pulls
 *  the catalog (Music). See README.md. */
import { grab, type Service } from '../service'

export const appleMusic: Service = {
  slug: 'apple-music',
  social: {
    key: 'apple music',
    method: { kind: 'link' },
    // `music.apple.com/<cc>/artist/<name>/<digits>`; the country and the name are both optional.
    idFromUrl: (url) => grab(url, /music\.apple\.com\/(?:[a-z]{2}\/)?artist\/(?:[^/]+\/)?(\d+)/),
  },
  source: { key: 'apple', label: 'Apple Music', section: 'music', idField: 'apple_artist_id', placeholder: 'Apple Music artist ID', pullLabel: 'Pull from Apple Music' },
}
