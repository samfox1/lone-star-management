/** Cash App: link only, by $cashtag (`cash.app/$` [skeenmusic]). A tip button to the
 *  artist's public Cash App page — never a payment credential, never an amount in the
 *  link: the link is rebuilt from the cashtag alone, so `cash.app/$name/25` or an
 *  `?amount=` saves as `cash.app/$name`. The `$` belongs to the address around the field
 *  (`before`), and `parseHandle` drops a typed or pasted one for any address ending in `$`.
 *  See README.md. */
import type { Service } from '../service'

export const cashApp: Service = {
  slug: 'cash-app',
  social: {
    key: 'cash app',
    method: {
      noun: 'handle',
      hosts: ['cash.app'],
      // At least one letter, letters/numbers only, up to 20 characters (Cash App's own
      // published rule).
      rule: /^(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,20}$/,
      example: 'skeenmusic',
      before: 'cash.app/$',
      after: '',
      url: (h) => `https://cash.app/$${h}`,
    },
  },
}
