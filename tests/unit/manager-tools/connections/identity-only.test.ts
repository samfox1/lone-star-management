// MusicBrainz, Discogs and Wikidata: connections that say WHO the artist is, and are never a site button.
/**
 * AI_VISIBILITY_AUDIT.md 1.3 (Sam, 2026-09-28: "add all the connections and links"). The
 * music fact databases AI answers lean on are connections like any other on the Connections
 * page, but a MusicBrainz button on an artist's site makes no sense: they exist to feed the
 * fact card (`sameAs`). So the bridge marks them `identityOnly`, and the one place a button
 * is made (the editor's Add button, `buttonChoices`) refuses them by that RULE, whatever rows
 * it is shown.
 *
 * What each takes, from the platforms' own URL shapes (see each service's README):
 *   MusicBrainz — an artist page, `musicbrainz.org/artist/<mbid>`, and nothing else there;
 *   Discogs     — an artist page, `discogs.com/artist/<id>-<name>` (a locale path allowed);
 *   Wikidata    — the item id alone (`Q1299`) or its page, rebuilt as `wikidata.org/wiki/Q…`.
 */
import { describe, expect, it } from 'vitest'
import { platformFromUrl } from '@samfox1/site-bridge/social'
import { socialIcon } from '@samfox1/site-bridge/social-icons'
import {
  CONNECTIONS,
  buildConnectionRows,
  buttonChoices,
  connectInputError,
  connectionByKey,
  connectionOfLink,
  connectionsAtoZ,
  idFromProfileUrl,
  methodOf,
  profileLink,
  type LinkRowLike,
} from '@/lib/connections'

const IDENTITY = ['discogs', 'musicbrainz', 'wikidata']
/** The Beatles, on all three: real ids, so the shapes are the platforms' own. */
const MBID = 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d'
const MB = `https://musicbrainz.org/artist/${MBID}`
const DISCOGS = 'https://www.discogs.com/artist/82730-The-Beatles'
const WIKIDATA = 'https://www.wikidata.org/wiki/Q1299'

const byKey = (k: string) => {
  const d = connectionByKey(k)
  if (!d) throw new Error(`no connection ${k}`)
  return d
}

describe('the three identity connections', () => {
  it('CRITICAL: they are connections flagged identity only, and no other connection is', () => {
    expect(CONNECTIONS.filter((d) => d.identityOnly).map((d) => d.key).sort()).toEqual(IDENTITY)
    for (const k of IDENTITY) {
      const d = byKey(k)
      expect(d.kind, k).toBe('social')
      expect(d.social, k).toBe(k)
      expect(socialIcon(k), k).not.toBeNull()
    }
  })

  it('the site reads each one’s link as that platform, and a look-alike as nobody’s', () => {
    expect(platformFromUrl(MB)?.slug).toBe('musicbrainz')
    expect(platformFromUrl(DISCOGS)?.slug).toBe('discogs')
    expect(platformFromUrl(WIKIDATA)?.slug).toBe('wikidata')
    expect(platformFromUrl(`https://musicbrainz.org.evil.net/artist/${MBID}`)).toBeNull()
    expect(platformFromUrl('https://evildiscogs.com/artist/1-X')).toBeNull()
  })

  it('the Connections page shows them like any other: in the Connect grid, and as a row once linked', () => {
    const grid = connectionsAtoZ().map((d) => d.key)
    for (const k of IDENTITY) expect(grid, k).toContain(k)
    const rows = buildConnectionRows({
      links: [{ id: 'l-mb', label: 'MusicBrainz', url: MB, on_site: false, role: null }],
      artist: {},
      shopifyConnected: false,
      counts: {},
    })
    expect(rows.map((r) => [r.key, r.url, r.state])).toEqual([['musicbrainz', MB, 'none']])
  })
})

describe('MusicBrainz takes an artist page, and only that', () => {
  const mb = () => byKey('musicbrainz')

  it('CRITICAL: an artist link is saved as pasted (made https, without its query)', () => {
    expect(methodOf(mb())?.kind).toBe('link')
    expect(profileLink(mb(), { url: MB })).toEqual({ url: MB })
    expect(profileLink(mb(), { url: `musicbrainz.org/artist/${MBID}` })).toEqual({ url: MB })
    expect(profileLink(mb(), { url: `${MB}?tab=relationships#x` })).toEqual({ url: MB })
    expect(profileLink(mb(), { url: `${MB}/` })).toEqual({ url: `${MB}/` })
  })

  it('CRITICAL: anything else on musicbrainz.org is refused, by name', () => {
    for (const url of [
      `https://musicbrainz.org/release/${MBID}`,
      'https://musicbrainz.org/artist/create',
      `https://musicbrainz.org/artist/${MBID}/releases`,
      'https://musicbrainz.org/artist/not-an-mbid',
      'https://musicbrainz.org/search?query=skeen',
    ])
      expect(connectInputError(mb(), { url }), url).toBe('That isn’t a MusicBrainz artist link.')
    expect(connectInputError(mb(), { url: 'https://instagram.com/skeen' })).toBe('That’s an Instagram link, not MusicBrainz.')
  })

  it('the MBID comes out of the link, and nothing out of anyone else’s', () => {
    expect(idFromProfileUrl(mb(), MB)).toBe(MBID)
    expect(idFromProfileUrl(mb(), `https://evil.com/musicbrainz.org/artist/${MBID}`)).toBeNull()
    expect(idFromProfileUrl(mb(), `https://musicbrainz.org/release/${MBID}`)).toBeNull()
  })
})

