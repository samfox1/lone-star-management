/** WhatsApp: link only, by channel link (`whatsapp.com/channel/<id>`). WhatsApp accounts
 *  have no public handle, only a channel id in the link — same shape as Spotify/Tidal.
 *  A `wa.me/<phone>` click-to-chat link is deliberately NOT one of this platform's hosts
 *  (the bridge has no `wa.me` alias) and not a shape this method takes: it carries the
 *  artist's phone number in plain text, and a site button would publish it. See README.md. */
import type { Service } from '../service'

export const whatsapp: Service = {
  slug: 'whatsapp',
  social: {
    key: 'whatsapp',
    method: {
      kind: 'link',
      // A CHANNEL only: `whatsapp.com/channel/<id>`. Never `wa.me/<phone>`,
      // `api.whatsapp.com/send?phone=<phone>` or a `chat.whatsapp.com` group invite: a
      // phone link PUBLISHES the artist's phone number on their site (and to anyone who
      // scrapes it), and an invite lets any visitor into a private group. A channel id
      // always has letters in it, so digits alone (a number pasted after /channel/) fail too.
      path: /^\/channel\/(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]+\/?$/,
      pathNoun: 'channel',
    },
  },
}
