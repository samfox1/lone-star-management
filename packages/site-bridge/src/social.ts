/**
 * THE SOCIAL PLATFORM VOCABULARY — one list, shared by the editor's picker and every
 * connected site's renderer.
 *
 * Sam, 2026-08-09: "I want the user to be able to choose from a selector where we have a
 * preexisting list of social links that they can add, that way we have the icon preset."
 *
 * It lives in the package because BOTH halves need the same names: lone-star draws the
 * picker, the site draws the icon in its own style. Contract, like `LIBRARY_ASSETS` and
 * `FONT_SLOTS` — a site reads `slug` and maps it to its OWN glyph, so the standard names
 * the platform and never dictates a pixel (decision #4).
 *
 * `slug` is the join key and is derived from the label by the same lowercasing the item
 * markers already use (`item:link:instagram`), so a link row labelled "Apple Music" and a
 * site marker of `apple music` meet without a second mapping.
 */

export type SocialPlatform = {
  /** Stable join key. Lowercase, spaces kept — `label.toLowerCase()`. */
  slug: string
  /** What the manager sees, and what the `links` row is labelled. */
  label: string
  /** Prefilled when the manager picks this platform, so they paste a handle rather than
   *  reconstruct a URL. Its HOST is what `platformFromUrl` matches (with `aliasHosts`); its
   *  path is only a hint, since an artist's page may sit under any path there. */
  urlHint: string
  /** Other hosts that are this platform, which `platformFromUrl` must recognise although
   *  `urlHint` does not point at them: an old domain that now redirects (Threads →
   *  threads.com, 2026-09-28: threads.net redirects there but old stored links still use
   *  it), the short or old domain its own links use (youtu.be, twitter.com), a country
   *  version of the site (eventbrite.co.uk). Each is a registrable domain, or, for a
   *  `subdomainOnly` platform, that platform's own host on a country domain
   *  (music.amazon.co.uk). An explicit list, never "any TLD": a stranger's `amazon.xyz`
   *  must not become Amazon Music. */
  aliasHosts?: readonly string[]
  /** The platform is ONE subdomain of a bigger company's site: YouTube Music is
   *  music.youtube.com, inside YouTube; Amazon Music is music.amazon.com, inside a shop.
   *  Only that host (its own subdomains, its aliases) is this platform, and it wins over the
   *  platform that owns the rest of the domain: `youtube.com` stays YouTube, and an
   *  `amazon.com` product page stays nobody's. */
  subdomainOnly?: boolean
  /** A music fact database (MusicBrainz, Discogs, Wikidata; AI_VISIBILITY_AUDIT.md 1.3):
   *  the profile says WHO the artist is, for the fact card's `sameAs`, and is NEVER a site
   *  button. The editor never offers one as a button; a site that meets one among its links
   *  should leave it out of its buttons too. */
  identityOnly?: true
}

/** Amazon Music's country storefronts: the Amazon Music Unlimited markets. */
const AMAZON_MUSIC_COUNTRIES = ['co.uk', 'de', 'fr', 'it', 'es', 'co.jp', 'ca', 'com.au', 'in', 'com.br', 'com.mx'].map((tld) => `music.amazon.${tld}`)

/** Eventbrite's country sites. */
const EVENTBRITE_COUNTRIES = [
  'co.uk', 'ca', 'com.au', 'co.nz', 'ie', 'de', 'fr', 'es', 'it', 'nl', 'be', 'at', 'ch', 'pt', 'se', 'dk', 'fi',
  'com.br', 'com.mx', 'com.ar', 'cl', 'com.pe', 'hk', 'sg',
].map((tld) => `eventbrite.${tld}`)

