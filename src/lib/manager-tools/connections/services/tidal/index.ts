/** Tidal: link only, by artist link. No catalog is pulled, so no id is read out of it.
 *  See README.md. */
import type { Service } from '../service'

export const tidal: Service = {
  slug: 'tidal',
  social: { key: 'tidal', method: { kind: 'link' } },
}
