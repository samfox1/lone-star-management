/** Eventbrite: link, by organizer profile link; plus "Connect with Eventbrite", which signs
 *  in, finds the organizer page and pulls the artist's upcoming shows into Tour. See
 *  README.md.
 *
 *  Eventbrite issues two real profile shapes — `eventbrite.com/o/<slug>-<id>` and a custom
 *  `<name>.eventbrite.com` subdomain — inconsistent enough that there is no one clean handle,
 *  so (like Spotify/Tidal) a pasted link is taken as-is. A paste is LINK ONLY: pulling shows
 *  needs the artist's own sign-in (Eventbrite has no public read), so the source below has
 *  no id column and the Connect window shows no Sync switch for it. */
import { grab, type Service } from '../service'

/** The connection key, and the `source` value Eventbrite's tour dates carry. */
export const EVENTBRITE_KEY = 'eventbrite'

export const eventbrite: Service = {
  slug: 'eventbrite',
  social: {
    key: 'eventbrite',
    method: { kind: 'link' },
    // `eventbrite.<tld>/o/<slug->?<id>` — the slug is optional, the trailing digits are
    // the organizer id. Anchored on the HOST (`[a-z.]+` takes a country TLD,
    // `eventbrite.co.uk`), so an `eventbrite.com/o/…` in another site's path is nobody's
    // id. Read to tell the sign-in WHICH organizer page a pasted link means (the hint).
    idFromUrl: (url) => grab(url, /^https?:\/\/(?:[a-z0-9-]+\.)*eventbrite\.[a-z.]+\/o\/(?:[a-z0-9-]*-)?(\d+)(?:[/?#]|$)/i),
  },
  // The shows. Connected by the artist's sign-in, a token in Vault (`connect_eventbrite`),
  // like Shopify — NOT an artist column, so it is not in INTEGRATION_REGISTRY.
  signInSource: { key: EVENTBRITE_KEY, section: 'tour', placeholder: 'Eventbrite organizer link' },
}

/** "Connect with Eventbrite" (`src/lib/eventbrite-oauth.ts`): where the button goes. Here,
 *  not in the OAuth file, because the Connect window is client code and that file is
 *  server-only (node:crypto). */
const EVENTBRITE_START_PATH = '/api/eventbrite/start'

/** The button's address: the artist, and the organizer id out of a pasted organizer link
 *  when there is one (digits only — anything else is left off). */
export function eventbriteStartPath(artistId: string, organizerId?: string | null): string {
  const q = new URLSearchParams({ artist: artistId })
  if (organizerId && /^[0-9]{1,20}$/.test(organizerId)) q.set('organizer', organizerId)
  return `${EVENTBRITE_START_PATH}?${q}`
}
