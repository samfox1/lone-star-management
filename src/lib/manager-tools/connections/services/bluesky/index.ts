/** Bluesky: link only, by handle (`bsky.app/profile/` [skeenmusic.bsky.social]); a handle
 *  IS a domain name — the default `*.bsky.social` or a verified custom domain. See README.md. */
import type { Service } from '../service'

export const bluesky: Service = {
  slug: 'bluesky',
  social: {
    key: 'bluesky',
    method: {
      noun: 'handle',
      hosts: ['bsky.app'],
      // AT Protocol handle grammar (atproto.com/specs/handle): dot-separated domain labels,
      // each 1-63 chars of letters/digits/hyphens, no leading/trailing hyphen, last label a
      // letter. Covers both `name.bsky.social` and a verified custom domain (`name.com`).
      rule: /^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/,
      example: 'skeenmusic.bsky.social',
      before: 'bsky.app/profile/',
      after: '',
      url: (h) => `https://bsky.app/profile/${h}`,
      // Profile links always sit under /profile/<handle>, never a bare path segment.
      fromPath: (segments) => {
        const [first, second] = segments
        if (first === 'profile' && second) return { handle: second }
        return undefined
      },
    },
  },
}
