/** Ticketmaster: a service, by attraction id; pulls tour dates. See README.md.
 *
 * Placeholder mentions the artist link too (Sam, 2026-09-28): still no name search — the
 * field keeps asking for the attraction id itself — but a pasted artist page link is read
 * for its id by `ticketmasterAttractionId` (lib/ticketmaster.ts) so the manager doesn't
 * have to dig the id out by hand. */
import type { Service } from '../service'

export const ticketmaster: Service = {
  slug: 'ticketmaster',
  source: {
    key: 'ticketmaster',
    label: 'Ticketmaster',
    section: 'tour',
    idField: 'ticketmaster_attraction_id',
    placeholder: 'Ticketmaster attraction ID or artist link',
    pullLabel: 'Pull tour dates',
  },
}