/**
 * The platforms offered in the picker, in the order they appear.
 *
 * Additive only: removing an entry orphans every link row already labelled with it. A
 * platform NOT on this list is still reachable — the picker keeps a "Something else"
 * path — because an artist will always have somewhere we have not heard of.
 */
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  { slug: 'instagram', label: 'Instagram', urlHint: 'https://instagram.com/' },
  { slug: 'tiktok', label: 'TikTok', urlHint: 'https://tiktok.com/@' },
  { slug: 'youtube', label: 'YouTube', urlHint: 'https://youtube.com/@', aliasHosts: ['youtu.be'] },
  { slug: 'spotify', label: 'Spotify', urlHint: 'https://open.spotify.com/artist/' },
  { slug: 'apple music', label: 'Apple Music', urlHint: 'https://music.apple.com/artist/' },
  { slug: 'soundcloud', label: 'SoundCloud', urlHint: 'https://soundcloud.com/' },
  { slug: 'bandcamp', label: 'Bandcamp', urlHint: 'https://bandcamp.com/' },
  { slug: 'facebook', label: 'Facebook', urlHint: 'https://facebook.com/', aliasHosts: ['fb.com'] },
  { slug: 'x', label: 'X', urlHint: 'https://x.com/', aliasHosts: ['twitter.com'] },
  { slug: 'threads', label: 'Threads', urlHint: 'https://threads.com/@', aliasHosts: ['threads.net'] },
  { slug: 'substack', label: 'Substack', urlHint: 'https://substack.com/@' },
  { slug: 'patreon', label: 'Patreon', urlHint: 'https://patreon.com/' },
  { slug: 'discord', label: 'Discord', urlHint: 'https://discord.gg/', aliasHosts: ['discord.com'] },
  { slug: 'twitch', label: 'Twitch', urlHint: 'https://twitch.tv/' },
  { slug: 'deezer', label: 'Deezer', urlHint: 'https://deezer.com/artist/' },
  { slug: 'tidal', label: 'Tidal', urlHint: 'https://tidal.com/artist/' },
  // 2026-09-28: eighteen more (Sam). Appended, so the picker's first sixteen keep their places.
  { slug: 'youtube music', label: 'YouTube Music', urlHint: 'https://music.youtube.com/channel/', subdomainOnly: true },
  { slug: 'amazon music', label: 'Amazon Music', urlHint: 'https://music.amazon.com/artists/', subdomainOnly: true, aliasHosts: AMAZON_MUSIC_COUNTRIES },
  { slug: 'audiomack', label: 'Audiomack', urlHint: 'https://audiomack.com/' },
  { slug: 'mixcloud', label: 'Mixcloud', urlHint: 'https://mixcloud.com/' },
  { slug: 'beatport', label: 'Beatport', urlHint: 'https://www.beatport.com/artist/' },
  { slug: 'pandora', label: 'Pandora', urlHint: 'https://www.pandora.com/artist/' },
  { slug: 'bluesky', label: 'Bluesky', urlHint: 'https://bsky.app/profile/' },
  { slug: 'snapchat', label: 'Snapchat', urlHint: 'https://snapchat.com/add/' },
  // wa.me is deliberately NOT an alias: a wa.me link is a phone number (services/whatsapp).
  { slug: 'whatsapp', label: 'WhatsApp', urlHint: 'https://whatsapp.com/channel/' },
  { slug: 'telegram', label: 'Telegram', urlHint: 'https://t.me/', aliasHosts: ['telegram.me'] },
  { slug: 'vimeo', label: 'Vimeo', urlHint: 'https://vimeo.com/' },
  { slug: 'songkick', label: 'Songkick', urlHint: 'https://songkick.com/artists/' },
  { slug: 'ko-fi', label: 'Ko-fi', urlHint: 'https://ko-fi.com/' },
  { slug: 'cash app', label: 'Cash App', urlHint: 'https://cash.app/$' },
  { slug: 'venmo', label: 'Venmo', urlHint: 'https://venmo.com/u/' },
  { slug: 'paypal', label: 'PayPal', urlHint: 'https://paypal.me/', aliasHosts: ['paypal.com'] },
  { slug: 'resident advisor', label: 'Resident Advisor', urlHint: 'https://ra.co/dj/', aliasHosts: ['residentadvisor.net'] },
  { slug: 'eventbrite', label: 'Eventbrite', urlHint: 'https://eventbrite.com/o/', aliasHosts: EVENTBRITE_COUNTRIES },
  // 2026-09-28: the music fact databases AI answers lean on. Identity only: they feed the
  // fact card's `sameAs`, never a button.
  { slug: 'musicbrainz', label: 'MusicBrainz', urlHint: 'https://musicbrainz.org/artist/', identityOnly: true },
  { slug: 'discogs', label: 'Discogs', urlHint: 'https://www.discogs.com/artist/', identityOnly: true },
  { slug: 'wikidata', label: 'Wikidata', urlHint: 'https://www.wikidata.org/wiki/', identityOnly: true },
] as const

