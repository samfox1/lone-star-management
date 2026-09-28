/** Songkick: link only, by artist page link (`songkick.com/artists/<id>-<name>`). Artists
 *  have no handle, only a numeric id baked into the slug — same shape as Tidal. No sync:
 *  Songkick's API is not accepting new key applications as of this research. See README.md. */
import type { Service } from '../service'

export const songkick: Service = {
  slug: 'songkick',
  social: { key: 'songkick', method: { kind: 'link' } },
}
