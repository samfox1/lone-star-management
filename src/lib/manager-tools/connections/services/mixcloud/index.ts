/** Mixcloud: link only, by handle (`mixcloud.com/` [skeenmusic]). See README.md. */
import { slash, type Service } from '../service'

export const mixcloud: Service = {
  slug: 'mixcloud',
  social: {
    key: 'mixcloud',
    method: { noun: 'handle', hosts: ['mixcloud.com'], rule: /^[A-Za-z0-9_-]{1,60}$/, example: 'skeenmusic', ...slash('mixcloud.com') },
  },
}
