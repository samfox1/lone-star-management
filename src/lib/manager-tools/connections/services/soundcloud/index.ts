/** SoundCloud: link only, by username (`soundcloud.com/` [skeenmusic]). See README.md. */
import { slash, type Service } from '../service'

export const soundcloud: Service = {
  slug: 'soundcloud',
  social: {
    key: 'soundcloud',
    method: { noun: 'username', hosts: ['soundcloud.com'], rule: /^[A-Za-z0-9_-]{2,25}$/, example: 'skeenmusic', ...slash('soundcloud.com') },
  },
}
