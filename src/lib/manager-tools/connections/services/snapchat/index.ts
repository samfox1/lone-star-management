/** Snapchat: link only, by username (`snapchat.com/add/` [skeenmusic]). See README.md. */
import type { Service } from '../service'

export const snapchat: Service = {
  slug: 'snapchat',
  social: {
    key: 'snapchat',
    method: {
      noun: 'username',
      hosts: ['snapchat.com'],
      rule: /^[A-Za-z][A-Za-z0-9_.-]{1,13}[A-Za-z0-9]$/,
      example: 'skeenmusic',
      before: 'snapchat.com/add/',
      after: '',
      url: (h) => `https://snapchat.com/add/${h}`,
      // Profile links always sit under /add/<username>, never a bare path segment.
      fromPath: (segments) => {
        const [first, second] = segments
        if (first === 'add' && second) return { handle: second }
        return undefined
      },
    },
  },
}
