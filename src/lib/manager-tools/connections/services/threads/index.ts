/** Threads: link only, by handle (`threads.net/@` [skeenmusic]); threads.com also reads.
 *  See README.md. */
import { at, type Service } from '../service'

export const threads: Service = {
  slug: 'threads',
  social: {
    key: 'threads',
    method: { noun: 'handle', hosts: ['threads.net', 'threads.com'], rule: /^[A-Za-z0-9._]{1,30}$/, example: 'skeenmusic', ...at('threads.net') },
  },
}
