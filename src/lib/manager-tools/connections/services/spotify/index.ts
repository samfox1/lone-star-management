/** Spotify: link + sync. The artist link is pasted, and the artist id inside it pulls the
 *  catalog (Music). See README.md. */
import { grab, type Service } from '../service'

export const spotify: Service = {
  slug: 'spotify',
  social: {
    key: 'spotify',
    method: { kind: 'link' },
    // `open.spotify.com/artist/<id>`, with or without a locale (`intl-de/`). A playlist is not an artist.
    idFromUrl: (url) => grab(url, /open\.spotify\.com\/(?:intl-[a-z]+\/)?artist\/([A-Za-z0-9]+)/),
  },
  source: { key: 'spotify', label: 'Spotify', section: 'music', idField: 'spotify_artist_id', placeholder: 'Spotify artist ID', pullLabel: 'Pull from Spotify' },
}
