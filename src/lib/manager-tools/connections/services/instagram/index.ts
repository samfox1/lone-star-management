/** Instagram: link only, by username (`instagram.com/` [skeenmusic]). See README.md. */
import { slash, type Service } from '../service'

export const instagram: Service = {
  slug: 'instagram',
  social: {
    key: 'instagram',
    method: { noun: 'username', hosts: ['instagram.com'], rule: /^[A-Za-z0-9._]{1,30}$/, example: 'skeenmusic', ...slash('instagram.com') },
  },
}
