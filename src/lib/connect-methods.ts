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
 * Each platform's spec (noun, hosts, rule, the address around the field) lives in its own
 * service file, `lib/manager-tools/connections/services/<slug>/index.ts`; this module
 * assembles them and holds the parsing every platform shares.
 *
 * Derived from the bridge's SOCIAL_PLATFORMS: every platform a site can show must have a
 * method, and every link a handle builds must be one `platformFromUrl` recognises as that
 * platform (connect-methods.test.ts), or the site would draw it as a plain link.
 *
 * Pure. The modal parses as the manager types; the action parses again (the action is the
 * door, the modal the affordance).
 */
import { SOCIAL_PLATFORMS, platformFromUrl, registrableDomain } from '@samfox1/site-bridge/social'
import { SERVICES, type ConnectSpec } from '@/lib/manager-tools/connections/services'

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

export type LinkMethod = {
  kind: 'link'
  label: string
  /** The only path this platform's profile link may have, when its other links are not a
   *  profile at all (WhatsApp: a channel, never a chat link that carries a phone number).
   *  A link with a `path` is saved without its query or fragment. */
  path?: RegExp
  /** What that link is called, for the refusal: `channel` → "That isn’t a WhatsApp channel link." */
  pathNoun?: string
}

export type ConnectMethod = HandleMethod | LinkMethod

/** Each platform's own spec, from its service file (`lib/manager-tools/connections/services/<slug>`). */
const SPECS: Record<string, ConnectSpec> = Object.fromEntries(SERVICES.flatMap((s) => (s.social ? [[s.social.key, s.social.method]] : [])))

/** Every social platform the bridge knows, keyed by its slug, with how it connects. */
export const CONNECT_METHODS: Readonly<Record<string, ConnectMethod>> = Object.fromEntries(
  SOCIAL_PLATFORMS.flatMap((p) => {
    const spec = SPECS[p.slug]
    if (!spec) return []
    const method: ConnectMethod = 'kind' in spec ? { ...spec, label: p.label } : { kind: 'handle', label: p.label, ...spec }
    return [[p.slug, method]]
  }),
)

/** "an X", "an Instagram", "a TikTok": the article for a platform's name as it is said. */
export const withArticle = (label: string) => (/^[aeioux]/i.test(label) ? `an ${label}` : `a ${label}`)
const a = withArticle

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
  let keepUrl: string | null = null
  if (looksLikeLink) {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    } catch {
      return bad
    }
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
    // The site's own reading decides (the bridge's platformFromUrl, the same host rules):
    // `music.youtube.com` sits on youtube.com but is YouTube Music's, not YouTube's. A host
    // no platform claims falls back to this method's own list.
    const other = platformFromUrl(url.href)
    const mine = other ? other.label === method.label : method.hosts.includes(registrableDomain(host))
    if (!mine) return { error: other ? `That’s ${a(other.label)} link, not ${method.label}.` : `That isn’t ${a(method.label)} link.` }
    const sub = host !== registrableDomain(host) ? host.split('.')[0] : null
    const segments = url.pathname.split('/').filter(Boolean)
    if (method.subdomain) {
      if (!sub) return enter
      handle = sub
    } else if (method.alsoSubdomain && sub) {
      // A pasted subdomain link is its OWN page (Substack's publication, not its
      // `@handle` profile) — keep it as the manager pasted it, share junk (path, query,
      // trailing slash) stripped, rather than rebuilding the other page's link.
      handle = sub
      keepUrl = `https://${host}`
    } else {
      const special = method.fromPath?.(segments, url)
      if (special && 'url' in special) return { handle: null, url: special.url }
      handle = special ? special.handle : (segments[0] ?? '')
    }
  } else {
    handle = text
  }
  handle = handle.replace(/^@/, '')
  // The address around the field already ends in `$` (Cash App's `cash.app/$`): a typed or
  // pasted `$` is that same one, not part of the handle.
  if (method.before.endsWith('$')) handle = handle.replace(/^\$/, '')
  if (!handle) return enter
  if (!method.rule.test(handle)) return bad
  return { handle, url: keepUrl ?? method.url(handle) }
}

/** A stored profile link, shown as its handle again — or null when the link is not a plain
 *  profile of this platform (a YouTube channel id, another site): show the link instead. */
export function handleFromUrl(method: HandleMethod, url: string): string | null {
  const parsed = parseHandle(method, url)
  return 'error' in parsed ? null : parsed.handle
}
