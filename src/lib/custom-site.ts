/**
 * Custom-site helpers (SITE_STYLING_PLAN.md). An artist's public site is either a
 * built-in template or a fully custom site hosted elsewhere (e.g. the Vercel
 * skeen-website). The `site_kind` / `custom_site_url` columns are config, not
 * published content, so they're read directly from `artists` — never through the
 * published snapshot (get_public_site) or ARTIST_SNAPSHOT.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// Written via RegExp so the control-char range stays legible as escapes.
const CONTROL_CHAR = new RegExp('[\\u0000-\\u001f\\u007f]')

/** Host suffixes that name a machine on the LAN, not a site on the internet. */
const PRIVATE_SUFFIX = /(^|\.)(localhost|local|internal|home\.arpa|localdomain)$/i
/** A site runs on 80/443. Any other port is the server's egress being probed. */
const PUBLIC_PORTS = new Set(['', '80', '443'])

/** RFC1918 + the other ranges that never leave the building, given four octets. */
function isPrivateIpv4(o: number[]): boolean {
  const [a, b] = o
  if (a === 0 || a === 10 || a === 127) return true // this network, private, loopback
  if (a === 169 && b === 254) return true // link-local — the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 192 && b === 0) return true // IETF protocol assignments / 192.0.0.0/24 + TEST-NET-1
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

function ipv4Octets(host: string): number[] | null {
  // WHATWG's URL parser normalises every legal IPv4 spelling (decimal, hex, short form)
  // to dotted-quad before it reaches us, so this only has to read the normal shape.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const o = m.slice(1).map(Number)
  return o.every((n) => n <= 255) ? o : null
}

/** The eight hextets of an IPv6 literal (brackets already stripped), or null. */
function ipv6Hextets(host: string): number[] | null {
  if (!host.includes(':')) return null
  const [head, tail] = host.split('::', 2) as [string, string | undefined]
  // A trailing `::ffff:127.0.0.1` keeps its dotted tail: fold it into two hextets first.
  const expand = (part: string): string[] => {
    const bits = part ? part.split(':').filter((s) => s !== '') : []
    const last = bits[bits.length - 1]
    const quad = last ? ipv4Octets(last) : null
    if (quad) bits.splice(-1, 1, ((quad[0] << 8) | quad[1]).toString(16), ((quad[2] << 8) | quad[3]).toString(16))
    return bits
  }
  const left = expand(head)
  const right = tail === undefined ? [] : expand(tail)
  const fill = 8 - left.length - right.length
  if (tail === undefined ? left.length !== 8 : fill < 0) return null
  const parts = [...left, ...Array(tail === undefined ? 0 : fill).fill('0'), ...right]
  const out = parts.map((p) => Number.parseInt(p, 16))
  return out.length === 8 && out.every((n) => Number.isFinite(n) && n >= 0 && n <= 0xffff) ? out : null
}

function isPrivateIpv6(h: number[]): boolean {
  if (h.every((n) => n === 0)) return true // ::
  if (h.slice(0, 7).every((n) => n === 0) && h[7] === 1) return true // ::1 loopback
  if ((h[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((h[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 hat. Judge the IPv4 inside it.
  if (h.slice(0, 5).every((n) => n === 0) && h[5] === 0xffff) {
    return isPrivateIpv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff])
  }
  return false
}

/**
 * Is this an address on the OPEN INTERNET — somewhere a fan could be sent, and somewhere
 * this server may fetch on a manager's say-so?
 *
 * `custom_site_url` is manager-typed free text, and two things act on it: `/[slug]` 308s
 * a fan to it, and the SEO / GEO page's live check FETCHES it from the server. The second
 * is SSRF: `http://169.254.169.254/` is the cloud metadata service, reachable from inside
 * and from nowhere else, and the check hands fragments of what it finds back to the
 * browser (`tag.slice(0, 80)`, `sitemap.urls`). So the rule is not "is it a URL" but "is
 * it a PUBLIC one", and it is enforced at both the door and the fetch.
 *
 * What this does NOT stop, stated plainly: a hostname that RESOLVES to a private address
 * (DNS rebinding). Nothing here resolves DNS — pinning the socket to a checked IP means
 * a custom undici dispatcher, and the fetcher is injected. The redirect chain IS checked
 * hop by hop (see seo-audit), which closes the easy version of the same trick.
 */
/** Opt-in relaxations. Deliberately an ARGUMENT rather than an `NODE_ENV` sniff: the
 *  test runner sets NODE_ENV='test', so an env-read hatch would open itself inside the
 *  very suite that proves the guard works and every denial there would be vacuously true
 *  (AGENTS.md rule 2). A caller has to ask for this on purpose. */
export type PublicUrlOptions = {
  /** Allow 127.0.0.0/8, ::1 and the `localhost` suffixes — a developer's OWN machine,
   *  and nothing else. Set only where the URL is handed to the BROWSER (the editor's
   *  iframe, the public redirect), never where this server will fetch it. */
  allowLoopback?: boolean
}

function isLoopback(host: string, v4: number[] | null, v6: number[] | null): boolean {
  if (v4) return v4[0] === 127
  if (v6) return v6.every((h, i) => (i === 7 ? h === 1 : h === 0))
  return /(^|\.)localhost$/i.test(host.replace(/\.$/, ''))
}

export function isPublicSiteUrl(
  raw: string | null | undefined,
  opts: PublicUrlOptions = {},
): boolean {
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  if (CONTROL_CHAR.test(trimmed) || !/^https?:\/\//i.test(trimmed)) return false
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return false
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host) return false
  const v6 = ipv6Hextets(host)
  const v4 = v6 ? null : ipv4Octets(host)
  // LOOPBACK ONLY, and only when asked. Checked BEFORE the port rule as well as before
  // the range rules, because a local dev server is the whole point of the hatch and it
  // never runs on 80/443 — FTBK's is `http://localhost:3004`. 169.254.169.254 is a cloud
  // metadata endpoint and 10.x is somebody's intranet; neither becomes reachable through
  // here, whatever port they are on.
  if (opts.allowLoopback && isLoopback(host, v4, v6)) return true
  if (!PUBLIC_PORTS.has(u.port)) return false
  if (v6) return !isPrivateIpv6(v6)
  if (v4) return !isPrivateIpv4(v4)
  if (PRIVATE_SUFFIX.test(host)) return false
  // A single label ("intranet", "router") resolves only on the local network's search
  // domain. Every site on the internet has a dot in it.
  return host.replace(/\.$/, '').includes('.')
}

/**
 * `custom_site_url` as a USABLE redirect target, or null.
 *
 * The column is manager-supplied free text and `/[slug]` hands it straight to
 * `permanentRedirect` — a PUBLIC, unauthenticated route. So an unchecked value is an
 * arbitrary-scheme Location on a fan-facing URL, and a 308 at that: browsers cache it,
 * so one bad save outlives the fix. http(s) only — deliberately stricter than safeHref,
 * whose mailto:/tel: are legitimate links but not places a site can be hosted. A
 * relative or protocol-relative value is refused for the same reason: neither names a
 * host to send the fan to. Control chars are refused outright — this string becomes a
 * response header, and a CR/LF in it splits the response.
 *
 * The host itself must be PUBLIC (isPublicSiteUrl): a value the server will later fetch
 * is refused at the door as well as at the fetch, so one bad save cannot reach either.
 * The cost is that a site running on localhost cannot be connected — point the editor at
 * a deployed preview instead.
 */
function redirectTarget(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (CONTROL_CHAR.test(trimmed)) return null
  // `[^\s/]` after the slashes demands a host, so `https:///x` names nowhere to go.
  if (!/^https?:\/\/[^\s/]\S*$/i.test(trimmed)) return null
  // `allowLoopback` in DEVELOPMENT only. This value is handed to the browser — a 308 the
  // fan's browser follows, or the editor iframe's `src` — so loopback here reaches the
  // developer's own machine and never this server. Without it the guard does not error
  // but silently DEMOTES a local site to a template one: FTBK's `custom_site_url` is
  // `http://localhost:3004` in the live DB today, and lone-star's own setup docs tell you
  // to set one. Vercel builds (preview included) run as 'production', so the hatch is
  // shut everywhere it could matter.
  return isPublicSiteUrl(trimmed, { allowLoopback: process.env.NODE_ENV === 'development' })
    ? trimmed
    : null
}

/**
 * The external URL a custom-site artist redirects to / is embedded from, or null
 * when the artist uses a built-in template.
 *
 * Goes through the `public_custom_site` DOOR, not a table read: `/[slug]` is a
 * PUBLIC route on the anon client, and `artists_select` RLS
 * (`is_admin() OR is_manager_of(id)`) hides the row from a visitor — a direct read
 * returned null for everyone and the redirect silently never fired
 * (20260714170000). The door is SECURITY DEFINER and returns only the redirect
 * target, so anon never sees the rest of the artists row.
 *
 * A MANAGER-side caller that already holds the row (e.g. `requireArtist`) should
 * use `isCustom(row)` directly instead of paying for this round-trip.
 */
export async function customSiteUrl(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await supabase.rpc('public_custom_site', { p_slug: slug })
  // The door is SECURITY DEFINER and returns the column verbatim, so the scheme check
  // belongs on this side of it — see redirectTarget.
  return redirectTarget(data as string | null)
}

/** Whether a `{ site_kind, custom_site_url }` row is a usable custom site — same
 *  http(s) rule the public redirect applies, so the manager-side editor and the fan-side
 *  route agree on what counts as a site. */
export function isCustom(row: { site_kind?: string | null; custom_site_url?: string | null } | null): boolean {
  return !!row && row.site_kind === 'custom' && redirectTarget(row.custom_site_url) !== null
}

/**
 * The absolute origin of the artist's PUBLIC site, for anything that fetches it as a
 * crawler would (the SEO page's live check, links to Google's testers): the custom site
 * when one is connected, else the hosted `/[slug]` page on this app's own origin
 * (NEXT_PUBLIC_APP_URL), else null.
 */
export function publicSiteOrigin(
  row: { slug?: string | null; site_kind?: string | null; custom_site_url?: string | null } | null,
): string | null {
  if (!row) return null
  if (isCustom(row)) return redirectTarget(row.custom_site_url)!.replace(/\/+$/, '')
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return app && row.slug ? `${app}/${row.slug}` : null
}