/** The slug a link row's label joins on. The ONE normalization, so the editor, the
 *  markers and any site all fold "Apple Music" to the same string. */
export function socialSlug(label: string): string {
  return label.trim().toLowerCase()
}

/** The registry entry for a label, or null when the artist has added something we do not
 *  know — which is allowed, and must render as a plain link rather than nothing. */
export function socialPlatform(label: string): SocialPlatform | null {
  const slug = socialSlug(label)
  return SOCIAL_PLATFORMS.find((p) => p.slug === slug) ?? null
}

/** The multi-part public suffixes our platforms' country domains sit under. SMALL and
 *  explicit on purpose (not the whole public-suffix list): it only has to be right for the
 *  hosts `SOCIAL_PLATFORMS` names, and tests/unit/site-editor/social-hosts.test.ts fails
 *  when an alias sits under a suffix missing here. */
const MULTI_PART_SUFFIXES = new Set(['co.uk', 'co.jp', 'co.nz', 'co.za', 'com.au', 'com.br', 'com.mx', 'com.ar', 'com.pe'])

/** A web link's host, lowercased, without `www.` or a trailing dot. Null when the string is
 *  not an http(s) URL: a `javascript:` or `ftp:` link is never a platform's, whatever host
 *  it names. */
export function linkHost(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** The registrable domain of a host: its last two labels (`spotify.com` from
 *  `open.spotify.com`), or three under a listed multi-part suffix (`amazon.co.uk` from
 *  `music.amazon.co.uk`, where two would give `co.uk`, everybody's). The ONE rule the
 *  dashboard's handle parser shares with `platformFromUrl`. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split('.')
  const n = parts.length > 2 && MULTI_PART_SUFFIXES.has(parts.slice(-2).join('.')) ? 3 : 2
  return parts.slice(-n).join('.')
}

/** `host` is `domain` itself or a subdomain of it, never a look-alike (`evilyoutube.com`). */
const isOrUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

const hintHost = (p: SocialPlatform) => linkHost(p.urlHint) ?? ''

/**
 * Infer the platform from a link's URL — so the editor can drop the manual label and
 * pick the icon from what the manager pasted (Sam, 2026-08-12: "the tool should be able
 * to pick up the type of button based on the url"). Null for a host we don't know (a
 * personal site): the caller keeps the URL as a plain link with no icon.
 *
 * Most specific first. A `subdomainOnly` platform claims its own host and its subdomains
 * (music.youtube.com is YouTube Music before it is YouTube). Every other platform matches on
 * the registrable domain of its `urlHint`, or one of its `aliasHosts`, so `www.`, `m.` and
 * an account subdomain (`skeen.bandcamp.com`) don't matter.
 */
export function platformFromUrl(url: string): SocialPlatform | null {
  const host = linkHost(url)
  if (!host) return null
  const narrow = SOCIAL_PLATFORMS.find((p) => p.subdomainOnly && [hintHost(p), ...(p.aliasHosts ?? [])].some((h) => isOrUnder(host, h)))
  if (narrow) return narrow
  const domain = registrableDomain(host)
  return SOCIAL_PLATFORMS.find((p) => !p.subdomainOnly && (registrableDomain(hintHost(p)) === domain || !!p.aliasHosts?.includes(domain))) ?? null
}
