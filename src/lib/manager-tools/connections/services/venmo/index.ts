/** Venmo: link only, by username (`venmo.com/u/` [skeenmusic]). A tip button to the
 *  artist's public Venmo profile — never a payment credential, never an amount in the
 *  link. `account.venmo.com` (Venmo's newer web app host) reads back to the same
 *  registrable domain (`venmo.com`) with no extra host needed. See README.md. */
import type { Service } from '../service'

export const venmo: Service = {
  slug: 'venmo',
  social: {
    key: 'venmo',
    method: {
      noun: 'username',
      hosts: ['venmo.com'],
      // Venmo's own published rule: 5-30 characters, letters/numbers plus - and _ only.
      rule: /^[A-Za-z0-9_-]{5,30}$/,
      example: 'skeenmusic',
      before: 'venmo.com/u/',
      after: '',
      url: (h) => `https://venmo.com/u/${h}`,
      // The profile path is `/u/<username>` (on venmo.com or account.venmo.com); a bare
      // `/<username>` link (no `/u/`) falls through to the default first-segment handling.
      fromPath: (segments) => {
        const [first, second] = segments
        if (first === 'u' && second) return { handle: second }
        return undefined
      },
    },
  },
}
