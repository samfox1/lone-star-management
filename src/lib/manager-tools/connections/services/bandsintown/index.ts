/** Bandsintown: a service, by artist name; pulls tour dates. See README.md. */
import type { Service } from '../service'

export const bandsintown: Service = {
  slug: 'bandsintown',
  source: { key: 'bandsintown', label: 'Bandsintown', section: 'tour', idField: 'bandsintown_name', placeholder: 'Bandsintown artist name', pullLabel: 'Pull tour dates' },
}
