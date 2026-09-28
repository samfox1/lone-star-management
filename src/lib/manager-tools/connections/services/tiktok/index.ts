/** TikTok: link only, by handle (`tiktok.com/@` [skeenmusic]). See README.md. */
import { at, type Service } from '../service'

export const tiktok: Service = {
  slug: 'tiktok',
  social: {
    key: 'tiktok',
    method: { noun: 'handle', hosts: ['tiktok.com'], rule: /^[A-Za-z0-9._]{2,24}$/, example: 'skeenmusic', ...at('tiktok.com') },
  },
}
