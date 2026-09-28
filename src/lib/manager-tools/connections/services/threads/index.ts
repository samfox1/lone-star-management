/** Threads: link only, by handle (`threads.com/@` [skeenmusic]); threads.net (the old
 *  domain, now a redirect) still reads. See README.md. */
import { at, type Service } from '../service'

export const threads: Service = {
  slug: 'threads',
  social: {
    key: 'threads',
    method: { noun: 'handle', hosts: ['threads.com', 'threads.net'], rule: /^[A-Za-z0-9._]{1,30}$/, example: 'skeenmusic', ...at('threads.com') },
  },
}
