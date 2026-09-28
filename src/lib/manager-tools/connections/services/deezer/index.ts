/** Deezer: link + sync. The artist link is pasted, and the artist id inside it pulls the
 *  catalog (Music). See README.md. */
import { grab, type Service } from '../service'

export const deezer: Service = {
  slug: 'deezer',
  social: {
    key: 'deezer',
    method: { kind: 'link' },
    // `deezer.com/<lang>/artist/<digits>`; the language is optional.
    idFromUrl: (url) => grab(url, /deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/),
  },
  source: { key: 'deezer', label: 'Deezer', section: 'music', idField: 'deezer_artist_id', placeholder: 'Deezer artist ID', pullLabel: 'Pull from Deezer' },
}
