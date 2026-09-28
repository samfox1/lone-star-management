/** Beatport: link only, by artist link. Beatport artists have no handle — the page's slug
 *  isn't unique on its own, only `/artist/<slug>/<id>` is. See README.md. */
import type { Service } from '../service'

export const beatport: Service = {
  slug: 'beatport',
  social: { key: 'beatport', method: { kind: 'link' } },
}
