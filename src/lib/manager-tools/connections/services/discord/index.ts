/** Discord: link only, by invite code (`discord.gg/` [AbC123]). See README.md. */
import { slash, type Service } from '../service'

export const discord: Service = {
  slug: 'discord',
  social: {
    key: 'discord',
    method: {
      noun: 'invite code',
      hosts: ['discord.gg', 'discord.com'],
      rule: /^[A-Za-z0-9-]{2,32}$/,
      example: 'AbC123',
      ...slash('discord.gg'),
      // The long invite page, `discord.com/invite/<code>`, carries the same code.
      fromPath: (segments, url) => {
        if (url.hostname.endsWith('discord.com') && segments[0] === 'invite' && segments[1]) return { handle: segments[1] }
        return undefined
      },
    },
  },
}
