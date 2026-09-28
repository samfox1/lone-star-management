/** Ko-fi: link only, by page name (`ko-fi.com/` [skeenmusic]). A tip button to the
 *  artist's public Ko-fi page — never a payment credential, never an amount in the link.
 *  See README.md. */
import { slash, type Service } from '../service'

export const koFi: Service = {
  slug: 'ko-fi',
  social: {
    key: 'ko-fi',
    method: { noun: 'page name', hosts: ['ko-fi.com'], rule: /^[A-Za-z0-9_-]{3,30}$/, example: 'skeenmusic', ...slash('ko-fi.com') },
  },
}
