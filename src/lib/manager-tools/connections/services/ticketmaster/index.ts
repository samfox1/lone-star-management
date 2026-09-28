/** Ticketmaster: a service, by attraction id; pulls tour dates. See README.md. */
import type { Service } from '../service'

export const ticketmaster: Service = {
  slug: 'ticketmaster',
  source: { key: 'ticketmaster', label: 'Ticketmaster', section: 'tour', idField: 'ticketmaster_attraction_id', placeholder: 'Ticketmaster attraction ID', pullLabel: 'Pull tour dates' },
}
