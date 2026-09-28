/** Eventbrite: link only, by organizer profile link. Eventbrite issues two real profile
 *  shapes — `eventbrite.com/o/<slug>-<id>` and a custom `<name>.eventbrite.com` subdomain
 *  — inconsistent enough that there is no one clean handle, so (like Spotify/Tidal) the
 *  manager pastes the link as-is. The numeric organizer id inside the `/o/` shape is read
 *  out for a future sync (Eventbrite's API needs that id, not the slug). See README.md. */
import { grab, type Service } from '../service'

export const eventbrite: Service = {
  slug: 'eventbrite',
  social: {
    key: 'eventbrite',
    method: { kind: 'link' },
    // `eventbrite.<tld>/o/<slug->?<id>` — the slug is optional, the trailing digits are
    // the organizer id a future sync would need. Anchored on the HOST (`[a-z.]+` takes a
    // country TLD, `eventbrite.co.uk`), so an `eventbrite.com/o/…` in another site's path
    // is nobody's id.
    idFromUrl: (url) => grab(url, /^https?:\/\/(?:[a-z0-9-]+\.)*eventbrite\.[a-z.]+\/o\/(?:[a-z0-9-]*-)?(\d+)(?:[/?#]|$)/i),
  },
}
