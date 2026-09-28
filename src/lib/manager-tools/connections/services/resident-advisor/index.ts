/** Resident Advisor: link only, by artist/DJ slug (`ra.co/dj/` [skeenmusic]); the old
 *  `residentadvisor.net/dj/<slug>` link still reads. No catalog or events are pulled —
 *  RA has no public developer API (see README.md). */
import { slash, type Service } from '../service'

export const residentAdvisor: Service = {
  slug: 'resident-advisor',
  social: {
    key: 'resident advisor',
    method: {
      noun: 'name',
      hosts: ['ra.co', 'residentadvisor.net'],
      // Not documented by RA. Observed from real profile URLs (ra.co/dj/djhttps, ra.co/dj/who):
      // a standard URL slug, lowercase letters/numbers/hyphens. Kept case-insensitive here
      // since RA's own casing rules aren't published.
      rule: /^[A-Za-z0-9-]{1,50}$/,
      example: 'skeenmusic',
      ...slash('ra.co/dj'),
      // Both hosts use `/dj/<slug>`; without this, the default would read "dj" itself as
      // the slug.
      fromPath: (segments) => {
        const [first, second] = segments
        if (first === 'dj' && second) return { handle: second }
        return undefined
      },
    },
  },
}
