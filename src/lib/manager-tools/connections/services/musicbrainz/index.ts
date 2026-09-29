/** MusicBrainz: identity only, by artist link (`musicbrainz.org/artist/<mbid>`). It feeds the
 *  site's fact card (`sameAs`) and is never a site button (the bridge's `identityOnly`). No
 *  one has it yet, so its Connect row can open MusicBrainz's own artist editor pre-filled
 *  (`seed.ts`). See README.md. */
import { grab, type Service } from '../service'

/** An MBID: a UUID, as MusicBrainz writes it (lowercase hex; either case read). */
const MBID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export const musicbrainz: Service = {
  slug: 'musicbrainz',
  social: {
    key: 'musicbrainz',
    // Only an ARTIST page: a release, a search or `/artist/create` is not who the artist is.
    method: { kind: 'link', path: new RegExp(`^/artist/${MBID}/?$`, 'i'), pathNoun: 'artist' },
    // Anchored on the host, so a `musicbrainz.org/artist/…` inside another site's path is nobody's.
    idFromUrl: (url) => grab(url, new RegExp(`^https?://(?:[a-z0-9-]+\\.)*musicbrainz\\.org/artist/(${MBID})/?(?:[?#]|$)`, 'i')),
  },
}
