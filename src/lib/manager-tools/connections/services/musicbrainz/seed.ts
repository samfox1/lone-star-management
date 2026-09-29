/**
 * "CREATE THE MUSICBRAINZ PAGE" (AI_VISIBILITY_AUDIT.md 4.1): MusicBrainz's own artist
 * editor, opened pre-filled with what we already know. The artist signs in to MusicBrainz and
 * submits it themselves; nothing is sent from here.
 *
 * MusicBrainz documents seeding that editor with GET parameters
 * (https://wiki.musicbrainz.org/Development/Seeding/Artist_Editor, and the general rule on
 * https://wiki.musicbrainz.org/Development/Seeding: a field seeds by its input's `name`, e.g.
 * `edit-artist.name`):
 *   edit-artist.name                        the name
 *   edit-artist.type_id                     the `artist_type` id (Person 1, Group 2)
 *   edit-artist.area.name                   text for the area's search box
 *   edit-artist.url.N.text / .link_type_id  an external link and its `link_type` id
 *
 * THE LINK TYPE IDS ARE MUSICBRAINZ'S OWN, checked 2026-09-28: each type's uuid is from
 * musicbrainz-server's `root/static/scripts/edit/URLCleanup.js` (`LINK_TYPES`, the table its
 * editor uses to sort a pasted URL), and the integer id beside it was read off that type's
 * page, `musicbrainz.org/relationship/<uuid>` ("ID: 192"). A platform goes in only when
 * URLCleanup files it under that type for an artist; one it does not (Snapchat, Telegram,
 * Discord, Substack, Pandora, Eventbrite…) is left out rather than guessed. The tip and
 * payment pages (PayPal, Cash App, Venmo, Ko-fi) are left out too: a payment page is not who
 * the artist is (the same rule as the fact card's identity links). Artist types: `Constants.pm`
 * (`$ARTIST_TYPE_PERSON => 1`, `$ARTIST_TYPE_GROUP => 2`).
 *
 * Pure: it reaches the Connect window through the Connections page.
 */
import { platformFromUrl, socialSlug } from '@samfox1/site-bridge/social'

const CREATE = 'https://musicbrainz.org/artist/create'

/** MusicBrainz's `artist_type` ids. */
export const MB_ARTIST_TYPE = { person: 1, group: 2 } as const

/** MusicBrainz's artist-to-URL `link_type` ids (see the header for where each was confirmed). */
export const MB_LINK_TYPE = {
  officialHomepage: 183, // fe33d22f-c3b0-4d68-bd53-a856badf2b15
  socialNetwork: 192, // 99429741-f3f6-484b-84f8-23af51991770
  freeStreaming: 194, // 769085a1-c2f7-4c24-a532-2375a77693bd
  paidStreaming: 978, // 63cc5d1f-f096-4c94-a43f-ecb32ea94161 ("Streaming")
  youtube: 193, // 6a540e5b-58c6-4192-b6ba-dbc71ec8fcf0
  youtubeMusic: 1080, // 631712a0-7525-42ba-b7a3-605aa7a238c4
  soundcloud: 291, // 89e4a949-0976-440d-bda1-5f772c1e5710
  bandcamp: 718, // c550166e-0548-4a18-b1d4-e2ae423a3e88
  songkick: 785, // aac9c4bc-a5b9-30b8-9839-e3ac314c6e58
  patronage: 897, // 6f77d54e-1d81-4e1a-9ea5-37947577151b
  videoChannel: 303, // d86c9450-b6d0-4760-a275-e7547495b48b
  discogs: 180, // 04a5b104-a4c2-4bac-99a1-7b837c37d9e4
  wikidata: 352, // 689870a4-a1e4-4912-b17f-7b2664215698
  otherDatabases: 188, // d94fb61c-fa20-4e3c-a19a-71a949fb2c55
  purchaseForDownload: 176, // f8319a2f-f824-4617-81c8-be6560b3b203
} as const

