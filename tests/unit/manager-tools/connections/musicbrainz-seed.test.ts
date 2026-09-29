/**
 * The "Create the MusicBrainz page" link opens MusicBrainz's own artist editor pre-filled from
 * what we know, with every value safely encoded and only links MusicBrainz can label correctly.
 *
 * Code:     src/lib/manager-tools/connections/services/musicbrainz/seed.ts (musicBrainzCreateUrl,
 *           MB_LINK_TYPE, MB_LINK_TYPE_OF, MB_ARTIST_TYPE)
 * Feature:  Connections page: MusicBrainz (AI_VISIBILITY_AUDIT.md 4.1: Skeen is not in MusicBrainz,
 *           the source most cited for musicians); the artist signs in there and submits it
 * Tier:     STRICT (AGENTS.md "Test depth"): everything here ends up in a URL.
 * Covers:   • the link opens musicbrainz.org's artist editor over https, with the name
 *           • every value is encoded: nothing typed can add or change a parameter
 *           • the type (person 1, group 2) and the area only when known
 *           • the site goes first as the official homepage, then each profile with its
 *             MusicBrainz link type; only https links, only when the label and link agree, only
 *             platforms with a confirmed type, each once, numbered without gaps
 *           • the link type ids are MusicBrainz's own, and every mapped platform is one the
 *             bridge knows
 * Not here: accepting a MusicBrainz artist link as a connection (identity-only.test.ts).
 * Fixtures: MusicBrainz's documented editor seeding (wiki.musicbrainz.org/Development/Seeding/Artist_Editor);
 *           the link type ids were read off musicbrainz.org/relationship/<uuid> on 2026-09-28 and
 *           are written here by hand: a witness, not a copy of the code's table.
 */
import { describe, expect, it } from 'vitest'
import { SOCIAL_PLATFORMS } from '@samfox1/site-bridge/social'
import { MB_ARTIST_TYPE, MB_LINK_TYPE, MB_LINK_TYPE_OF, musicBrainzCreateUrl } from '@/lib/manager-tools/connections/services/musicbrainz/seed'

const CREATE = 'https://musicbrainz.org/artist/create'
const params = (url: string) => new URL(url).searchParams
/** The external links a seed carries, in order, as [url, link type id]. */
function seededLinks(url: string): [string, string][] {
  const p = params(url)
  const out: [string, string][] = []
  for (let i = 0; p.has(`edit-artist.url.${i}.text`); i++) out.push([p.get(`edit-artist.url.${i}.text`)!, p.get(`edit-artist.url.${i}.link_type_id`)!])
  return out
}
const link = (label: string, url: string) => ({ label, url })

describe('the create link', () => {
  // The link opens MusicBrainz's own artist editor over https, with the artist's name filled in.
  it('CRITICAL: opens MusicBrainz’s own artist editor, over https, with the name in it', () => {
    const url = musicBrainzCreateUrl({ name: 'Skeen' })
    expect(url.startsWith(`${CREATE}?`)).toBe(true)
    expect(params(url).get('edit-artist.name')).toBe('Skeen')
  })

  // Every value is encoded: an &, =, # or a fake parameter in a name or area stays text and
  // cannot add or change a parameter.
  it('CRITICAL: every value is encoded — nothing typed can add or change a parameter', () => {
    const name = 'A&B=C #1 ?edit-artist.type_id=2 Beyoncé'
    const url = musicBrainzCreateUrl({ name, area: 'Chicago, IL & more' })
    expect(params(url).get('edit-artist.name')).toBe(name)
    expect(params(url).get('edit-artist.area.name')).toBe('Chicago, IL & more')
    expect(params(url).has('edit-artist.type_id')).toBe(false)
    expect(new URL(url).hash).toBe('')
    expect([...params(url).keys()]).toEqual(['edit-artist.name', 'edit-artist.area.name'])
  })

  // The artist type is sent only when known (a person is 1, a group 2); unknown is left to the artist.
  it('the type only when we know it: a person is 1, a group 2; unknown is left to the artist', () => {
    expect(params(musicBrainzCreateUrl({ name: 'S', type: 'person' })).get('edit-artist.type_id')).toBe('1')
    expect(params(musicBrainzCreateUrl({ name: 'S', type: 'group' })).get('edit-artist.type_id')).toBe('2')
    expect(params(musicBrainzCreateUrl({ name: 'S', type: null })).has('edit-artist.type_id')).toBe(false)
    expect(MB_ARTIST_TYPE).toEqual({ person: 1, group: 2 })
  })

  // The area is sent trimmed when there is one; blank or missing sends nothing.
  it('the area from the facts when there is one; blank or missing sends nothing', () => {
    expect(params(musicBrainzCreateUrl({ name: 'S', area: '  Chicago  ' })).get('edit-artist.area.name')).toBe('Chicago')
    for (const area of [null, undefined, '', '   ']) expect(params(musicBrainzCreateUrl({ name: 'S', area })).has('edit-artist.area.name')).toBe(false)
  })

  // A blank name sends no name, so the artist types it there.
  it('a blank name sends no name (the artist types it there)', () => {
    expect(params(musicBrainzCreateUrl({ name: '   ' })).has('edit-artist.name')).toBe(false)
  })
})

