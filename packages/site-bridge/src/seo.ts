/**
 * SEO / GEO builders (SEO_GEO_PLAN B4). Pure functions over the public payload: no DOM,
 * no HTML, no clock. A site calls them from `generateMetadata`, `sitemap.ts`,
 * `robots.ts` and an inline `<script type="application/ld+json">`; the bridge never
 * decides how any of it is rendered.
 *
 * The one rule underneath every builder: nothing is invented. Every string comes from
 * the published payload (the artist's facts, the manager's SEO overrides, the shows
 * and songs); an unset field is left out of the graph, never filled with a guess.
 */
import type { PublicSitePayload, SiteRelease, SiteTourDate, SiteTrack, SiteVideo, WireMedia } from './payload'
import { linkHost } from './social'
import { recommendAlt } from './alt'

/**
 * The artist's name, TRIMMED — the one spelling every SEO surface uses.
 *
 * A normaliser rather than a `.trim()` at each call site, because the per-consumer
 * version is what went wrong: the 0.34.1 no-name fix trimmed it inside `autoFaqAnswer`
 * and left `probePrompts` reading the raw value, so a name with a trailing space
 * rendered "Who is Skeen , the musician?" directly above "Skeen's official website is
 * …" — one artist, two spellings, on the page whose whole job is to be quoted verbatim
 * (2026-09-03 review). Nothing trims `artists.name` on the way in, so this is the
 * boundary.
 *
 * Empty means NO NAME, and callers treat that as "say nothing" rather than interpolating
 * a hole into a sentence.
 */
function artistName(a: { name?: string | null } | null | undefined): string {
  return (a?.name ?? '').trim()
}

export type SiteSeo = {
  /** <title> and og:title. */
  title: string
  /** meta description, og:description, twitter:description. Always non-empty. */
  description: string
  /** Absolute https URL for the social preview card, or null when none is publishable. */
  ogImage: string | null
  /** `og:image:width` / `og:image:height`, when the size is KNOWN: the SEO page's card is
   *  always drawn at 1200×630. Null for any other image (a hero photo's size is not on the
   *  wire), and absent on a SiteSeo built before 0.42.0 — read with `?? null`. */
  ogImageSize?: { width: number; height: number } | null
}

export const MAX_DESCRIPTION = 160

/** The most a `<title>` may be: lone-star's save cap on `seo_title` (SEO_LIMITS), and so
 *  the most a composed default may be too. */
export const MAX_TITLE = 70

/** The SEO page's social card: drawn at exactly this size, stored at one fixed path per
 *  artist (`<artist>/og/social-card.png` in the public `media` bucket). */
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const
const OG_CARD_PATH = /^\/storage\/v1\/object\/public\/media\/[^/]+\/og\/social-card\.png$/

function ogCardSize(url: string | null): { width: number; height: number } | null {
  if (!url) return null
  try {
    return OG_CARD_PATH.test(new URL(url).pathname) ? { ...OG_CARD_SIZE } : null
  } catch {
    return null
  }
}

/** A genre mid-sentence: lowercased word by word, except an all-caps word (UK, R&B, EDM),
 *  which is an acronym and keeps its spelling. */
