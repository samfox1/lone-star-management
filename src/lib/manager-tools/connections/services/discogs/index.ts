/** Discogs: identity only, by artist link (`discogs.com/artist/<id>-<name>`). It feeds the
 *  site's fact card (`sameAs`) and is never a site button (the bridge's `identityOnly`).
 *  See README.md. */
import { grab, type Service } from '../service'

/** `/artist/<id>` or `/artist/<id>-<name>`, under an optional language path (`/de/`,
 *  `/pt_BR/`). The numeric id is what the API reads; the name after it is decoration. */
const ARTIST_PATH = '(?:/[a-z]{2}(?:_[A-Z]{2})?)?/artist/(\\d+)(?:-[^/?#]*)?/?'

export const discogs: Service = {
  slug: 'discogs',
  social: {
    key: 'discogs',
    // Only an ARTIST page: a release, a master or a label page is not who the artist is.
    method: { kind: 'link', path: new RegExp(`^${ARTIST_PATH}$`), pathNoun: 'artist' },
    idFromUrl: (url) => grab(url, new RegExp(`^https?://(?:[a-z0-9-]+\\.)*discogs\\.com${ARTIST_PATH}(?:[?#]|$)`, 'i')),
  },
}
