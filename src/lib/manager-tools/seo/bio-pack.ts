import { isIdentityProfileUrl, siteFacts } from '@samfox1/site-bridge/seo'
import { linkHost, platformFromUrl } from '@samfox1/site-bridge/social'
import { releaseIsReleased } from '@/lib/music'
import { RELEASE_TYPE_LABEL, RELEASE_TYPES, type ReleaseType } from '@/lib/releases'

/**
 * THE APPLE MUSIC & AMAZON BIO EMAIL (Sam, 2026-09-30, prototypes/profiles_bio_pack_20260930.html).
 *
 * Apple Music and Amazon Music show an artist bio that the artist can't edit: AllMusic (Xperi /
 * TiVo) writes it. This builds the email that asks them to: who is asking, the facts that say
 * WHICH artist (links on the platforms' own hosts, so a name shared with others is not
 * guessed), the artist's own words, the releases, and a press photo the manager attaches.
 *
 * Pure: the page reads the rows (tools/seo/profiles/load.ts), the card builds the pack in the
 * browser so a picked photo and the CC change it at once.
 *
 * RULES THAT ARE NOT TASTE:
 *   • The artist is NAMED, never "he", "she" or "they": we don't know, and Xperi copies wording.
 *   • A link goes in only when it is https AND on the platform's own host AND an artist profile
 *     there (the bridge's `isIdentityProfileUrl`, the same rule the fact card uses). A row's
 *     label never decides the platform: the url does. Role-bound rows (the USB button) and
 *     booking addresses never go in.
 *   • `mailtoHref` encodes every value, so nothing typed anywhere can add a header or a recipient.
 */

/** AllMusic's two intake addresses for artist bios (Apple coverage and the TiVo music desk). */
export const BIO_PACK_TO = ['apple.coverage.support@xperi.com', 'content.music@tivo.com'] as const

/** Under this, the bio check fires: Xperi writes from the facts given, so more helps. */
export const BIO_PACK_MIN_WORDS = 150

/** Releases listed, newest first. */
export const BIO_PACK_MAX_RELEASES = 10

export type BioPackLink = { label?: string | null; url?: string | null; role?: string | null }

/** A release as `get_public_releases` returns it (only the fields read here). `released` is the
 *  MANUAL flag only: a Spotify release reads false there and is still Released (`releaseIsReleased`
 *  also counts its source, spotify_id and platform links). */
export type BioPackRelease = {
  title: string
  release_date?: string | null
  release_type?: string | null
  released?: boolean | null
  source?: string | null
  spotify_id?: string | null
  links?: unknown
}

export type BioPackPhoto = { url: string; type?: string | null; width?: number | null; height?: number | null }

export type BioPackInput = {
  artist: { name: string; bio?: string | null; genre?: string | null; location?: string | null; spotify_artist_id?: string | null; schema_type?: string | null }
  /** Where the Facts tab keeps region and country (`fact_region`, `fact_country`). */
  site_content?: Readonly<Record<string, string | null | undefined>> | null
  /** The artist's own site (`publicSiteOrigin`). */
  site_url?: string | null
  links?: readonly BioPackLink[] | null
  /** `get_public_site`'s identity_links: connected profiles that are not buttons. */
  identity_links?: readonly BioPackLink[] | null
  releases?: readonly BioPackRelease[] | null
  photo?: BioPackPhoto | null
  /** The signed-in manager's name, for the sign-off. */
  manager_name?: string | null
}

export type BioPackCheck = { id: 'bio' | 'amazon' | 'apple' | 'photo' | 'cc'; text: string }

export type BioPack = { to: string[]; subject: string; body: string; checks: BioPackCheck[] }

/* ── text ── */

/** One line: every run of whitespace (line breaks included) is one space. */
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** "House" → "house", "Tech House" → "tech house"; "UK", "R&B" and "Hip-Hop" keep their case. */
const softCase = (s: string) =>
  s
    .split(' ')
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(' ')

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

/** A label column: the label, then spaces to line the values up. */
const LABEL_WIDTH = 15
const labelled = (label: string, value: string) => `${label.padEnd(LABEL_WIDTH)}${value}`

/* ── links ── */

/** The platforms the email names, in the order it names them. Keyed by the bridge's slug. */
const PLATFORM_ROWS = [
  { slug: 'apple music', label: 'Apple Music' },
  { slug: 'amazon music', label: 'Amazon Music' },
  { slug: 'spotify', label: 'Spotify' },
  { slug: 'instagram', label: 'Instagram' },
  { slug: 'youtube', label: 'YouTube' },
  { slug: 'soundcloud', label: 'SoundCloud' },
] as const
type PlatformSlug = (typeof PLATFORM_ROWS)[number]['slug']

