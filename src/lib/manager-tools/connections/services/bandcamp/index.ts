/** Bandcamp: link only. The name is a SUBDOMAIN, so it goes before the address
 *  ([skeen] `.bandcamp.com`). See README.md. */
import type { Service } from '../service'

export const bandcamp: Service = {
  slug: 'bandcamp',
  social: {
    key: 'bandcamp',
    method: {
      noun: 'name',
      hosts: ['bandcamp.com'],
      rule: /^[A-Za-z0-9-]{1,63}$/,
      example: 'skeen',
      before: '',
      after: '.bandcamp.com',
      url: (h) => `https://${h}.bandcamp.com`,
      subdomain: true,
    },
  },
}
