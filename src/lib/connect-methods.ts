/**
 * HOW EACH PLATFORM ASKS TO BE CONNECTED (Sam, 2026-09-28: "Each site should ask you for as
 * minimal info as possible. if the user just wants to link an account, like this user's case
 * on x, they should simply be able to add their x handle, thats it").
 *
 *   handle — the account has a name, and the link is built from it: X, Instagram, TikTok…
 *            The field shows the address around it in grey (`x.com/` [skeenmusic]), takes
 *            the handle with or without @, and reads a pasted link back to its handle
 *            (share junk, `www.`, the old twitter.com and all).
 *   link   — the account has no name, only an id: an artist on Spotify, Apple Music,
 *            Deezer or Tidal. The manager pastes their artist link; for the first three the
 *            id inside it also connects the catalog (lib/connections idFromProfileUrl).
 *
 * Services with an API of their own (Shopify, Bandsintown, Drive…) are not here: each keeps
 * its own fields in lib/connections.
 *
 * Derived from the bridge's SOCIAL_PLATFORMS: every platform a site can show must have a
 * method, and every link a handle builds must be one `platformFromUrl` recognises as that
 * platform (connect-methods.test.ts), or the site would draw it as a plain link.
 *
 * Pure. The modal parses as the manager types; the action parses again (the action is the
 * door, the modal the affordance).
 */
import { SOCIAL_PLATFORMS, platformFromUrl } from '@samfox1/site-bridge/social'

export type HandleMethod = {
  kind: 'handle'
  /** The platform's name, for the one-line messages. */
  label: string
  /** What the field asks for. */
  noun: 'handle' | 'username' | 'invite code' | 'page name' | 'name'
  /** The address around the handle, grey and fixed: `x.com/` before, `.bandcamp.com` after. */
  before: string
  after: string
  /** Registrable hosts a pasted link may come from; the first is the one we build. */
  hosts: readonly string[]
  /** A handle as the platform allows it. */
  rule: RegExp
  /** A real-looking handle, for the placeholder (and the test that proves the round trip). */
  example: string
  /** handle → the profile link the site shows. */
  url: (handle: string) => string
  /** The account is a SUBDOMAIN (`skeen.bandcamp.com`); `alsoSubdomain` for a platform
   *  that accepts both shapes (Substack). */
  subdomain?: boolean
  alsoSubdomain?: boolean
  /** A link that is this platform's but not a plain `/<handle>` (a YouTube channel id, a
   *  Discord invite page, a Facebook profile.php): its handle, a link to keep as it is, or
   *  undefined to fall back to the first path segment. */
  fromPath?: (segments: string[], url: URL) => { handle: string } | { url: string } | undefined
}

export type LinkMethod = { kind: 'link'; label: string }

export type ConnectMethod = HandleMethod | LinkMethod

type Spec = Omit<HandleMethod, 'kind' | 'label'> | { kind: 'link' }

const at = (host: string) => ({ before: `${host}/@`, after: '', url: (h: string) => `https://${host}/@${h}` })
const slash = (host: string) => ({ before: `${host}/`, after: '', url: (h: string) => `https://${host}/${h}` })

const SPECS: Record<string, Spec> = {
  instagram: { noun: 'username', hosts: ['instagram.com'], rule: /^[A-Za-z0-9._]{1,30}$/, example: 'skeenmusic', ...slash('instagram.com') },
  tiktok: { noun: 'handle', hosts: ['tiktok.com'], rule: /^[A-Za-z0-9._]{2,24}$/, example: 'skeenmusic', ...at('tiktok.com') },
  youtube: {
    noun: 'handle',
    hosts: ['youtube.com', 'youtu.be'],
    rule: /^[A-Za-z0-9._-]{3,30}$/,
    example: 'skeenmusic',
    ...at('youtube.com'),
    // A channel link with no handle in it is still the channel: keep it, on the one host.
    fromPath: (segments) => {
      const [first, second] = segments
      if (first && ['channel', 'c', 'user'].includes(first) && second) return { url: `https://youtube.com/${first}/${second}` }
      return undefined
    },
  },
  soundcloud: { noun: 'username', hosts: ['soundcloud.com'], rule: /^[A-Za-z0-9_-]{2,25}$/, example: 'skeenmusic', ...slash('soundcloud.com') },
  bandcamp: {
    noun: 'name',
    hosts: ['bandcamp.com'],
    rule: /^[A-Za-z0-9-]{1,63}$/,
    example: 'skeen',
    before: '',
    after: '.bandcamp.com',
    url: (h) => `https://${h}.bandcamp.com`,
    subdomain: true,
  },
  facebook: {
    noun: 'page name',
    hosts: ['facebook.com', 'fb.com'],
    rule: /^[A-Za-z0-9.]{2,50}$/,
    example: 'skeenmusic',
    ...slash('facebook.com'),
    fromPath: (segments, url) => {
      const id = url.searchParams.get('id')
      if (segments[0] === 'profile.php' && id && /^\d+$/.test(id)) return { url: `https://facebook.com/profile.php?id=${id}` }
      return undefined
    },
  },
  x: { noun: 'handle', hosts: ['x.com', 'twitter.com'], rule: /^[A-Za-z0-9_]{1,15}$/, example: 'skeenmusic', ...slash('x.com') },
  threads: { noun: 'handle', hosts: ['threads.net', 'threads.com'], rule: /^[A-Za-z0-9._]{1,30}$/, example: 'skeenmusic', ...at('threads.net') },
  substack: { noun: 'handle', hosts: ['substack.com'], rule: /^[A-Za-z0-9_-]{1,40}$/, example: 'skeen', ...at('substack.com'), alsoSubdomain: true },
  patreon: { noun: 'page name', hosts: ['patreon.com'], rule: /^[A-Za-z0-9_]{1,64}$/, example: 'skeen', ...slash('patreon.com') },
  discord: {
    noun: 'invite code',
    hosts: ['discord.gg', 'discord.com'],
    rule: /^[A-Za-z0-9-]{2,32}$/,
    example: 'AbC123',
    ...slash('discord.gg'),
    fromPath: (segments, url) => {
      if (url.hostname.endsWith('discord.com') && segments[0] === 'invite' && segments[1]) return { handle: segments[1] }
      return undefined
    },
  },
  twitch: { noun: 'username', hosts: ['twitch.tv'], rule: /^[A-Za-z0-9_]{4,25}$/, example: 'skeenmusic', ...slash('twitch.tv') },
  spotify: { kind: 'link' },
  'apple music': { kind: 'link' },
  deezer: { kind: 'link' },
  tidal: { kind: 'link' },
}