/** An https URL, or null. */
function httpsUrl(raw: string | null | undefined): URL | null {
  if (typeof raw !== 'string') return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/** An Apple Music artist link in the US store, with no query: `/no/artist/skeen/1` and
 *  `/artist/skeen/1` both become `https://music.apple.com/us/artist/skeen/1`. */
function appleInUsStore(u: URL): string {
  const segs = u.pathname.split('/').filter(Boolean)
  const rest = /^[a-z]{2}$/i.test(segs[0] ?? '') ? segs.slice(1) : segs
  return `https://music.apple.com/us/${rest.join('/')}`
}

/** The link as the email states it, or null when it doesn't belong there: https only, an artist
 *  profile on the platform's own host, no tracking query. */
function profileUrlFor(slug: PlatformSlug, raw: string | null | undefined): string | null {
  const u = httpsUrl(raw)
  if (!u) return null
  const url = u.toString()
  if (platformFromUrl(url)?.slug !== slug || !isIdentityProfileUrl(url)) return null
  if (slug === 'apple music') return linkHost(url) === 'music.apple.com' ? appleInUsStore(u) : null
  return `${u.origin}${u.pathname}`
}

/** One url per platform: the first good one among the site's links, then its identity links. */
function platformLinks(input: BioPackInput): Partial<Record<PlatformSlug, string>> {
  const out: Partial<Record<PlatformSlug, string>> = {}
  const rows = [...(input.links ?? []), ...(input.identity_links ?? [])]
  for (const r of rows) {
    if (r.role) continue // bound to a site button (the USB playlist), not a profile
    for (const { slug } of PLATFORM_ROWS) {
      if (out[slug]) continue
      const url = profileUrlFor(slug, r.url)
      if (url) out[slug] = url
    }
  }
  const spotifyId = input.artist.spotify_artist_id
  if (!out.spotify && spotifyId && /^[A-Za-z0-9]+$/.test(spotifyId)) out.spotify = `https://open.spotify.com/artist/${spotifyId}`
  return out
}

/* ── releases ── */

const isReleaseType = (t: string | null | undefined): t is ReleaseType => (RELEASE_TYPES as readonly string[]).includes(t ?? '')

/** "single", "EP", "live set": the app's own label, lower case unless it is an abbreviation. */
function typeWord(t: string | null | undefined): string {
  if (!isReleaseType(t)) return ''
  const label = RELEASE_TYPE_LABEL[t]
  return label === label.toUpperCase() ? label : label.toLowerCase()
}

/** Released ones only (the app's rule, packages/music-rules), newest first (undated last), at
 *  most BIO_PACK_MAX_RELEASES. */
function releaseRows(releases: readonly BioPackRelease[]): string[] {
  const list = releases
    .filter((r) => releaseIsReleased({ source: r.source ?? null, spotify_id: r.spotify_id ?? null, links: r.links ?? null, released: r.released ?? null }) && oneLine(r.title))
    .map((r) => ({ title: oneLine(r.title), type: typeWord(r.release_type), date: /^\d{4}-\d{2}-\d{2}/.test(r.release_date ?? '') ? r.release_date!.slice(0, 10) : '' }))
    .sort((a, b) => (a.date === b.date ? 0 : !a.date ? 1 : !b.date ? -1 : a.date < b.date ? 1 : -1))
    .slice(0, BIO_PACK_MAX_RELEASES)
  const titleW = Math.max(0, ...list.map((r) => r.title.length)) + 3
  const typeW = Math.max(0, ...list.map((r) => r.type.length)) + 3
  return list.map((r) => `${r.title.padEnd(titleW)}${r.type.padEnd(typeW)}${r.date.slice(0, 4)}`.trimEnd())
}

/* ── the CC ── */

/**
 * The CC address, when it is ONE plain address: local@domain.tld, no spaces, commas,
 * semicolons, line breaks or percent signs, at most 254 characters (64 before the @). Anything
 * else is null and left out of the email entirely: a CC can add the artist, never a header or a
 * second recipient.
 */
export function ccAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 254) return null
  const m = /^([A-Za-z0-9._+-]+)@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,})$/.exec(s)
  if (!m) return null
  const local = m[1]
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null
  return s
}

/* ── the pack ── */