/** Each bridge platform's link type on an artist, as MusicBrainz's URLCleanup files it. */
export const MB_LINK_TYPE_OF: Readonly<Record<string, number>> = {
  instagram: MB_LINK_TYPE.socialNetwork,
  tiktok: MB_LINK_TYPE.socialNetwork,
  facebook: MB_LINK_TYPE.socialNetwork,
  x: MB_LINK_TYPE.socialNetwork,
  threads: MB_LINK_TYPE.socialNetwork,
  bluesky: MB_LINK_TYPE.socialNetwork,
  mixcloud: MB_LINK_TYPE.socialNetwork,
  spotify: MB_LINK_TYPE.freeStreaming,
  deezer: MB_LINK_TYPE.freeStreaming,
  audiomack: MB_LINK_TYPE.freeStreaming,
  'apple music': MB_LINK_TYPE.paidStreaming,
  tidal: MB_LINK_TYPE.paidStreaming,
  'amazon music': MB_LINK_TYPE.paidStreaming,
  youtube: MB_LINK_TYPE.youtube,
  'youtube music': MB_LINK_TYPE.youtubeMusic,
  soundcloud: MB_LINK_TYPE.soundcloud,
  bandcamp: MB_LINK_TYPE.bandcamp,
  songkick: MB_LINK_TYPE.songkick,
  patreon: MB_LINK_TYPE.patronage,
  twitch: MB_LINK_TYPE.videoChannel,
  vimeo: MB_LINK_TYPE.videoChannel,
  'resident advisor': MB_LINK_TYPE.otherDatabases,
  beatport: MB_LINK_TYPE.purchaseForDownload,
  discogs: MB_LINK_TYPE.discogs,
  wikidata: MB_LINK_TYPE.wikidata,
}

export type MusicBrainzSeed = {
  name: string
  /** Only when we know it. The SEO facts' "Musician" (MusicGroup) is the default for a solo
   *  act too, so it says nothing about person vs group; only "Visual artist" (Person) does. */
  type?: 'person' | 'group' | null
  /** The artist's city, from the SEO facts. */
  area?: string | null
  /** The artist's site: the official homepage. */
  homepage?: string | null
  /** The artist's profile links (label + url, as the `links` rows hold them). */
  links?: readonly { label: string | null; url: string | null }[]
}

/** A link as an https URL string (a bare site as its origin, no trailing slash), or null for
 *  anything else: http, `javascript:`, a link carrying a password, junk. */
function httpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  return u.pathname === '/' && !u.search && !u.hash ? u.origin : u.href
}

/**
 * The artist editor's address, pre-filled. Every value goes through URLSearchParams, so
 * nothing typed can add a parameter. External links: the homepage first, then each profile
 * whose label and link agree (the site's own reading, `platformFromUrl`) on a platform with a
 * confirmed type, https only, each once, numbered from 0 without gaps.
 */
export function musicBrainzCreateUrl(seed: MusicBrainzSeed): string {
  const q = new URLSearchParams()
  const name = seed.name.trim()
  if (name) q.set('edit-artist.name', name)
  if (seed.type) q.set('edit-artist.type_id', String(MB_ARTIST_TYPE[seed.type]))
  const area = seed.area?.trim()
  if (area) q.set('edit-artist.area.name', area)

  const urls: [string, number][] = []
  const add = (url: string, type: number) => {
    if (!urls.some(([u]) => u === url)) urls.push([url, type])
  }
  const home = httpsUrl(seed.homepage)
  if (home) add(home, MB_LINK_TYPE.officialHomepage)
  for (const l of seed.links ?? []) {
    const url = httpsUrl(l.url)
    const platform = url ? platformFromUrl(url) : null
    if (!url || !platform || platform.slug !== socialSlug(l.label ?? '')) continue
    const type = MB_LINK_TYPE_OF[platform.slug]
    if (type) add(url, type)
  }
  urls.forEach(([url, type], i) => {
    q.set(`edit-artist.url.${i}.text`, url)
    q.set(`edit-artist.url.${i}.link_type_id`, String(type))
  })

  const query = q.toString()
  return query ? `${CREATE}?${query}` : CREATE
}
