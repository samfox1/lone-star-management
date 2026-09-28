/** Patreon: link only, by page name (`patreon.com/` [skeen]). See README.md. */
import { slash, type Service } from '../service'

export const patreon: Service = {
  slug: 'patreon',
  social: {
    key: 'patreon',
    method: { noun: 'page name', hosts: ['patreon.com'], rule: /^[A-Za-z0-9_]{1,64}$/, example: 'skeen', ...slash('patreon.com') },
  },
}
