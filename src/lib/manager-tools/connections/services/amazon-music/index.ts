/** Amazon Music: link only, by artist link. Amazon Music artists have no handle — the
 *  ASIN in the link is the only stable id. See README.md. */
import type { Service } from '../service'

export const amazonMusic: Service = {
  slug: 'amazon-music',
  social: { key: 'amazon music', method: { kind: 'link' } },
}
