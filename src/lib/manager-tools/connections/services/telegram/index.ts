/** Telegram: link only, by username (`t.me/` [skeenmusic]); the older telegram.me domain
 *  still reads. See README.md. */
import { slash, type Service } from '../service'

export const telegram: Service = {
  slug: 'telegram',
  social: {
    key: 'telegram',
    method: { noun: 'username', hosts: ['t.me', 'telegram.me'], rule: /^[A-Za-z][A-Za-z0-9_]{4,31}$/, example: 'skeenmusic', ...slash('t.me') },
  },
}
