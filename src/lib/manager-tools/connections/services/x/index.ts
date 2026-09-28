/** X: link only, by handle (`x.com/` [skeenmusic]); an old twitter.com link still reads.
 *  See README.md. */
import { slash, type Service } from '../service'

export const x: Service = {
  slug: 'x',
  social: {
    key: 'x',
    method: { noun: 'handle', hosts: ['x.com', 'twitter.com'], rule: /^[A-Za-z0-9_]{1,15}$/, example: 'skeenmusic', ...slash('x.com') },
  },
}