/** Every social platform the bridge knows, keyed by its slug, with how it connects. */
export const CONNECT_METHODS: Readonly<Record<string, ConnectMethod>> = Object.fromEntries(
  SOCIAL_PLATFORMS.flatMap((p) => {
    const spec = SPECS[p.slug]
    if (!spec) return []
    const method: ConnectMethod = 'kind' in spec ? { kind: 'link', label: p.label } : { kind: 'handle', label: p.label, ...spec }
    return [[p.slug, method]]
  }),
)

/** "an X", "an Instagram", "a TikTok": the article for a platform's name as it is said. */
export const withArticle = (label: string) => (/^[aeioux]/i.test(label) ? `an ${label}` : `a ${label}`)
const a = withArticle

/** The last two labels of a host, lowercased, without `www.`/`m.`/`mobile.`. */
function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^(www|m|mobile)\./, '').split('.')
  return parts.slice(-2).join('.')
}

export type ParsedHandle = { handle: string | null; url: string } | { error: string }

/**
 * Whatever the manager typed — `skeenmusic`, `@skeenmusic`, or a pasted profile link — as
 * the handle and the one link the site needs, or the reason it can't be, in one sentence.
 * `handle` is null for a link that is the platform's but has no handle in it (a YouTube
 * channel id), which is kept as it is.
 */
export function parseHandle(method: HandleMethod, raw: string): ParsedHandle {
  const enter = { error: `Enter the ${method.label} ${method.noun}.` }
  const bad = { error: `That doesn’t look like ${a(method.label)} ${method.noun}.` }
  const text = raw.trim()
  if (!text) return enter

  // A link, not a handle: a scheme, a path, or one of this platform's hosts in it. A dot
  // alone is not enough — `skeen.music` is a fine TikTok handle.
  const looksLikeLink =
    /^https?:\/\//i.test(text) || text.includes('/') || method.hosts.some((h) => text.toLowerCase().includes(h))
  let handle: string
  if (looksLikeLink) {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    } catch {
      return bad
    }
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
    const mine = method.hosts.includes(registrable(host))
    if (!mine) {
      const other = platformFromUrl(url.href)
      return { error: other ? `That’s ${a(other.label)} link, not ${method.label}.` : `That isn’t ${a(method.label)} link.` }
    }
    const sub = host.split('.').length > 2 ? host.split('.')[0] : null
    const segments = url.pathname.split('/').filter(Boolean)
    if (method.subdomain) {
      if (!sub) return enter
      handle = sub
    } else if (method.alsoSubdomain && sub) {
      handle = sub
    } else {
      const special = method.fromPath?.(segments, url)
      if (special && 'url' in special) return { handle: null, url: special.url }
      handle = special ? special.handle : (segments[0] ?? '')
    }
  } else {
    handle = text
  }
  handle = handle.replace(/^@/, '')
  if (!handle) return enter
  if (!method.rule.test(handle)) return bad
  return { handle, url: method.url(handle) }
}

/** A stored profile link, shown as its handle again — or null when the link is not a plain
 *  profile of this platform (a YouTube channel id, another site): show the link instead. */
export function handleFromUrl(method: HandleMethod, url: string): string | null {
  const parsed = parseHandle(method, url)
  return 'error' in parsed ? null : parsed.handle
}
