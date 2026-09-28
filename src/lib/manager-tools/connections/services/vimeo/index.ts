/** Vimeo: link only, by username (`vimeo.com/` [skeenmusic]); an unclaimed account's
 *  `vimeo.com/user12345678` link reads the same way — a plain path segment either way.
 *  See README.md. */
import { slash, type Service } from '../service'

export const vimeo: Service = {
  slug: 'vimeo',
  social: {
    key: 'vimeo',
    method: { noun: 'username', hosts: ['vimeo.com'], rule: /^[A-Za-z0-9]{1,30}$/, example: 'skeenmusic', ...slash('vimeo.com') },
  },
}
