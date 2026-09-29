/** Wikidata: identity only, by item id (`wikidata.org/wiki/` [Q1299]); a pasted item page or
 *  its concept URI (`/entity/Q1299`) reads back to the id. It feeds the site's fact card
 *  (`sameAs`) and is never a site button (the bridge's `identityOnly`). See README.md. */
import { grab, type Service } from '../service'

export const wikidata: Service = {
  slug: 'wikidata',
  social: {
    key: 'wikidata',
    method: {
      noun: 'ID',
      hosts: ['wikidata.org'],
      // An ITEM: Q and a number from 1. A property (P434) or a lexeme (L1) is not an artist.
      rule: /^Q[1-9]\d*$/,
      example: 'Q1299',
      before: 'wikidata.org/wiki/',
      after: '',
      url: (id) => `https://www.wikidata.org/wiki/${id}`,
      // `/wiki/Q1299` (the page) and `/entity/Q1299` (the concept URI): the id is second.
      fromPath: ([first, second]) => (second && (first === 'wiki' || first === 'entity') ? { handle: second } : undefined),
    },
    idFromUrl: (url) => grab(url, /^https?:\/\/(?:[a-z0-9-]+\.)*wikidata\.org\/(?:wiki|entity)\/(Q[1-9]\d*)\/?(?:[?#]|$)/i),
  },
}
