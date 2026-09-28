/** Substack: link only, by handle (`substack.com/@` [skeen]); a `skeen.substack.com`
 *  link reads too. See README.md. */
import { at, type Service } from '../service'

export const substack: Service = {
  slug: 'substack',
  social: {
    key: 'substack',
    method: { noun: 'handle', hosts: ['substack.com'], rule: /^[A-Za-z0-9_-]{1,40}$/, example: 'skeen', ...at('substack.com'), alsoSubdomain: true },
  },
}
