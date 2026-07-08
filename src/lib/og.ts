/**
 * Open-Graph scraping for the "Add" modal's Automatic mode: paste a product/page
 * URL, we fetch its HTML and pull the title / image / price from its meta tags so
 * the manager doesn't retype them.
 *
 * SSRF matters here — the URL is user-supplied and fetched SERVER-side — so
 * `isPublicHttpUrl` gates every fetch to public http(s) hosts (no localhost, no
 * private/link-local IPs, no cloud metadata endpoint). Parsing is a pure function
 * over the HTML string, so it's unit-testable without the network.
 */
import net from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'

/** Minimal HTML entity decode for meta content (the few that actually show up). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** property/name → content for every <meta> tag (attribute order-insensitive). */
function metaMap(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]
    if (key && content != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decodeEntities(content)
  }
  return out
}

export type OpenGraph = { title: string | null; image: string | null; price: string | null }

/** Pull title / image / price from a page's OG + Twitter-card meta (and <title>). */
export function parseOpenGraph(html: string): OpenGraph {
  const m = metaMap(html)
  const title =
    m['og:title'] ||
    m['twitter:title'] ||
    decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '') ||
    null
  const image = m['og:image'] || m['og:image:secure_url'] || m['twitter:image'] || m['twitter:image:src'] || null
  const rawPrice = m['og:price:amount'] || m['product:price:amount'] || m['twitter:data1'] || ''
  // Keep only a sane numeric price (strip a currency symbol / commas); else null.
  const priceNum = Number(rawPrice.replace(/[^0-9.]/g, ''))
  const price = rawPrice && Number.isFinite(priceNum) && priceNum > 0 ? String(priceNum) : null
  return { title: title || null, image, price }
}

/** Is this IPv4 literal private / loopback / link-local / any-net? */
function ipv4Private(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 || a === 127 || a === 10 || // any-net, loopback, private
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  )
}

/** Is this IP LITERAL (v4 or v6) non-public? Handles IPv6 loopback/link-local/ULA and
 *  IPv4-mapped IPv6 (::ffff:a.b.c.d), which the old dotted-decimal-only check missed. */
function ipPrivate(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (net.isIPv4(h)) return ipv4Private(h)
  if (net.isIPv6(h)) {
    if (h === '::1' || h === '::') return true
    if (/^(fe80|fc|fd)/.test(h)) return true // link-local + unique-local
    // IPv4-mapped IPv6, either dotted (::ffff:1.2.3.4) or hex (::ffff:a9fe:a9fe) —
    // the WHATWG URL parser normalizes the dotted form to hex, so handle both.
    const dot = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (dot) return ipv4Private(dot[1])
    const hex = h.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const hi = parseInt(hex[1], 16)
      const lo = parseInt(hex[2], 16)
      return ipv4Private(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`)
    }
    return false
  }
  return false
}

/**
 * SSRF gate (synchronous): rejects non-http(s) schemes, embedded credentials,
 * localhost/*.local/*.internal, and any PRIVATE IP LITERAL — v4, v6, or IPv4-mapped
 * v6. Hostname → IP resolution (which also catches decimal/octal/short-form literals)
 * is done separately by hostResolvesPublic, so this stays a pure/testable function.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (net.isIP(host) && ipPrivate(host)) return false
  return true
}

/**
 * Resolve a host and confirm every address is public. Closes the literal bypasses the
 * sync gate can't (decimal/octal/short-form IPv4 → getaddrinfo normalizes them) and a
 * hostname that points at a private IP. Failure/anything private → false. A pure
 * DNS-rebind (public now, private at connect) remains out of scope — this is
 * enrich-only, and the fetched body is never trusted as authenticated.
 */
async function hostResolvesPublic(host: string, lookup: HostLookup): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, '')
  if (net.isIP(h)) return !ipPrivate(h)
  try {
    const addrs = await lookup(h)
    return addrs.length > 0 && addrs.every((ip) => !ipPrivate(ip))
  } catch {
    return false
  }
}

type HostLookup = (host: string) => Promise<string[]>
const defaultLookup: HostLookup = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address)

type FetchOpts = { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number; lookup?: HostLookup }

/**
 * Fetch a public URL's HTML and parse its Open-Graph tags. Returns null when the
 * URL is blocked, the request fails, or the response isn't HTML. Caps the body size
 * and time so a hostile/huge page can't hang or blow up memory.
 *
 * Redirects are followed MANUALLY (`redirect: 'manual'`) and every hop is re-checked
 * with isPublicHttpUrl — otherwise a public URL that 302s to an internal host
 * (localhost, a private IP, the cloud-metadata endpoint) would slip past the initial
 * guard. Capped at a few hops so a redirect loop can't spin.
 */
export async function fetchOpenGraph(url: string, opts: FetchOpts = {}): Promise<OpenGraph | null> {
  const doFetch = opts.fetchImpl ?? fetch
  const lookup = opts.lookup ?? defaultLookup
  const maxBytes = opts.maxBytes ?? 512_000
  let current = url

  for (let hop = 0; hop < 4; hop++) {
    // Gate the initial URL AND every redirect hop: sync literal/scheme check + host resolution.
    if (!isPublicHttpUrl(current)) return null
    if (!(await hostResolvesPublic(new URL(current).hostname, lookup))) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6000)
    try {
      const res = await doFetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'LoneStarBot/1.0 (+link preview)' },
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return null
        current = new URL(loc, current).toString() // resolve relative → re-validated next loop
        continue
      }
      if (!res.ok) return null
      const type = res.headers.get('content-type') ?? ''
      if (!type.includes('html')) return null
      return parseOpenGraph((await res.text()).slice(0, maxBytes))
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null // too many redirects
}
