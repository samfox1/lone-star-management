/** Audiomack: link only, by handle (`audiomack.com/` [skeenmusic]). See README.md. */
import { slash, type Service } from '../service'

export const audiomack: Service = {
  slug: 'audiomack',
  social: {
    key: 'audiomack',
    method: { noun: 'handle', hosts: ['audiomack.com'], rule: /^[A-Za-z0-9_-]{1,30}$/, example: 'skeenmusic', ...slash('audiomack.com') },
  },
}
