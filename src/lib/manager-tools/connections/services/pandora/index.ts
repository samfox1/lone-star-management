/** Pandora: link only, by artist link. Pandora artists have no handle — the page's name
 *  segment isn't unique, only `/artist/<name>/<id>` is. See README.md. */
import type { Service } from '../service'

export const pandora: Service = {
  slug: 'pandora',
  social: { key: 'pandora', method: { kind: 'link' } },
}