describe('Discogs takes an artist page, and only that', () => {
  const dc = () => byKey('discogs')

  it('CRITICAL: an artist link is saved as pasted, a locale path included', () => {
    expect(methodOf(dc())?.kind).toBe('link')
    expect(profileLink(dc(), { url: DISCOGS })).toEqual({ url: DISCOGS })
    expect(profileLink(dc(), { url: 'https://www.discogs.com/de/artist/82730-The-Beatles' })).toEqual({ url: 'https://www.discogs.com/de/artist/82730-The-Beatles' })
    expect(profileLink(dc(), { url: 'https://www.discogs.com/artist/82730' })).toEqual({ url: 'https://www.discogs.com/artist/82730' })
    expect(profileLink(dc(), { url: `${DISCOGS}?type=Releases` })).toEqual({ url: DISCOGS })
  })

  it('CRITICAL: a release, a master, a label or a name-only link is refused, by name', () => {
    for (const url of [
      'https://www.discogs.com/release/123-The-Beatles-Abbey-Road',
      'https://www.discogs.com/master/24047-The-Beatles-Abbey-Road',
      'https://www.discogs.com/label/895-Apple-Records',
      'https://www.discogs.com/artist/The-Beatles',
      'https://www.discogs.com/sell/list?artist_id=82730',
    ])
      expect(connectInputError(dc(), { url }), url).toBe('That isn’t a Discogs artist link.')
  })

  it('the numeric artist id comes out of the link', () => {
    expect(idFromProfileUrl(dc(), DISCOGS)).toBe('82730')
    expect(idFromProfileUrl(dc(), 'https://www.discogs.com/fr/artist/82730-The-Beatles')).toBe('82730')
    expect(idFromProfileUrl(dc(), 'https://evil.com/discogs.com/artist/82730-X')).toBeNull()
  })
})

describe('Wikidata takes the item id, or its page', () => {
  const wd = () => byKey('wikidata')

  it('CRITICAL: a bare Q-id or any link to the item becomes the one item page', () => {
    for (const typed of ['Q1299', WIKIDATA, 'wikidata.org/wiki/Q1299', 'https://m.wikidata.org/wiki/Q1299', 'http://www.wikidata.org/entity/Q1299'])
      expect(profileLink(wd(), { handle: typed }), typed).toEqual({ url: WIKIDATA })
  })

  it('CRITICAL: a property, a search page or junk is refused', () => {
    for (const typed of ['P434', 'Q', 'Q0', 'Q12x', 'https://www.wikidata.org/wiki/Special:Search'])
      expect(connectInputError(wd(), { handle: typed }), typed).toBe('That doesn’t look like a Wikidata ID.')
    expect(connectInputError(wd(), { handle: '' })).toBe('Enter the Wikidata ID.')
    expect(connectInputError(wd(), { handle: 'https://en.wikipedia.org/wiki/The_Beatles' })).toBe('That isn’t a Wikidata link.')
  })

  it('the Q-id comes out of the link', () => {
    expect(idFromProfileUrl(wd(), WIKIDATA)).toBe('Q1299')
    expect(idFromProfileUrl(wd(), 'https://evil.com/wikidata.org/wiki/Q1299')).toBeNull()
  })
})

describe('never a site button', () => {
  type EditorLinkLike = LinkRowLike & { onSite: boolean }
  const links: EditorLinkLike[] = [
    { id: 'l-mb', label: 'MusicBrainz', url: MB, role: null, onSite: false },
    { id: 'l-dc', label: 'Discogs', url: DISCOGS, role: null, onSite: false },
    { id: 'l-wd', label: 'Wikidata', url: WIKIDATA, role: null, onSite: false },
    { id: 'l-ig', label: 'Instagram', url: 'https://instagram.com/skeen', role: null, onSite: false },
  ]

  it('CRITICAL: the editor’s picker never offers them — by the rule, not the rows it is shown', () => {
    // Witness: each IS a connection's profile link, so only the identity rule keeps it out.
    for (const l of links.slice(0, 3)) expect(connectionOfLink(l)?.key, l.label!).toBeDefined()
    expect(buttonChoices(links).map((c) => c.link.id)).toEqual(['l-ig'])
  })
})