function genreWords(g: string): string {
  return g
    .split(' ')
    .map((w) => (/[A-Z]/.test(w) && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(' ')
}

/**
 * The title when the manager has not written one (audit #1, Sam 2026-09-28: "Skeen ·
 * Chicago house DJ and producer"): the name, then city + genre + role from the facts.
 *
 * ONLY facts that exist. The role is the artist type the facts page sets (Musician →
 * "musician", Visual artist → "artist"); with no type there is no role word, never a
 * guessed "DJ". The city is the first part of the place ("Chicago, IL" → "Chicago"), the
 * genre the first one listed. Over MAX_TITLE, parts drop (role, then city, then genre)
 * rather than the title being cut mid-word. No facts → the bare name; no name → ''.
 */
export function defaultSeoTitle(a: { name?: string | null; genre?: string | null; location?: string | null; schema_type?: 'MusicGroup' | 'Person' | null } | null | undefined): string {
  const name = artistName(a)
  if (!name) return ''
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  const city = flat((a?.location ?? '').split(',')[0] ?? '')
  const firstGenre = (a?.genre ?? '').split(',').map(flat).find(Boolean) ?? ''
  const genre = firstGenre ? genreWords(firstGenre) : ''
  const role = a?.schema_type === 'Person' ? 'artist' : a?.schema_type === 'MusicGroup' ? 'musician' : ''
  const tries = [[city, genre, role], [city, genre], [genre, role], [genre], [city, role], [city], [role]]
  for (const parts of tries) {
    const said = parts.filter(Boolean).join(' ')
    if (said && name.length + 3 + said.length <= MAX_TITLE) return `${name} · ${said}`
  }
  return name
}

/** http(s) URLs only: a `javascript:` or `data:` value in a meta tag is a sink. */
export function safeHttpUrl(raw: unknown): string | null {
  // `unknown` on purpose: values arrive from JSON (a release's links jsonb, a manager's
  // site_content); anything that is not a string is not a URL, not a crash.
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!/^https?:\/\//i.test(s)) return null
  try {
    return new URL(s).toString()
  } catch {
    return null
  }
}

function toDescription(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : flat
}

type SeoSource = Pick<PublicSitePayload, 'artist' | 'site_content'>

/** Title/description/image with the precedence every site and template share:
 *  manager override → the artist's own data → a dull, honest default. */
export function resolveSeo(payload: SeoSource): SiteSeo {
  const c = payload.site_content ?? {}
  const name = (payload.artist?.name ?? '').trim()
  // The manager's own title always wins; blank = composed from the facts (audit #1).
  const title = (c.seo_title ?? '').trim() || defaultSeoTitle(payload.artist)
  const override = (c.seo_description ?? '').trim()
  const bio = (payload.artist?.bio ?? '').trim()
  // The last fallback needs a NAME, not just a trimmed one. Without it the description
  // read " — official site" and went into every page's <meta> and Open Graph card
  // (2026-09-04 audit, F1). An empty description is omitted downstream; a dash with
  // nothing in front of it is not.
  const fallback = name ? `${name} — official site` : ''
  const description = override ? toDescription(override) : bio ? toDescription(bio) : fallback
  const card = safeHttpUrl(c.og_image)
  const ogImage = card ?? safeHttpUrl(payload.artist?.hero_image_url) ?? null
  return { title, description, ogImage, ogImageSize: ogCardSize(card) }
}

/* ----------------------------------------------------------------------------------
 * JSON-LD
 * -------------------------------------------------------------------------------- */

export type { SiteRelease } from './payload'

export type JsonLdOptions = {
  /** `https://www.example.com` — no trailing slash. */
  origin: string
  /** Releases for MusicAlbum entries; omit and no albums are emitted. */
  releases?: readonly SiteRelease[] | null
  /** The artist's photo (or wordmark) URL for `image`. Never the `logo`: see `mediaUrl`. */
  imageUrl?: string | null
  /**
   * Turns a media row's storage `path` into its public URL (the `media` bucket). With it,
   * a MusicGroup's `logo` is the Brand page's primary logo (`logo_primary`) when the
   * payload carries one. Without it, or with no Brand logo, there is no `logo` at all:
   * never the `imageUrl` photo, which is what a 1600×800 hero became (audit #9).
   */
  mediaUrl?: (path: string) => string
  /**
   * The images the page actually SHOWS, and how: return the rendered `<img src>` (the
   * same URL, so Google can pair the node with the picture) and the alt it carries, or
   * null to leave that media row out. Omit and no image entries are emitted — the bridge
   * cannot know which rows a site places. Pass the same function that renders your alts.
   */
  listImage?: (m: WireMedia) => { url: string; alt?: string | null } | null
  /** Turns an uploaded video's `storage_path` into its public URL (VideoObject.contentUrl). */
  videoUrl?: (path: string) => string
  /** A poster image URL for an uploaded video, when the site has one. Without a thumbnail
   *  an uploaded video is left out (Google requires thumbnailUrl). */
  videoPoster?: (v: SiteVideo) => string | null | undefined
  /** ISO date (YYYY-MM-DD). Shows on or after it are upcoming; omit to trust `is_past`. */
  today?: string
  /** The /about page URL when the bio lives there, so the graph can point at it. */
  aboutUrl?: string | null
}

type Node = Record<string, unknown>

const RELEASE_TYPE: Record<string, string> = {
  single: 'SingleRelease',
  ep: 'EPRelease',
  album: 'AlbumRelease',
}

function isUpcoming(show: SiteTourDate, today?: string): boolean {
  if (!show.date) return false
  // The manager's flag wins over the calendar: a show marked past (done, cancelled) is
  // never advertised, whatever its date says — the page lists it under Past too.
  if (show.is_past === true) return false
  if (today) return show.date.slice(0, 10) >= today
  return true
}

/* ----------------------------------------------------------------------------------
 * Profile URLs, per platform (audit #2)
 * -------------------------------------------------------------------------------- */

/**
 * One platform's profile rule: which hosts are it, what a PROFILE path looks like there,
 * and whether that profile is an IDENTITY (who the artist is) or only a page they own (a
 * tip jar, a ticket organiser).
 *
 * Matched by HOST here, not through `platformFromUrl`, so the music databases (MusicBrainz,
 * Discogs, Wikidata) work whether or not they are in SOCIAL_PLATFORMS, and a new platform
 * in that list reaches `sameAs` only once someone writes its profile shape below. Hosts
 * come from `linkHost` (lowercased, no `www.`). An unknown host is nobody's profile.
 */
type ProfileRule = { match: (host: string) => boolean; profile: (segs: string[], u: URL, host: string) => boolean; identity: boolean }

const exactly = (...hosts: string[]) => (host: string) => hosts.includes(host)
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** One path segment, handle-shaped, and not one of the platform's own pages. */
const oneSeg = (reserved: readonly string[], shape: RegExp = HANDLE) => (s: string[]) => s.length === 1 && shape.test(s[0]) && !reserved.includes(s[0].toLowerCase())
/** Drop a leading locale segment (`/us/artist/…`, `/de/artist/…`). */
const unlocale = (s: string[]) => (/^[a-z]{2}$/.test(s[0] ?? '') ? s.slice(1) : s)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YT_TABS = ['featured', 'videos', 'shorts', 'streams', 'releases', 'playlists', 'community', 'about', 'podcasts']
const AMAZON_MUSIC = /^music\.amazon\.(com|co\.uk|de|fr|it|es|co\.jp|ca|com\.au|in|com\.br|com\.mx)$/
/** Eventbrite's own domains, listed (never "any TLD": `eventbrite.co.uk.evil.net` is not it). */
const EVENTBRITE_TLDS = ['com', 'co.uk', 'ca', 'com.au', 'co.nz', 'ie', 'de', 'fr', 'es', 'it', 'nl', 'be', 'at', 'ch', 'pt', 'se', 'dk', 'fi', 'com.br', 'com.mx', 'com.ar', 'cl', 'com.pe', 'hk', 'sg']
const EVENTBRITE = new RegExp(`^(?:([a-z0-9-]+)\\.)?eventbrite\\.(?:${EVENTBRITE_TLDS.map((t) => t.replace('.', '\\.')).join('|')})$`)
/** Eventbrite's own subdomains, which are not an organiser's page. */
const EVENTBRITE_RESERVED = ['help', 'api', 'developer', 'blog', 'status', 'community', 'm']

function youtubeChannel(s: string[]): boolean {
  const base = s.length && YT_TABS.includes(s[s.length - 1].toLowerCase()) ? s.slice(0, -1) : s
  if (base.length === 1) return /^@[\w.-]+$/.test(base[0])
  return base.length === 2 && ['channel', 'c', 'user'].includes(base[0])
}

const FB_RESERVED = ['events', 'groups', 'watch', 'marketplace', 'gaming', 'share', 'sharer', 'hashtag', 'reel', 'reels', 'stories', 'login', 'help', 'photo', 'photos', 'video', 'videos', 'search', 'settings', 'notifications', 'messages']
function facebookProfile(s: string[], u: URL): boolean {
  if (s.length === 1 && s[0] === 'profile.php') return /^\d+$/.test(u.searchParams.get('id') ?? '')
  if (s.length === 1) return HANDLE.test(s[0]) && !s[0].endsWith('.php') && !FB_RESERVED.includes(s[0].toLowerCase())
  return s.length === 3 && (s[0] === 'people' || s[0] === 'pages') && /^\d+$/.test(s[2])
}

const PROFILE_RULES: readonly ProfileRule[] = [
  // Music platforms. The narrow hosts first: music.youtube.com is not youtube.com.
  { match: exactly('music.youtube.com'), profile: (s) => s.length === 2 && s[0] === 'channel', identity: true },
  { match: exactly('youtube.com', 'm.youtube.com'), profile: youtubeChannel, identity: true },
  // Spotify `/user/` is a LISTENER account, not the artist (audit #2): artist pages only.
  { match: exactly('open.spotify.com'), profile: (s) => { const t = /^intl-[a-z-]+$/i.test(s[0] ?? '') ? s.slice(1) : s; return t.length === 2 && t[0] === 'artist' && /^[A-Za-z0-9]+$/.test(t[1]) }, identity: true },
  { match: exactly('music.apple.com'), profile: (s) => { const t = unlocale(s); return t[0] === 'artist' && (t.length === 2 || t.length === 3) && /^(id)?\d+$/.test(t[t.length - 1]) }, identity: true },
  { match: (h) => AMAZON_MUSIC.test(h), profile: (s) => (s.length === 2 || s.length === 3) && s[0] === 'artists' && /^[A-Z0-9]{10}$/i.test(s[1]), identity: true },
  { match: exactly('soundcloud.com', 'm.soundcloud.com'), profile: oneSeg(['discover', 'search', 'charts', 'stream', 'upload', 'you', 'feed', 'pages', 'settings', 'messages', 'notifications', 'tags', 'stations', 'jobs', 'mobile', 'imprint', 'popular', 'people', 'pro', 'artists', 'signin', 'terms-of-use']), identity: true },
  // An artist's own subdomain; `bandcamp.com/<name>` is a FAN account.
  { match: (h) => /^[a-z0-9-]+\.bandcamp\.com$/.test(h) && h !== 'daily.bandcamp.com', profile: (s) => s.length === 0 || (s.length === 1 && s[0] === 'music'), identity: true },
  { match: exactly('deezer.com'), profile: (s) => { const t = unlocale(s); return t.length === 2 && t[0] === 'artist' && /^\d+$/.test(t[1]) }, identity: true },
  { match: exactly('tidal.com', 'listen.tidal.com'), profile: (s) => { const t = s[0] === 'browse' ? s.slice(1) : s; return t.length === 2 && t[0] === 'artist' && /^\d+$/.test(t[1]) }, identity: true },
  { match: exactly('audiomack.com'), profile: oneSeg(['search', 'trending-now', 'songs', 'albums', 'playlists', 'discover', 'world', 'upload', 'dashboard', 'premium', 'about', 'login', 'join', 'charts', 'recent']), identity: true },
  { match: exactly('mixcloud.com', 'm.mixcloud.com'), profile: oneSeg(['discover', 'upload', 'live', 'select', 'search', 'categories', 'dashboard', 'settings', 'about', 'pro', 'careers', 'tag', 'player']), identity: true },
  { match: exactly('beatport.com'), profile: (s) => s.length === 3 && s[0] === 'artist' && /^\d+$/.test(s[2]), identity: true },
  { match: exactly('pandora.com'), profile: (s) => s.length === 3 && s[0] === 'artist' && /^AR/i.test(s[2]), identity: true },
  // Music databases and listings.
  { match: exactly('musicbrainz.org', 'beta.musicbrainz.org'), profile: (s) => s.length === 2 && s[0] === 'artist' && UUID.test(s[1]), identity: true },
  { match: exactly('discogs.com'), profile: (s) => { const t = unlocale(s); return t.length === 2 && t[0] === 'artist' && /^\d+(-[^/]+)?$/.test(t[1]) }, identity: true },
  { match: exactly('wikidata.org', 'm.wikidata.org'), profile: (s) => s.length === 2 && (s[0] === 'wiki' || s[0] === 'entity') && /^Q\d+$/.test(s[1]), identity: true },
  { match: exactly('ra.co', 'residentadvisor.net'), profile: (s) => s.length === 2 && s[0] === 'dj' && HANDLE.test(s[1]), identity: true },
  { match: exactly('songkick.com'), profile: (s) => s.length === 2 && s[0] === 'artists' && /^\d+/.test(s[1]), identity: true },
  // Social.
  { match: exactly('instagram.com'), profile: oneSeg(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv', 'direct', 'about', 'developer', 'legal', 'web', 'challenge', 'emails', 'lite']), identity: true },
  { match: exactly('tiktok.com', 'm.tiktok.com'), profile: (s) => s.length === 1 && /^@[A-Za-z0-9._]+$/.test(s[0]), identity: true },
  { match: exactly('facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com'), profile: facebookProfile, identity: true },
  { match: exactly('x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com'), profile: oneSeg(['home', 'explore', 'search', 'i', 'intent', 'share', 'hashtag', 'settings', 'messages', 'notifications', 'login', 'signup', 'tos', 'privacy', 'compose'], /^[A-Za-z0-9_]{1,15}$/), identity: true },
  { match: exactly('threads.com', 'threads.net'), profile: (s) => s.length === 1 && /^@[A-Za-z0-9._]+$/.test(s[0]), identity: true },
  { match: exactly('bsky.app'), profile: (s) => s.length === 2 && s[0] === 'profile', identity: true },
  { match: exactly('snapchat.com'), profile: (s) => (s.length === 2 && s[0] === 'add' && HANDLE.test(s[1])) || (s.length === 1 && /^@[A-Za-z0-9._-]+$/.test(s[0])), identity: true },
  { match: exactly('twitch.tv', 'm.twitch.tv'), profile: oneSeg(['videos', 'directory', 'p', 'downloads', 'jobs', 'settings', 'subscriptions', 'turbo', 'search', 'wallet', 'inventory', 'drops', 'prime', 'store']), identity: true },
  // A numeric path on Vimeo is a VIDEO.
  { match: exactly('vimeo.com'), profile: (s) => oneSeg(['channels', 'groups', 'ondemand', 'showcase', 'watch', 'search', 'upload', 'features', 'join', 'log_in', 'categories', 'blog', 'help', 'pricing'])(s) && !/^\d+$/.test(s[0]), identity: true },
  { match: (h) => h === 'substack.com' || /^[a-z0-9-]+\.substack\.com$/.test(h), profile: (s, _u, h) => (h === 'substack.com' ? s.length === 1 && /^@[A-Za-z0-9._-]+$/.test(s[0]) : s.length === 0), identity: true },
  // Creator and organiser pages that name the artist (Sam, 2026-09-28: "all the
  // connections and links"): a membership, a tip page, a ticket organiser, a public
  // Telegram channel. Never an invite (`t.me/+…`, `joinchat`): the name must be a handle.
  { match: exactly('patreon.com'), profile: (s) => oneSeg(['posts', 'join', 'checkout', 'login', 'home', 'search', 'explore', 'messages', 'settings', 'notifications', 'signup'])(s) || (s.length === 2 && s[0] === 'c' && HANDLE.test(s[1])), identity: true },
  { match: exactly('ko-fi.com'), profile: oneSeg(['explore', 'manage', 'account', 'login', 'signup', 'shop', 'about']), identity: true },
  {
    match: (h) => EVENTBRITE.test(h),
    // `/o/<organiser>` on the main site, or an organiser's own `<name>.eventbrite.*` root.
    profile: (s, _u, h) => {
      const sub = EVENTBRITE.exec(h)?.[1]
      return sub ? !EVENTBRITE_RESERVED.includes(sub) && s.length === 0 : s.length === 2 && s[0] === 'o' && HANDLE.test(s[1])
    },
    identity: true,
  },
  { match: exactly('t.me', 'telegram.me'), profile: oneSeg(['joinchat', 'addstickers', 'addemoji', 'addtheme', 'share', 'proxy', 'socks', 'iv', 'login', 'setlanguage', 'confirmphone', 'contact', 'boost', 'invoice'], /^[A-Za-z][A-Za-z0-9_]{3,31}$/), identity: true },
  // Payment handles: profile-shaped, never `sameAs` (they can carry a personal legal
  // name). Discord and WhatsApp have no rule at all: an invite or chat link is not a profile.
  { match: exactly('cash.app'), profile: (s) => s.length === 1 && /^\$[A-Za-z0-9_-]+$/.test(s[0]), identity: false },
  { match: exactly('venmo.com', 'account.venmo.com'), profile: (s) => s.length === 2 && s[0] === 'u' && HANDLE.test(s[1]), identity: false },
  { match: exactly('paypal.me'), profile: oneSeg([]), identity: false },
  { match: exactly('paypal.com'), profile: (s) => s.length === 2 && s[0] === 'paypalme' && HANDLE.test(s[1]), identity: false },
]

function profileRule(url: string): ProfileRule | null {
  if (typeof url !== 'string') return null
  const host = linkHost(url)
  if (!host) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  const segs = u.pathname.split('/').filter(Boolean)
  const rule = PROFILE_RULES.find((r) => r.match(host))
  return rule && rule.profile(segs, u, host) ? rule : null
}

/** Is this a PROFILE page on a platform we know, shaped the way that platform shapes one
 *  (not a playlist, a track, a video, a set or a post)? Unknown host = no. */
export function isProfileUrl(url: string): boolean {
  return profileRule(url) !== null
}

/**
 * Is this the artist's own profile on an IDENTITY platform, so `sameAs` may assert it IS
 * the artist? True for streaming, social, music-database and listing profiles, and for
 * creator and organiser pages that name the artist (Patreon, Ko-fi, an Eventbrite
 * organiser, a public Telegram channel). FALSE for a payment handle (PayPal, Cash App,
 * Venmo: it can carry a personal legal name), a join or invite link (Discord, WhatsApp,
 * `t.me/+…`), a playlist, a video, a post, a listener account (Spotify `/user/`), and any
 * host not listed above.
 *
 * lone-star uses this same function to decide which connected profiles ride the wire as
 * `identity_links`, so the two sides cannot disagree.
 */
export function isIdentityProfileUrl(url: string): boolean {
  return profileRule(url)?.identity === true
}

/** The same profile spelled two ways (`www.`, a trailing slash, a share-tracking query)
 *  is one `sameAs` entry. The FIRST spelling seen is the one kept. */
function profileKey(url: string): string {
  const u = new URL(url)
  for (const k of [...u.searchParams.keys()]) if (/^(utm_.*|si|igsh|igshid|fbclid|ref|feature)$/i.test(k)) u.searchParams.delete(k)
  u.searchParams.sort()
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`
}

/**
 * Every identity profile the artist has published, de-duplicated: the on-site `links`
 * (buttons), then `identity_links` (connected profiles that are not buttons, audit #2),
 * then the Spotify artist id's own page. Only `isIdentityProfileUrl` URLs, http(s) only.
 */
export function sameAsFrom(payload: Pick<PublicSitePayload, 'links' | 'artist' | 'identity_links'>): string[] {
  const out = new Map<string, string>()
  const add = (raw: unknown) => {
    const url = safeHttpUrl(raw)
    if (!url || !isIdentityProfileUrl(url)) return
    const key = profileKey(url)
    if (!out.has(key)) out.set(key, url)
  }
  for (const l of payload.links ?? []) add(l?.url)
  const identity = payload.identity_links
  for (const l of Array.isArray(identity) ? identity : []) add(l?.url)
  const spotify = payload.artist?.spotify_artist_id
  if (spotify && /^[A-Za-z0-9]+$/.test(spotify)) add(`https://open.spotify.com/artist/${spotify}`)
  return [...out.values()]
}

/* ----------------------------------------------------------------------------------
 * The facts that tell this artist from others with the same name (0.43.0)
 * AI_VISIBILITY_AUDIT.md §2 item 7 / code pass F13: "Portland" alone is ambiguous, and a
 * crowded name needs its other spellings and a start year to be told apart.
 * -------------------------------------------------------------------------------- */

/**
 * The `site_content` keys the facts ride in. Ordinary site text, so they publish with the
 * site and reach a connected site on the payload it already reads, with no new column.
 * ONE registry: lone-star's SEO_FIELDS and its save gate derive their keys from this.
 *
 * The CITY is not here. It is `artist.location` ("Based in"), where it has always been, so
 * the title (`defaultSeoTitle`) and every older bridge keep reading it.
 *
 *  • region       plain text ("Illinois", "IL", "Bavaria")
 *  • country      plain text; a known name or code also resolves to its ISO code (`countryOf`)
 *  • aliases      other names the artist goes by, ONE PER LINE (`parseAliases`)
 *  • activeSince  a four-digit year
 *
 * Read them through `siteFacts`, never raw: it re-applies every rule, so a value that
 * reached the table some other way than the save gate is dropped rather than stated.
 */
export const FACT_CONTENT_KEYS = {
  region: 'fact_region',
  country: 'fact_country',
  aliases: 'fact_aliases',
  activeSince: 'fact_active_since',
} as const

export const MAX_ALIASES = 5
/** Per alias, in characters (code points), not UTF-16 units. */
export const MAX_ALIAS_LENGTH = 60
/** Region and country, each, in characters. */
export const MAX_PLACE_PART_LENGTH = 60
export const EARLIEST_ACTIVE_YEAR = 1900

/** Invisible formatting a manager cannot see and a crawler should not get: soft hyphen,
 *  Arabic letter mark, Mongolian vowel separator, zero-width space, LRM/RLM, the bidi
 *  embeddings, overrides and isolates, word joiner and invisible operators, and a BOM.
 *  ZWNJ/ZWJ (U+200C/D) stay: Persian and Indic spelling and emoji sequences need them. */
const INVISIBLE = /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
/** C0 and C1 controls, DEL included. Tab and newline are controls too: all become spaces. */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g
/** A lone surrogate half (the `u` flag makes a valid pair one code point, so only a lone
 *  half matches). It cannot be stored as text, and it is not a character anyone typed. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu

/**
 * One line of plain text from whatever arrives: NFC, invisible formatting removed, control
 * characters and every run of whitespace collapsed to one space, trimmed. Not a string = ''.
 *
 * A NORMALISER, not a sanitiser: markup is left as text (`jsonLdScript` escapes `<`, and a
 * site renders facts as text), because deciding what a manager "meant" is not the reader's
 * job. lone-star's save gate refuses markup and control characters before they are stored.
 */
export function factText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFC').replace(LONE_SURROGATE, '').replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
}

const chars = (s: string) => Array.from(s).length

/** How two aliases (or an alias and the name) compare: as text, ignoring case. Accents
 *  count ("Beyoncé" and "Beyonce" are two spellings people search). */
function aliasKey(s: string): string {
  return factText(s).toLowerCase()
}

/**
 * The stored alias list (one per line) as the names to state: each through `factText`,
 * blanks dropped, never the artist's own name, no repeats (ignoring case), an alias over
 * MAX_ALIAS_LENGTH dropped (never cut), and at most MAX_ALIASES. First spelling wins.
 */
export function parseAliases(raw: unknown, name?: string | null): string[] {
  if (typeof raw !== 'string') return []
  const own = aliasKey(name ?? '')
  const seen = new Set<string>(own ? [own] : [])
  const out: string[] = []
  for (const line of raw.split(/\r\n?|\n/)) {
    const alias = factText(line)
    const key = alias.toLowerCase()
    if (!alias || chars(alias) > MAX_ALIAS_LENGTH || seen.has(key)) continue
    seen.add(key)
    out.push(alias)
    if (out.length === MAX_ALIASES) break
  }
  return out
}

/**
 * A SMALL country table (ISO 3166-1 alpha-2): the markets a manager is likely to type, and
 * the spellings they are likely to type them in. Not the whole standard on purpose — an
 * unknown country is still stated, as typed (schema.org's `addressCountry` takes text too),
 * so a missing row costs only the code, never the fact.
 *
 * Deliberately NOT here: spellings that could mean two places ("Korea", "Congo", "America")
 * and the UK's nations ("England", "Scotland"), which a manager may mean as written. A
 * spelling here must resolve to exactly one country (the test checks every one).
 */
export const COUNTRIES: readonly { code: string; name: string; aliases?: readonly string[] }[] = [
  // Americas
  { code: 'US', name: 'United States', aliases: ['United States of America', 'USA'] },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico', aliases: ['México'] },
  { code: 'BR', name: 'Brazil', aliases: ['Brasil'] },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru', aliases: ['Perú'] },
  { code: 'VE', name: 'Venezuela' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'PA', name: 'Panama', aliases: ['Panamá'] },
  { code: 'GT', name: 'Guatemala' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'CU', name: 'Cuba' },
  { code: 'DO', name: 'Dominican Republic' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'TT', name: 'Trinidad and Tobago', aliases: ['Trinidad & Tobago'] },
  // Europe
  { code: 'GB', name: 'United Kingdom', aliases: ['UK', 'Great Britain', 'Britain'] },
  { code: 'IE', name: 'Ireland', aliases: ['Éire'] },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany', aliases: ['Deutschland'] },
  { code: 'NL', name: 'Netherlands', aliases: ['Holland', 'Nederland'] },
  { code: 'BE', name: 'Belgium', aliases: ['België', 'Belgique'] },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'CH', name: 'Switzerland', aliases: ['Schweiz', 'Suisse'] },
  { code: 'AT', name: 'Austria', aliases: ['Österreich'] },
  { code: 'IT', name: 'Italy', aliases: ['Italia'] },
  { code: 'ES', name: 'Spain', aliases: ['España'] },
  { code: 'PT', name: 'Portugal' },
  { code: 'DK', name: 'Denmark', aliases: ['Danmark'] },
  { code: 'SE', name: 'Sweden', aliases: ['Sverige'] },
  { code: 'NO', name: 'Norway', aliases: ['Norge'] },
  { code: 'FI', name: 'Finland', aliases: ['Suomi'] },
  { code: 'IS', name: 'Iceland' },
  { code: 'PL', name: 'Poland', aliases: ['Polska'] },
  { code: 'CZ', name: 'Czechia', aliases: ['Czech Republic'] },
  { code: 'SK', name: 'Slovakia' },
  { code: 'HU', name: 'Hungary' },
  { code: 'RO', name: 'Romania' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'GR', name: 'Greece' },
  { code: 'HR', name: 'Croatia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'RS', name: 'Serbia' },
  { code: 'BA', name: 'Bosnia and Herzegovina' },
  { code: 'ME', name: 'Montenegro' },
  { code: 'MK', name: 'North Macedonia' },
  { code: 'AL', name: 'Albania' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'BY', name: 'Belarus' },
  { code: 'MD', name: 'Moldova' },
  { code: 'EE', name: 'Estonia' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'MT', name: 'Malta' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'TR', name: 'Türkiye', aliases: ['Turkey'] },
  { code: 'RU', name: 'Russia', aliases: ['Russian Federation'] },
  { code: 'GE', name: 'Georgia' },
  { code: 'AM', name: 'Armenia' },
  // Asia, the Middle East
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea', aliases: ['Republic of Korea'] },
  { code: 'CN', name: 'China' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam', aliases: ['Viet Nam'] },
  { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'NP', name: 'Nepal' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'IL', name: 'Israel' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'JO', name: 'Jordan' },
  { code: 'AE', name: 'United Arab Emirates', aliases: ['UAE'] },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' },
  // Oceania
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand', aliases: ['Aotearoa'] },
  // Africa
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'EG', name: 'Egypt' },
  { code: 'MA', name: 'Morocco' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'SN', name: 'Senegal' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'UG', name: 'Uganda' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CI', name: "Côte d'Ivoire", aliases: ['Ivory Coast'] },
  { code: 'AO', name: 'Angola' },
  { code: 'ZW', name: 'Zimbabwe' },
]

/** How a typed country is looked up: accents, dots and a leading "the" do not matter
 *  ("U.S.A.", "México", "the Netherlands"). */
function countryKey(s: string): string {
  return factText(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\./g, '')
    .toLowerCase()
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const COUNTRY_INDEX: ReadonlyMap<string, { code: string; name: string }> = (() => {
  const m = new Map<string, { code: string; name: string }>()
  for (const c of COUNTRIES) for (const s of [c.code, c.name, ...(c.aliases ?? [])]) m.set(countryKey(s), { code: c.code, name: c.name })
  return m
})()

/** The country a typed value names, as `{ code, name }` (ISO alpha-2 and this table's
 *  spelling), or null when the table does not know it. */
export function countryOf(raw: unknown): { code: string; name: string } | null {
  const key = countryKey(typeof raw === 'string' ? raw : '')
  const hit = key ? COUNTRY_INDEX.get(key) : undefined
  return hit ? { ...hit } : null
}

/** What the facts are read from: a payload, or anything shaped like its two parts (the
 *  SEO page reads the draft rows the same way). */
export type FactSource = {
  artist?: { name?: string | null; location?: string | null } | null
  site_content?: Readonly<Record<string, string | null | undefined>> | null
}

export type SiteFacts = {
  /** `artist.location` ("Based in"), one line. */
  city: string
  region: string
  /** The table's spelling when the country is known, else as typed. */
  country: string
  /** ISO 3166-1 alpha-2, or null when the table does not know the country. */
  countryCode: string | null
  aliases: string[]
  /** 'YYYY', or null. */
  activeSince: string | null
}

/** A place part (region / country) as the site states it: over the cap is dropped, never cut. */
function placePart(raw: unknown): string {
  const s = factText(raw)
  return chars(s) > MAX_PLACE_PART_LENGTH ? '' : s
}

/**
 * The artist's facts as a site reads them from the payload, every rule re-applied. The one
 * reading the fact card uses, and the one lone-star's SEO page shows, so the page can never
 * describe a fact the site would not state.
 *
 * The year is checked by SHAPE only (four digits, from EARLIEST_ACTIVE_YEAR up to 2099):
 * there is no clock here, and lone-star's gate refuses a future year before it is stored.
 */
export function siteFacts(src: FactSource): SiteFacts {
  const c = src.site_content ?? {}
  const typed = placePart(c[FACT_CONTENT_KEYS.country])
  const known = typed ? countryOf(typed) : null
  const year = factText(c[FACT_CONTENT_KEYS.activeSince])
  return {
    city: factText(src.artist?.location),
    region: placePart(c[FACT_CONTENT_KEYS.region]),
    country: known?.name ?? typed,
    countryCode: known?.code ?? null,
    aliases: parseAliases(c[FACT_CONTENT_KEYS.aliases], artistName(src.artist)),
    activeSince: /^\d{4}$/.test(year) && Number(year) >= EARLIEST_ACTIVE_YEAR && Number(year) <= 2099 ? year : null,
  }
}

/**
 * Where the artist is based, as a schema.org `Place`, or null when nothing is set.
 *
 * With no region and no country this is EXACTLY the 0.42 place, `{ name: <location> }`:
 * a site that upgrades without the new facts emits the same bytes. With either, the name is
 * the parts that exist joined ("Chicago, Illinois, United States") and a `PostalAddress`
 * carries each part in its own property, the country as its ISO code when known. Only the
 * parts that exist: a region is never guessed from a city.
 */
export function artistPlace(src: FactSource): Record<string, unknown> | null {
  const f = siteFacts(src)
  if (!f.region && !f.country) {
    const location = (src.artist?.location ?? '').trim()
    return location ? { '@type': 'Place', name: location } : null
  }
  return {
    '@type': 'Place',
    name: [f.city, f.region, f.country].filter(Boolean).join(', '),
    address: {
      '@type': 'PostalAddress',
      ...(f.city ? { addressLocality: f.city } : {}),
      ...(f.region ? { addressRegion: f.region } : {}),
      ...(f.country ? { addressCountry: f.countryCode ?? f.country } : {}),
    },
  }
}

function artistNode(payload: PublicSitePayload, opts: JsonLdOptions, seo: SiteSeo): Node {
  const a = payload.artist
  // The WHOLE bio, whitespace-collapsed — the fact sheet has no 160-char limit, and the
  // description is the text AI engines quote. The meta description only when there is no bio.
  const bio = (a.bio ?? '').replace(/\s+/g, ' ').trim()
  const description = bio || seo.description
  const genre = (a.genre ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  const sameAs = sameAsFrom(payload)
  const person = a.schema_type === 'Person'
  // `foundingLocation`, `foundingDate`, `logo` and `genre` are Organization/MusicGroup
  // properties; a Person has `homeLocation` and `image`, and no genre. Same facts, the
  // properties schema.org defines for that type — anything else fails the validator.
  //
  // A Person has NO start year at all: `foundingDate` is Organization-only, and
  // `birthDate` is a different fact. So "active since" is simply not stated for a Person
  // (0.43.0); lone-star's SEO page says so rather than implying it is.
  const place = artistPlace(payload)
  const facts = siteFacts(payload)
  // `logo` from the Brand page's primary logo only (audit #9): a hero photo is not a logo.
  const logoRow = person || !opts.mediaUrl ? null : (payload.media ?? []).find((m) => m.purpose === 'logo_primary' && m.path)
  const logo = logoRow && opts.mediaUrl ? safeHttpUrl(opts.mediaUrl(logoRow.path)) : null
  return {
    '@type': person ? 'Person' : 'MusicGroup',
    '@id': `${opts.origin}/#artist`,
    name: artistName(a),
    // Other names the artist goes by (0.43.0). One is a plain string, like one genre.
    ...(facts.aliases.length ? { alternateName: facts.aliases.length === 1 ? facts.aliases[0] : facts.aliases } : {}),
    url: `${opts.origin}/`,
    ...(description ? { description } : {}),
    ...(opts.imageUrl ? { image: opts.imageUrl } : {}),
    ...(logo ? { logo } : {}),
    ...(genre.length && !person ? { genre: genre.length === 1 ? genre[0] : genre } : {}),
    ...(facts.activeSince && !person ? { foundingDate: facts.activeSince } : {}),
    ...(place ? (person ? { homeLocation: place } : { foundingLocation: place }) : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(opts.aboutUrl ? { mainEntityOfPage: opts.aboutUrl } : {}),
  }
}

function eventNode(show: SiteTourDate, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  // Google requires `location` with an ADDRESS on an Event. A show with no city has no
  // address to state (a venue name alone is not one), so it is left out rather than
  // shipped as an error.
  if (!show.city) return null
  const artist = { '@id': `${opts.origin}/#artist` }
  const where = [show.venue, show.city].filter(Boolean).join(', ')
  const ticket = safeHttpUrl(show.ticket_url)
  return {
    '@type': 'MusicEvent',
    name: where ? `${artistName(payload.artist)} at ${where}` : artistName(payload.artist),
    startDate: show.date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(show.venue || show.city
      ? {
          location: {
            '@type': 'Place',
            ...(show.venue ? { name: show.venue } : {}),
            ...(show.city || show.state || show.country
              ? {
                  address: {
                    '@type': 'PostalAddress',
                    ...(show.city ? { addressLocality: show.city } : {}),
                    ...(show.state ? { addressRegion: show.state } : {}),
                    ...(show.country ? { addressCountry: show.country } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    performer: [artist, ...(show.support ?? []).filter(Boolean).map((name) => ({ '@type': 'MusicGroup', name }))],
    // No `availability`: nothing on the wire says tickets are in stock, and an Offer
    // without it is valid (audit #6). The ticket link is the whole fact.
    ...(ticket ? { offers: { '@type': 'Offer', url: ticket } } : {}),
  }
}

function recordingNode(t: SiteTrack, albumId: string | null, opts: JsonLdOptions): Node {
  const url = safeHttpUrl(t.stream_url) ?? safeHttpUrl(t.provider_url)
  return {
    '@type': 'MusicRecording',
    name: t.title,
    byArtist: { '@id': `${opts.origin}/#artist` },
    ...(albumId ? { inAlbum: { '@id': albumId } } : {}),
    ...(url ? { url } : {}),
  }
}

function albumNode(r: SiteRelease, payload: PublicSitePayload, opts: JsonLdOptions): Node {
  const id = `${opts.origin}/#release-${r.id}`
  const cover = safeHttpUrl(r.cover_url)
  const sameAs = new Set<string>()
  const linkValues = Array.isArray(r.links) ? r.links.map((l) => l?.url) : Object.values(r.links ?? {})
  for (const v of linkValues) {
    const u = safeHttpUrl(v)
    if (u) sameAs.add(u)
  }
  if (r.spotify_id && /^[A-Za-z0-9]+$/.test(r.spotify_id)) sameAs.add(`https://open.spotify.com/album/${r.spotify_id}`)
  const tracks = (payload.tracks ?? []).filter((t) => t.release_id === r.id)
  const type = RELEASE_TYPE[(r.release_type ?? '').toLowerCase()]
  return {
    '@type': 'MusicAlbum',
    '@id': id,
    name: r.title,
    byArtist: { '@id': `${opts.origin}/#artist` },
    ...(r.release_date ? { datePublished: r.release_date } : {}),
    ...(cover ? { image: cover } : {}),
    ...(type ? { albumReleaseType: `https://schema.org/${type}` } : {}),
    ...(sameAs.size ? { sameAs: [...sameAs] } : {}),
    // No numTracks: the wire carries on-site songs only, so a count would be a fact about
    // the page, not the record.
    ...(tracks.length ? { track: tracks.map((t) => recordingNode(t, id, opts)) } : {}),
  }
}

function imageNode(m: WireMedia, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  if (!opts.listImage || m.kind === 'none') return null
  if (m.purpose !== 'gallery_image') return null
  const shown = opts.listImage(m)
  if (!shown) return null
  const url = safeHttpUrl(shown.url)
  if (!url) return null
  const text = (shown.alt ?? '').trim() || (m.alt ?? '').trim() || recommendAlt({ artist: artistName(payload.artist), caption: m.label, kind: m.kind })
  if (m.kind === 'artwork') {
    return {
      '@type': 'VisualArtwork',
      ...(text ? { name: text } : {}),
      image: url,
      creator: { '@id': `${opts.origin}/#artist` },
    }
  }
  return {
    '@type': 'ImageObject',
    contentUrl: url,
    ...(text ? { caption: text } : {}),
    creditText: artistName(payload.artist),
  }
}

/** YouTube's stable thumbnail for a watch/embed URL, or null for any other provider. */
function youtubeThumb(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/**
 * One VideoObject per on-site VIDEO (SoundCloud is an audio player, not a video, and is
 * left out). Google requires name, thumbnailUrl, uploadDate and description, so a node is
 * emitted only when all four are known: the thumbnail from YouTube (or the site's
 * `videoPoster` hook for uploads), the date from when the manager added it. Nothing is
 * invented; a video that cannot be stated fully is not stated.
 */
function videoNode(v: SiteVideo, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  if (v.provider === 'soundcloud') return null
  const embed = v.provider === 'youtube' ? safeHttpUrl(v.embed_url) : null
  const content = v.provider === 'uploaded' && v.storage_path && opts.videoUrl ? safeHttpUrl(opts.videoUrl(v.storage_path)) : null
  if (!embed && !content) return null
  const thumb = embed ? youtubeThumb(embed) : safeHttpUrl(opts.videoPoster?.(v))
  // The platform's publish date, never the day the manager added the link (that was the
  // 2026-08-26 mistake): unknown = not stated.
  //
  // An UPLOAD has no other platform — this site is where it was published — so for a
  // self-hosted file `created_at` IS the publish date, not a stand-in for one. Only the
  // YouTube sync ever writes `published_at`, so without this an uploaded video could
  // never be stated at all, however complete the rest of it was (review 2026-09-03, M3).
  const uploadDate = v.published_at ?? (v.provider === 'uploaded' ? (v.created_at ?? null) : null)
  if (!thumb || !uploadDate || !v.title) return null
  return {
    '@type': 'VideoObject',
    name: v.title,
    description: `${v.title} by ${artistName(payload.artist)}`,
    thumbnailUrl: thumb,
    uploadDate,
    ...(embed ? { embedUrl: embed } : {}),
    ...(content ? { contentUrl: content } : {}),
    creator: { '@id': `${opts.origin}/#artist` },
  }
}

/** The whole fact sheet as one `@graph`: artist, website, upcoming events, albums with
 *  their songs, and the photos/artworks the manager listed. */
export function jsonLdGraph(payload: PublicSitePayload, opts: JsonLdOptions): { '@context': string; '@graph': Node[] } {
  // NO NAME, NO FACT SHEET — the whole graph is ABOUT the artist, so without one every
  // node in it is a sentence with a hole. Executed against a blank artist this published
  // `MusicGroup {"name":""}`, `WebSite {"name":""}` and `MusicEvent {" at Smartbar,
  // Chicago"}` on every connected site: indexed, and quoted verbatim by assistants
  // (2026-09-04 audit, F1). It is the same rule `faqPageJsonLd` already applies.
  //
  // The guard is HERE rather than on each of the six `artistName()` sinks below, because
  // per-sink guarding is exactly what produced this: the FAQ surfaces were fixed on
  // 2026-09-03 and the JSON-LD ones were not, twice.
  //
  // An EMPTY GRAPH, not null. `factSheet.tsx` in every connected site calls
  // `jsonLdScript(jsonLdGraph(...))` unconditionally, so a null return would break each
  // of them — the mistake 0.35.0 made with a required handle member. An empty `@graph`
  // is valid JSON-LD, ignored by crawlers, and needs no change in any site.
  if (!artistName(payload.artist)) return { '@context': 'https://schema.org', '@graph': [] }
  const seo = resolveSeo(payload)
  const graph: Node[] = [
    artistNode(payload, opts, seo),
    {
      '@type': 'WebSite',
      '@id': `${opts.origin}/#website`,
      url: `${opts.origin}/`,
      name: artistName(payload.artist),
      publisher: { '@id': `${opts.origin}/#artist` },
      inLanguage: 'en',
    },
  ]
  for (const show of payload.tour_dates ?? []) {
    if (!isUpcoming(show, opts.today)) continue
    const node = eventNode(show, payload, opts)
    if (node) graph.push(node)
  }
  for (const r of opts.releases ?? []) graph.push(albumNode(r, payload, opts))
  for (const v of payload.videos ?? []) {
    const node = videoNode(v, payload, opts)
    if (node) graph.push(node)
  }
  for (const m of payload.media ?? []) {
    const node = imageNode(m, payload, opts)
    if (node) graph.push(node)
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}

/** Serialise for an inline `<script>`: `<` escaped so a caption can never close the tag. */
export function jsonLdScript(graph: unknown): string {
  return JSON.stringify(graph).replace(/</g, '\\u003c')
}

/* ----------------------------------------------------------------------------------
 * sitemap + robots
 * -------------------------------------------------------------------------------- */

export type SitemapEntry = {
  url: string
  lastModified?: Date
  changeFrequency: 'weekly'
  priority: number
}

/**
 * Every kind of thing lone-star publishes (its `revisions.entity_type`), and whether a
 * change to it changes what a page SAYS (`content`) or only how it LOOKS (`look`). The
 * sitemap's per-page dates (0.45.0) move on content only: Google learns to ignore a
 * lastmod that moves on every restyle.
 *
 * A record, so a kind added here must be given a side. A kind NOT here (lone-star added
 * one before this bridge learned it) counts as content on every page: a date that moves
 * once too often is harmless, one that silently stops moving is not.
 */
export type ChangeClass = 'content' | 'look'
function classify<T extends Record<string, ChangeClass>>(kinds: T): Readonly<T> {
  return kinds
}
export const CHANGE_KINDS = classify({
  artist: 'content',
  site_content: 'content',
  track: 'content',
  release: 'content',
  tour_date: 'content',
  merch: 'content',
  link: 'content',
  media: 'content',
  video: 'content',
  site_styles: 'look',
  artist_font: 'look',
  brand_color: 'look',
  theme_color: 'look',
})
export type ChangeKind = keyof typeof CHANGE_KINDS
/** What a page can declare it shows: `sitemapEntries(…, { pages: [{ path, shows }] })`. */
export type ContentKind = { [K in ChangeKind]: (typeof CHANGE_KINDS)[K] extends 'content' ? K : never }[ChangeKind]
export const CONTENT_KINDS: readonly ContentKind[] = (Object.keys(CHANGE_KINDS) as ChangeKind[]).filter(
  (k): k is ContentKind => CHANGE_KINDS[k] === 'content',
)

/** A page beyond the homepage. A plain path is dated like the homepage (every content
 *  kind); `{ path, shows }` is dated by the kinds that page renders, and nothing else. */
export type SitemapPage = string | { path: string; shows: readonly ContentKind[] }

function isKnownKind(kind: string): kind is ChangeKind {
  return Object.prototype.hasOwnProperty.call(CHANGE_KINDS, kind)
}

/** The shows that have passed by `today`: Upcoming → Past moves a page with no publish.
 *  Strictly before today: on the day itself the page still lists the show as upcoming
 *  (isUpcoming is `>= today`), so nothing has changed yet. */
function passedShows(payload: Pick<PublicSitePayload, 'tour_dates'>, today?: string): string[] {
  if (!today) return []
  const out: string[] = []
  for (const s of payload.tour_dates ?? []) {
    if (s.date && s.date.slice(0, 10) < today) out.push(s.date.slice(0, 10))
  }
  return out
}

function newest(candidates: readonly string[]): Date | undefined {
  const stamps = candidates.map((c) => Date.parse(c)).filter((n) => Number.isFinite(n))
  return stamps.length ? new Date(Math.max(...stamps)) : undefined
}

/**
 * When the page last changed: the newest publish, or the newest show that has since
 * passed (Upcoming → Past moves the page with no publish). No clock: a site that passes
 * the same payload and `today` gets the same lastmod, which is the whole point.
 *
 * The site-wide date: what every page got before 0.45.0, and still gets against a
 * database that sends no `changed_at`.
 */
export function lastModifiedFrom(payload: Pick<PublicSitePayload, 'published_at' | 'tour_dates'>, today?: string): Date | undefined {
  return newest([...(payload.published_at ? [payload.published_at] : []), ...passedShows(payload, today)])
}

/** `changed_at` when it is one; null = an older database that sends none. */
function changeMap(payload: Pick<PublicSitePayload, 'changed_at'>): Record<string, unknown> | null {
  const changed = payload.changed_at
  return changed && typeof changed === 'object' && !Array.isArray(changed) ? changed : null
}

/** The change times of the content kinds a page shows ('all': every content kind). */
function contentTimes(changed: Record<string, unknown>, shows: 'all' | readonly ContentKind[]): string[] {
  const out: string[] = []
  for (const kind of Object.keys(changed)) {
    const at = changed[kind]
    if (typeof at !== 'string') continue
    if (!isKnownKind(kind)) out.push(at) // unknown → content, on every page
    else if (CHANGE_KINDS[kind] === 'look') continue
    else if (shows === 'all' || (shows as readonly string[]).includes(kind)) out.push(at)
  }
  return out
}

/**
 * When the site's CONTENT last changed: the newest content kind in `changed_at` (a restyle
 * does not count). Undefined on an older database (no `changed_at`) or when none is known.
 * The homepage's sitemap date is this, or a show that has passed since; lone-star's "is the
 * site showing the latest publish?" check reads the same function, so the two never disagree.
 */
export function contentChangedAt(payload: Pick<PublicSitePayload, 'changed_at'>): Date | undefined {
  const changed = changeMap(payload)
  return changed ? newest(contentTimes(changed, 'all')) : undefined
}

/** One page's date. `shows` = 'all' for the homepage and a plain-path page. */
function pageLastModified(
  payload: Pick<PublicSitePayload, 'published_at' | 'tour_dates' | 'changed_at'>,
  shows: 'all' | readonly ContentKind[],
  today?: string,
): Date | undefined {
  const changed = changeMap(payload)
  // An older database sends no `changed_at`: exactly the 0.44 date, on every page.
  if (!changed) return lastModifiedFrom(payload, today)
  const candidates = contentTimes(changed, shows)
  if (shows === 'all' || shows.includes('tour_date')) candidates.push(...passedShows(payload, today))
  return newest(candidates)
}

export function sitemapEntries(
  payload: Pick<PublicSitePayload, 'published_at' | 'tour_dates' | 'changed_at'>,
  opts: { origin: string; pages?: readonly SitemapPage[]; today?: string },
): SitemapEntry[] {
  // `pages` is what a site chooses to list beyond the homepage — /about when the bio
  // lives there, /faqsheet when any question is answered. Listed, but never linked from
  // the site's own navigation: that is the whole point of the sheet.
  const entry = (path: string, shows: 'all' | readonly ContentKind[], priority: number): SitemapEntry => {
    const lastModified = pageLastModified(payload, shows, opts.today)
    return { url: `${opts.origin}${path.startsWith('/') ? path : `/${path}`}`, ...(lastModified ? { lastModified } : {}), changeFrequency: 'weekly', priority }
  }
  return [
    entry('/', 'all', 1),
    // A plain path, or a `{ path }` with no usable `shows` (a plain-JS site), is dated like home.
    ...(opts.pages ?? []).map((p) => (typeof p === 'string' ? entry(p, 'all', 0.8) : entry(p.path, Array.isArray(p.shows) ? p.shows : 'all', 0.8))),
  ]
}

export function robotsRules(origin: string): {
  rules: { userAgent: string; allow: string; disallow: string[] }[]
  sitemap: string
  host: string
} {
  // No Disallow for /edit: a disallowed URL is never FETCHED, so Google never sees the
  // meta noindex on it and can still index it URL-only ("indexed, though blocked"). The
  // page's own `noindex, nofollow` is the whole mechanism; robots.txt just names the map.
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}

/* ----------------------------------------------------------------------------------
 * about placement
 * -------------------------------------------------------------------------------- */

export const ABOUT_PLACEMENTS = ['home', 'page', 'hidden'] as const
export type AboutPlacement = (typeof ABOUT_PLACEMENTS)[number]
/** What a site declares about its bio (manifest.about): where it CAN go, and where it
 *  goes when the manager has not chosen — the site's call, never the editor's. */
export type ManifestAbout = { placements: readonly ('home' | 'page')[]; default: AboutPlacement }

/** Where the bio renders: the manager's choice if the site supports it, else the site's
 *  declared default, else hidden. `hidden` still feeds meta + JSON-LD (resolveSeo). */
export function aboutPlacement(payload: Pick<PublicSitePayload, 'site_content'>, about: ManifestAbout | null | undefined): AboutPlacement {
  const chosen = (payload.site_content?.about_placement ?? '') as AboutPlacement | ''
  const allowed = new Set<AboutPlacement>(['hidden', ...(about?.placements ?? [])])
  if (chosen && allowed.has(chosen)) return chosen
  return about?.default && allowed.has(about.default) ? about.default : 'hidden'
}

/* ----------------------------------------------------------------------------------
 * audit — does the BUILT html carry what a crawler needs? (CONNECTING §7 rule 7)
 * -------------------------------------------------------------------------------- */

export type SeoFinding = { rule: string; problem: string }

/**
 * Run over the prerendered html strings of `/` and (optionally) `/edit`. Regex on
 * purpose: build tests run in node with no DOM, and every check here is a tag-level
 * fact, not a layout question. Returns [] when the page is findable.
 *
 * `edit: null` means "this site has no /edit page" — a pass, nothing to be indexed.
 * `editError` is the other reason it might be missing: the caller TRIED and could not
 * read it (a 429, a 500, a dropped connection). A check that cannot tell "fine" from
 * "could not look" must not report fine, so the unknown is stated as a finding.
 */
export function auditSeo(input: { home: string; edit?: string | null; editError?: string | null }): SeoFinding[] {
  const out: SeoFinding[] = []
  const { home, edit, editError } = input
  const desc = home.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? ''
  if (desc.length <= 60) out.push({ rule: 'description', problem: `meta description is ${desc.length} chars; needs more than 60` })
  if (!/<link[^>]*rel="canonical"/i.test(home)) out.push({ rule: 'canonical', problem: 'no canonical link' })
  const h1 = (home.match(/<h1[\s>]/gi) ?? []).length
  if (h1 !== 1) out.push({ rule: 'h1', problem: `${h1} h1 elements; needs exactly one` })
  for (const m of home.matchAll(/<section[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi)) {
    if (!/<h[12][\s>]/i.test(m[2])) out.push({ rule: 'headings', problem: `section #${m[1]} has no h1/h2` })
  }
  for (const m of home.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    if (/\balt=""/.test(tag) && !/aria-hidden/.test(tag)) out.push({ rule: 'alt', problem: `content image with empty alt: ${tag.slice(0, 80)}` })
    if (!/\balt=/.test(tag)) out.push({ rule: 'alt', problem: `image with no alt attribute: ${tag.slice(0, 80)}` })
    if (/\bsrc="\/_next\/image/.test(tag)) out.push({ rule: 'src', problem: `image src goes through /_next/image (filename lost): ${tag.slice(0, 80)}` })
  }
  const ld = home.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  if (!ld) out.push({ rule: 'json-ld', problem: 'no application/ld+json script' })
  else {
    try {
      JSON.parse(ld[1])
    } catch {
      out.push({ rule: 'json-ld', problem: 'ld+json does not parse' })
    }
  }
  if (/<meta\s+name="robots"[^>]*noindex/i.test(home)) out.push({ rule: 'robots', problem: 'the homepage is noindex' })
  if (editError) out.push({ rule: 'robots', problem: `could not check whether /edit is noindex (${editError})` })
  else if (edit != null && !/<meta\s+name="robots"[^>]*noindex/i.test(edit)) out.push({ rule: 'robots', problem: '/edit is not noindex' })
  return out
}

/* ----------------------------------------------------------------------------------
 * audit — is the fact sheet one Google's Rich Results test would accept?
 * -------------------------------------------------------------------------------- */

/** The fields Google marks REQUIRED per type (developers.google.com/search/docs). A
 *  node missing one is reported as an error there, not merely "no rich result". */
export const JSON_LD_REQUIRED: Record<string, readonly string[]> = {
  MusicGroup: ['name', 'url'],
  Person: ['name', 'url'],
  WebSite: ['name', 'url'],
  MusicEvent: ['name', 'startDate', 'location'],
  MusicAlbum: ['name', 'byArtist'],
  MusicRecording: ['name', 'byArtist'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate', 'description'],
  ImageObject: ['contentUrl'],
  VisualArtwork: ['image', 'creator'],
}

/** `kinds`: MusicAlbum nodes by albumReleaseType (album / ep / single / other) — a
 *  release is a MusicAlbum in schema.org whatever its size, so the count alone misleads. */
export type JsonLdSummary = { counts: Record<string, number>; kinds: Record<string, number>; findings: SeoFinding[] }

/** Parse an ld+json string (or take the object) and check every `@graph` node. */
export function auditJsonLd(input: string | unknown): JsonLdSummary {
  let graph: unknown
  try {
    graph = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    return { counts: {}, kinds: {}, findings: [{ rule: 'json-ld', problem: 'ld+json does not parse' }] }
  }
  const nodes = (graph as { '@graph'?: unknown })?.['@graph']
  if (!Array.isArray(nodes)) return { counts: {}, kinds: {}, findings: [{ rule: 'json-ld', problem: 'no @graph array' }] }
  const counts: Record<string, number> = {}
  const kinds: Record<string, number> = {}
  const findings: SeoFinding[] = []
  const check = (node: Record<string, unknown>, where: string) => {
    const type = String(node['@type'] ?? '')
    counts[type] = (counts[type] ?? 0) + 1
    for (const field of JSON_LD_REQUIRED[type] ?? []) {
      const v = node[field]
      if (v === undefined || v === null || v === '') findings.push({ rule: type, problem: `${where} is missing ${field}` })
    }
    if (type === 'MusicEvent' && node.location && !(node.location as Record<string, unknown>).address) {
      findings.push({ rule: type, problem: `${where} location has no address` })
    }
    if (type === 'MusicAlbum') {
      const kind = String(node.albumReleaseType ?? '').replace(/^.*\//, '').replace(/Release$/, '').toLowerCase() || 'other'
      kinds[kind] = (kinds[kind] ?? 0) + 1
    }
    if (type === 'MusicAlbum' && Array.isArray(node.track)) {
      for (const [i, t] of (node.track as Record<string, unknown>[]).entries()) check(t, `${where} track ${i + 1}`)
    }
  }
  for (const [i, n] of (nodes as Record<string, unknown>[]).entries()) check(n, `${String(n['@type'] ?? 'node')} #${i + 1}`)
  return { counts, kinds, findings }
}

/**
 * The findability rules, ONE registry: the site's build test, the live check and the
 * SEO / GEO page all derive their lists from it, so a rule added here appears everywhere
 * (and one nobody listed can never be silently dropped).
 */
export const SEO_RULES: readonly { rule: string; label: string }[] = [
  { rule: 'description', label: 'Meta description (60+ chars)' },
  { rule: 'canonical', label: 'Canonical URL' },
  { rule: 'h1', label: 'Exactly one H1' },
  { rule: 'headings', label: 'A heading in every section' },
  { rule: 'alt', label: 'Alt text on every content image' },
  { rule: 'src', label: 'Image URLs are direct (no /_next/image)' },
  { rule: 'json-ld', label: 'Fact sheet (JSON-LD) present and parses' },
  { rule: 'robots', label: 'Homepage indexable; /edit noindex' },
  { rule: 'facts', label: 'Fact sheet has every field Google requires' },
  { rule: 'facts-geo', label: 'Fact sheet states genre and location' },
  { rule: 'bio-visible', label: 'The bio is visible text on a page' },
  { rule: 'other', label: 'Other' },
]

/** GEO: the artist node states the facts AI answers are asked for. */
export function auditGeoFacts(graph: unknown): SeoFinding[] {
  const nodes = (graph as { '@graph'?: Record<string, unknown>[] })?.['@graph']
  if (!Array.isArray(nodes)) return []
  const artist = nodes.find((n) => n['@type'] === 'MusicGroup' || n['@type'] === 'Person')
  if (!artist) return [{ rule: 'facts-geo', problem: 'no artist node (MusicGroup / Person)' }]
  const out: SeoFinding[] = []
  if (artist['@type'] === 'MusicGroup' && !artist.genre) out.push({ rule: 'facts-geo', problem: 'artist has no genre — set it on the SEO / GEO page and publish' })
  if (!artist.foundingLocation && !artist.homeLocation) out.push({ rule: 'facts-geo', problem: 'artist has no location — set "Based in" on the SEO / GEO page and publish' })
  return out
}

/* ----------------------------------------------------------------------------------
 * The FAQ sheet — the artist's own answers to the five probe questions
 * -------------------------------------------------------------------------------- */

/** PROBE_PROMPTS v1 — FROZEN. Name and artist TYPE only; never a fact the site should
 *  teach (leaking "Chicago" into the question hands the engine the answer). Change the
 *  wording only with a new version, or months stop comparing. */
export const PROBE_VERSION = 'v1'
export function probePrompts(rawName: string, schemaType?: string | null): string[] {
  // TRIMMED HERE, not by the caller. The caller-side trim left the editor's SEO ledger
  // (tools/seo/sections/ai.tsx, which calls this directly) showing "Who is Skeen , the
  // musician?" while the published sheet said "Skeen" — the manager writing the answers
  // and the page quoting them spelling the artist differently (2026-09-04 review).
  const name = (rawName ?? '').trim()
  const role = schemaType === 'Person' ? 'the artist' : 'the musician'
  return [
    `Who is ${name}, ${role}?`,
    `What kind of music does ${name} make, and where are they based?`,
    `When is ${name} playing next?`,
    `What has ${name} released recently?`,
    `${name} official website`,
  ]
}

export type FaqEntry = { question: string; answer: string }

/**
 * The prompts whose answer is a MOVING fact (audit #10), by prompt number, and where the
 * answer comes from. They are automatic only: the next show always from Tour, the latest
 * releases always from Music. A written answer there was stale the day after the show,
 * and it won forever, so `faqEntries` ignores a stored one and the SEO page shows these
 * two read-only.
 */
export const FAQ_AUTO_ONLY: Readonly<Record<number, 'tour' | 'music'>> = { 3: 'tour', 4: 'music' }

function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export type FaqSource = {
  artist: Pick<PublicSitePayload['artist'], 'name'> & Partial<Pick<PublicSitePayload['artist'], 'bio' | 'genre' | 'location' | 'schema_type'>>
  site_content?: PublicSitePayload['site_content'] | null
  tour_dates?: PublicSitePayload['tour_dates'] | null
  releases?: readonly SiteRelease[] | null
  origin?: string
  today?: string
}

/**
 * The AUTOMATIC answer to prompt N (1-based), from published data only — nothing is
 * invented; '' when the data is not there. The manager's own answer always wins.
 */
export function autoFaqAnswer(n: number, src: FaqSource): string {
  const a = src.artist
  // TRIMMED, and that is the guard rather than cosmetics: `'  '` is truthy, so an
  // untrimmed read let a whitespace-only artist satisfy the name check on Q5 below and
  // produce "  's official website is …".
  const name = artistName(a)
  const genre = (a.genre ?? '').trim()
  const where = (a.location ?? '').trim()
  const bio = (a.bio ?? '').replace(/\s+/g, ' ').trim()
  const role = a.schema_type === 'Person' ? 'artist' : 'musician'
  // NO NAME, NO ANSWER — at the TOP, because every branch below interpolates it. The
  // previous guard sat on n===5 alone, under a comment claiming that was the only branch
  // reachable without an artist. It was not: Q1–Q4 produced " is a House, Techno
  // musician, based in Chicago." and friends.
  //
  // This matters even though `faqEntries` would not reach them, because this function is
  // EXPORTED and the editor's SEO ledger calls it directly for the answers it displays —
  // and `sections/ai.tsx` seeds its textarea with `row.answer || row.auto`, so a manager
  // who opens such a row SAVES the hole as a written answer. Written answers win forever,
  // outliving the missing name that caused them (2026-09-04 review).
  if (!name) return ''
  if (n === 1) {
    if (bio) return bio
    const bits = [genre ? `${genre} ${role}` : role, where ? `based in ${where}` : ''].filter(Boolean).join(', ')
    return genre || where ? `${name} is a ${bits}.` : ''
  }
  if (n === 2) {
    if (!genre && !where) return ''
    return [genre ? `${name} makes ${genre}.` : '', where ? `${name} is based in ${where}.` : ''].filter(Boolean).join(' ')
  }
  if (n === 3) {
    // No tour list at all is UNKNOWN, not "no shows": say nothing rather than guess.
    if (!Array.isArray(src.tour_dates)) return ''
    const day = (s: SiteTourDate) => s.date!.slice(0, 10)
    const next = src.tour_dates
      .filter((s) => s.date && s.is_past !== true && (!src.today || day(s) >= src.today))
      .sort((x, y) => (x.date! < y.date! ? -1 : 1))[0]
    if (next) {
      const place = [next.venue, next.city].filter(Boolean).join(', ')
      return `${name} plays ${place ? `${place} on ` : ''}${fmtDate(next.date!)}.`
    }
    // Nothing upcoming still answers the question (audit #7), plainly, with the most recent
    // shows that did happen. Past by the calendar when `today` is known — so a future show
    // the manager marked past (cancelled) is not a "recent show" — else by the flag.
    const none = 'No shows are scheduled right now.'
    const recent = src.tour_dates
      .filter((s) => s.date && (src.today ? day(s) < src.today : s.is_past === true))
      .sort((x, y) => (x.date! > y.date! ? -1 : 1))
      .slice(0, 3)
    if (!recent.length) return none
    const said = recent.map((s) => {
      const place = [s.venue, s.city].filter(Boolean).join(', ')
      return place ? `${place} (${fmtDate(s.date!)})` : fmtDate(s.date!)
    })
    return `${none} Recent shows: ${said.join('; ')}.`
  }
  if (n === 4) {
    const recent = [...(src.releases ?? [])].filter((r) => r.release_date).sort((x, y) => (x.release_date! > y.release_date! ? -1 : 1)).slice(0, 3)
    if (!recent.length) return ''
    return `${name}'s latest releases: ${recent.map((r) => `${r.title} (${fmtDate(r.release_date!)})`).join(', ')}.`
  }
  if (n === 5) return src.origin ? `${name}'s official website is ${src.origin.replace(/^https?:\/\//, '')}.` : ''
  return ''
}

/** The sheet's questions and answers, in order: the manager's `faq_answer_N` when
 *  written, else the automatic answer, else the question is left out. Then any EXTRA
 *  questions the manager added (`faq_extra_N_q` / `_a`) — theirs, on the sheet, outside
 *  the measurement. Empty = no sheet. */
/** An ANSWER is prose the manager wrote in a textarea, so its paragraph breaks are part
 *  of what they wrote. Horizontal runs still collapse and a pileup of blank lines caps at
 *  one, matching `normalizeSeoValue` on the way IN — the two have to agree, or a value
 *  saved intact is mangled on the way out (2026-09-03 review, M8). A QUESTION is one line
 *  by nature and becomes a JSON-LD Question's `name`, so it keeps collapsing entirely. */
function faqProse(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function faqEntries(src: FaqSource): FaqEntry[] {
  // NO NAME, NO SHEET. Every prompt and every automatic answer interpolates the artist's
  // name, so without one the sheet reads "Who is , the musician?" answered by "'s
  // official website is skeenmusic.com." — and this page exists to be QUOTED by an
  // assistant, which makes a sentence with a hole in it worse than no page.
  //
  // Only Q5's guard used to be reachable (it tested `origin`, not the name), so a payload
  // with no artist still produced one truthy answer and listed /faqsheet in the sitemap.
  // Caught by skeen's own sitemap test the day 0.34.0 was installed (2026-09-03).
  //
  // The manager's EXTRA questions are exempt below: those are whole sentences they wrote
  // themselves, and none of them depends on the name.
  // ONE name for the questions and the answers alike — see artistName.
  const name = artistName(src.artist)
  const prompts = name ? probePrompts(name, src.artist.schema_type) : []
  const c = src.site_content ?? {}
  const out: FaqEntry[] = []
  prompts.forEach((question, i) => {
    // A written answer to a moving fact is ignored: see FAQ_AUTO_ONLY.
    const written = FAQ_AUTO_ONLY[i + 1] ? '' : faqProse(c[`faq_answer_${i + 1}`] ?? '')
    const answer = written || autoFaqAnswer(i + 1, src)
    if (answer) out.push({ question, answer })
  })
  for (let n = 1; n <= 5; n++) {
    const q = (c[`faq_extra_${n}_q`] ?? '').replace(/\s+/g, ' ').trim()
    const a = faqProse(c[`faq_extra_${n}_a`] ?? '')
    if (q && a) out.push({ question: q, answer: a })
  }
  return out
}

/** FAQPage markup for the /faqsheet route: the artist as the page's subject, one
 *  Question/Answer pair per answered prompt. Null when nothing is answered. */
export function faqPageJsonLd(payload: FaqSource, opts: { origin: string; path?: string }) {
  // The manager's EXTRA questions are exempt from the no-name rule — whole sentences they
  // wrote, none depending on the name. That exemption is right, and it is also what let a
  // nameless artist reach this node with a non-empty `entries`, shipping the title as
  // " — questions and answers". The exemption stays; the TITLE still needs a name.
  if (!artistName(payload.artist)) return null
  const entries = faqEntries({ ...payload, origin: payload.origin ?? opts.origin })
  if (!entries.length) return null
  const path = opts.path ?? '/faqsheet'
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        '@id': `${opts.origin}${path}#faq`,
        url: `${opts.origin}${path}`,
        name: `${artistName(payload.artist)} — questions and answers`,
        // The artist node itself is not on this page, so a bare @id pointed at nothing
        // here (audit #11). Type + @id + name resolve on their own and still join the
        // full node on the home page by @id.
        about: {
          '@type': payload.artist.schema_type === 'Person' ? 'Person' : 'MusicGroup',
          '@id': `${opts.origin}/#artist`,
          name: artistName(payload.artist),
        },
        mainEntity: entries.map((e) => ({
          '@type': 'Question',
          name: e.question,
          acceptedAnswer: { '@type': 'Answer', text: e.answer },
        })),
      },
    ],
  }
}