export function buildBioPack(input: BioPackInput, opts: { cc?: string | null } = {}): BioPack {
  const name = oneLine(input.artist.name)
  const bio = (input.artist.bio ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const genres = oneLine(input.artist.genre)
  const genreWord = softCase(oneLine(genres.split(',')[0]))
  const facts = siteFacts({ artist: { name, location: input.artist.location }, site_content: input.site_content ?? {} })
  const city = oneLine(facts.city)
  const basedIn = [facts.city, facts.region, facts.country].map(oneLine).filter(Boolean).join(', ')
  const place = city || basedIn
  const kind = genreWord ? `${genreWord} artist` : 'artist'
  /** "Chicago house artist", "house artist", "Chicago artist", or '' when neither is known. */
  const known = city || genreWord ? `${city ? `${city} ` : ''}${kind}` : ''

  const links = platformLinks(input)
  const site = httpsUrl(input.site_url)
  const releases = releaseRows(input.releases ?? [])
  const photo = input.photo?.url ? input.photo : null
  const manager = oneLine(input.manager_name)

  const intro = known || place ? `I manage ${name}, ${article(kind)} ${kind}${place ? ` based in ${place}` : ''}.` : `I manage ${name}.`
  const artistRows = [
    labelled('Name', name),
    basedIn ? labelled('Based in', basedIn) : '',
    genres ? labelled(genres.includes(',') ? 'Genres' : 'Genre', genres) : '',
    site ? labelled('Official site', `${site.origin}${site.pathname === '/' ? '' : site.pathname}`) : '',
    ...PLATFORM_ROWS.map((p) => (links[p.slug] ? labelled(p.label, links[p.slug]!) : '')),
  ].filter(Boolean)
  const listed = artistRows.length > 1
  const photoFacts = photo ? [oneLine(photo.type), photo.width && photo.height ? `${photo.width} x ${photo.height}` : ''].filter(Boolean).join(', ') : ''

  const blocks = [
    'Hello,',
    `${intro} Could you add a biography for ${name} on Apple Music and Amazon Music?`,
    ['THE ARTIST', ...artistRows].join('\n'),
    `Other artists share the name ${name}. This is the ${known || 'artist'}${listed ? ' at the links above' : ''}.`,
    bio ? `IN THE ARTIST'S WORDS\n${bio}` : '',
    releases.length ? ['RELEASES', ...releases].join('\n') : '',
    photo ? `A press photo is attached${photoFacts ? ` (${photoFacts})` : ''}.` : '',
    manager ? `Thank you,\n${manager}` : 'Thank you,',
  ].filter(Boolean)

  const words = wordCount(bio)
  const checks: BioPackCheck[] = []
  if (words < BIO_PACK_MIN_WORDS) checks.push({ id: 'bio', text: words ? `Bio is ${words} ${words === 1 ? 'word' : 'words'}. They write their own from it, so more facts help.` : 'No bio yet.' })
  if (!links['amazon music']) checks.push({ id: 'amazon', text: 'No Amazon Music link yet.' })
  if (!links['apple music']) checks.push({ id: 'apple', text: 'No Apple Music link yet.' })
  if (!photo) checks.push({ id: 'photo', text: 'No photo yet.' })
  if (!ccAddress(opts.cc)) checks.push({ id: 'cc', text: `Add ${name}’s email so ${name} gets a copy.` })

  return {
    to: [...BIO_PACK_TO],
    subject: `Biography: ${name}${known ? `, ${known}` : ''}`,
    body: blocks.join('\n\n'),
    checks,
  }
}

/* ── sending ── */

/** A recipient we send to: one plain address, nothing that could start a query or a list. */
const isPlainAddress = (s: string) => /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)

/** Over this many characters, some mail apps cut a `mailto:` short without a word (a 150-word bio
 *  and ten releases is about 2,500), so the card points to Copy instead. */
export const MAILTO_SAFE_LENGTH = 2000

/** CRLF line breaks, as a mail body wants them. */
const crlf = (s: string) => s.replace(/\r\n|\r|\n/g, '\r\n')

/**
 * The `mailto:` that opens the email in the manager's mail app: the Xperi addresses, then
 * `?cc=` (one valid address, when given) `&subject=…&body=…`. Every value is
 * `encodeURIComponent`-ed and line breaks become %0D%0A, so a `?`, `&`, `#`, `%` or newline
 * typed into a bio, a title or the CC stays inside its own value and can never add a header.
 */
export function mailtoHref(pack: Pick<BioPack, 'to' | 'subject' | 'body'>, opts: { cc?: string | null } = {}): string {
  const to = pack.to.filter(isPlainAddress).join(',')
  const cc = ccAddress(opts.cc)
  const params = [cc ? `cc=${encodeURIComponent(cc)}` : '', `subject=${encodeURIComponent(oneLine(pack.subject))}`, `body=${encodeURIComponent(crlf(pack.body))}`].filter(Boolean)
  return `mailto:${to}?${params.join('&')}`
}

/** The email as text, for Copy: To, Cc (a valid one only), Subject, then the body. */
export function emailText(pack: Pick<BioPack, 'to' | 'subject' | 'body'>, opts: { cc?: string | null } = {}): string {
  const cc = ccAddress(opts.cc)
  return [`To: ${pack.to.filter(isPlainAddress).join(', ')}`, cc ? `Cc: ${cc}` : '', `Subject: ${oneLine(pack.subject)}`, '', pack.body].filter((l, i) => l || i === 3).join('\n')
}

/** "JPEG", "PNG", "WebP" from a file path or url, or null. */
export function photoTypeOf(path: string): string | null {
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(path)?.[1]?.toLowerCase()
  return ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : ext === 'png' ? 'PNG' : ext === 'webp' ? 'WebP' : null
}
