/** PayPal: link only, by PayPal.Me name (`paypal.me/` [skeenmusic]). A tip button to the
 *  artist's public PayPal.Me page — never a payment credential, and never an amount:
 *  `paypal.me/<name>/<amount>` is accepted but only the name is kept, same as any extra
 *  path segment on a handle platform. See README.md. */
import { slash, type Service } from '../service'

export const paypal: Service = {
  slug: 'paypal',
  social: {
    key: 'paypal',
    method: {
      noun: 'page name',
      hosts: ['paypal.me', 'paypal.com'],
      // PayPal's own published rule: alphanumeric only, up to 20 characters.
      rule: /^[A-Za-z0-9]{1,20}$/,
      example: 'skeenmusic',
      ...slash('paypal.me'),
      // `paypal.me/<name>` needs no override: the default reads the first segment. On
      // paypal.com, PayPal's WHOLE site, only `/paypalme/<name>` is a PayPal.Me name: any
      // other path (a donate button, the sign-in page) must not become `paypal.me/donate`,
      // a stranger's page, so it reads as no name at all.
      fromPath: (segments, url) => {
        if (/(^|\.)paypal\.me$/i.test(url.hostname)) return undefined
        return { handle: segments[0] === 'paypalme' ? (segments[1] ?? '') : '' }
      },
    },
  },
}