describe('the external links', () => {
  // The site goes first as the official homepage, then every profile with its own MusicBrainz
  // link type, in order.
  it('CRITICAL: the site first as the official homepage, then each profile with its MusicBrainz link type', () => {
    const url = musicBrainzCreateUrl({
      name: 'Skeen',
      homepage: 'https://skeenmusic.com',
      links: [
        link('Instagram', 'https://instagram.com/skeenmusic'),
        link('Spotify', 'https://open.spotify.com/artist/26K'),
        link('Apple Music', 'https://music.apple.com/us/artist/skeen/1754431714'),
        link('YouTube', 'https://youtube.com/@skeenmusic'),
        link('YouTube Music', 'https://music.youtube.com/channel/UC1'),
        link('SoundCloud', 'https://soundcloud.com/skeenmusic'),
        link('Bandcamp', 'https://skeen.bandcamp.com'),
        link('Songkick', 'https://songkick.com/artists/123-skeen'),
        link('Twitch', 'https://twitch.tv/skeenmusic'),
        link('Patreon', 'https://patreon.com/skeen'),
        link('Resident Advisor', 'https://ra.co/dj/skeen'),
        link('Beatport', 'https://www.beatport.com/artist/skeen/123'),
        link('Discogs', 'https://www.discogs.com/artist/1-Skeen'),
        link('Wikidata', 'https://www.wikidata.org/wiki/Q1'),
      ],
    })
    expect(seededLinks(url)).toEqual([
      ['https://skeenmusic.com', '183'],
      ['https://instagram.com/skeenmusic', '192'],
      ['https://open.spotify.com/artist/26K', '194'],
      ['https://music.apple.com/us/artist/skeen/1754431714', '978'],
      ['https://youtube.com/@skeenmusic', '193'],
      ['https://music.youtube.com/channel/UC1', '1080'],
      ['https://soundcloud.com/skeenmusic', '291'],
      ['https://skeen.bandcamp.com', '718'],
      ['https://songkick.com/artists/123-skeen', '785'],
      ['https://twitch.tv/skeenmusic', '303'],
      ['https://patreon.com/skeen', '897'],
      ['https://ra.co/dj/skeen', '188'],
      ['https://www.beatport.com/artist/skeen/123', '176'],
      ['https://www.discogs.com/artist/1-Skeen', '180'],
      ['https://www.wikidata.org/wiki/Q1', '352'],
    ])
  })

  // Only https links, only when the label and the link agree, only platforms with a confirmed
  // type (not payment pages), each once, numbered without gaps.
  it('CRITICAL: only https links, only when the label and the link agree, only a platform with a confirmed type — numbered without gaps', () => {
    const url = musicBrainzCreateUrl({
      name: 'Skeen',
      homepage: 'http://skeenmusic.com',
      links: [
        link('Instagram', 'http://instagram.com/skeenmusic'),
        link('Instagram', 'javascript:alert(1)//instagram.com/x'),
        link('Instagram', 'https://open.spotify.com/artist/26K'), // a label that is not its link
        link('My page', 'https://skeenmusic.com'),
        link('Snapchat', 'https://snapchat.com/add/skeen'), // no confirmed MusicBrainz type
        link('PayPal', 'https://paypal.me/skeen'), // a payment page, not who the artist is
        link('MusicBrainz', 'https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d'),
        { label: null, url: null },
        link('X', 'https://x.com/skeenmusic'),
        link('X', 'https://x.com/skeenmusic'), // once
      ],
    })
    expect(seededLinks(url)).toEqual([['https://x.com/skeenmusic', '192']])
    expect(params(url).has('edit-artist.url.1.text')).toBe(false)
  })

  // A homepage that is not an https web link is left out.
  it('a homepage that is not a web link is left out', () => {
    for (const homepage of ['javascript:alert(1)', 'ftp://skeenmusic.com', 'skeenmusic.com', ''])
      expect(seededLinks(musicBrainzCreateUrl({ name: 'S', homepage })), homepage).toEqual([])
  })
})

describe('the link types are MusicBrainz’s own', () => {
  // The link type ids are the ones confirmed on musicbrainz.org, written here by hand.
  it('CRITICAL: the ids confirmed on musicbrainz.org (2026-09-28)', () => {
    expect(MB_LINK_TYPE).toEqual({
      officialHomepage: 183,
      socialNetwork: 192,
      freeStreaming: 194,
      paidStreaming: 978,
      youtube: 193,
      youtubeMusic: 1080,
      soundcloud: 291,
      bandcamp: 718,
      songkick: 785,
      patronage: 897,
      videoChannel: 303,
      discogs: 180,
      wikidata: 352,
      otherDatabases: 188,
      purchaseForDownload: 176,
    })
  })

  // Every platform it maps is one the bridge knows, onto one of those confirmed ids.
  it('every platform it maps is one the bridge knows, onto a confirmed id', () => {
    const slugs = SOCIAL_PLATFORMS.map((p) => p.slug)
    const ids = Object.values(MB_LINK_TYPE)
    expect(Object.keys(MB_LINK_TYPE_OF).length).toBeGreaterThan(10)
    for (const [slug, id] of Object.entries(MB_LINK_TYPE_OF)) {
      expect(slugs, slug).toContain(slug)
      expect(ids, slug).toContain(id)
    }
  })
})
