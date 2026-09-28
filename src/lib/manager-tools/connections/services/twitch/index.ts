/** Twitch: link only, by username (`twitch.tv/` [skeenmusic]). See README.md. */
import { slash, type Service } from '../service'

export const twitch: Service = {
  slug: 'twitch',
  social: {
    key: 'twitch',
    method: { noun: 'username', hosts: ['twitch.tv'], rule: /^[A-Za-z0-9_]{4,25}$/, example: 'skeenmusic', ...slash('twitch.tv') },
  },
}
