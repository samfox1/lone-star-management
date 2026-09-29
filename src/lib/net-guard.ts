/**
 * Where a NAME points — the SSRF rule the server applies to every address it fetches on a
 * manager's say-so (or on a document's: a sitemap, a page's share picture). SERVER ONLY:
 * this imports node:http/https/net/dns. Never import it from a module a client component
 * imports; `isPublicSiteUrl` (lib/custom-site) is the browser-safe, text-only half.
 *
 * WHY THIS EXISTS. `isPublicSiteUrl` judges the address TEXT. A name that RESOLVES to a
 * private address passes it: `169.254.169.254.nip.io`, or a manager's own DNS record
 * pointing at 10.x, 127.0.0.1, ::1, link-local, CGNAT, or an IPv4-mapped IPv6. And a check
 * that resolves the name and THEN lets `fetch` resolve it again leaves a gap: a record with
 * a zero TTL can answer public to the check and private to the connect (DNS rebinding).
 *
 * HOW IT CLOSES BOTH. `guardedLookup` is handed to the socket as its `lookup`: the ONE
 * lookup whose answer the socket connects to is the one that is judged. Every address in
 * the answer must be public, or the socket gets an error instead of an address. An IP
 * literal never reaches a lookup (net.connect skips it), so the transport judges literals
 * itself before it connects.
 *
 * `safeFetch` is that transport: a `typeof fetch` built on node:http/https (NOT the global
 * fetch, which Next patches and whose undici dispatcher this repo cannot pin without taking
 * a dependency). It never follows a redirect — the callers walk redirects by hand so every
 * hop is re-checked (lib/seo-tests/guarded-fetch, lib/seo-audit `fetchGuarded`).
 *
 * WHAT IT DOES NOT DO. It is not a proxy allowlist; a public host can still be slow or hostile,
 * which the callers' timeouts and byte caps handle. And an INJECTED fetcher is trusted to do
 * its own address check: a production wrapper must wrap `pickTransport()`'s transport, never
 * the global fetch (`pickTransport` substitutes the safe one when handed the global fetch).
 */
import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable, pipeline } from 'node:stream'
import { urlToHttpOptions } from 'node:url'
import zlib from 'node:zlib'

/* ── the address rule ─────────────────────────────────────────────────────────────── */

/**
 * IANA special-purpose IPv4 blocks that are not the open internet, as [base, prefix]. Built
 * per call (fifteen rows, microseconds), not once at import: a module-level table sits out of
 * reach of the mutation run's per-test switching, so no test could be seen to pin a row.
 */
function v4Blocked(): readonly (readonly [number, number, number, number, number])[] {
  return [
    [0, 0, 0, 0, 8], // "this network"
    [10, 0, 0, 0, 8], // private
    [100, 64, 0, 0, 10], // carrier-grade NAT
    [127, 0, 0, 0, 8], // loopback
    [169, 254, 0, 0, 16], // link-local: the cloud metadata address lives here
    [172, 16, 0, 0, 12], // private
    [192, 0, 0, 0, 24], // IETF protocol assignments
    [192, 0, 2, 0, 24], // documentation (TEST-NET-1)
    [192, 88, 99, 0, 24], // 6to4 relay anycast (deprecated)
    [192, 168, 0, 0, 16], // private
    [198, 18, 0, 0, 15], // benchmarking
    [198, 51, 100, 0, 24], // documentation (TEST-NET-2)
    [203, 0, 113, 0, 24], // documentation (TEST-NET-3)
    [224, 0, 0, 0, 4], // multicast
    [240, 0, 0, 0, 4], // reserved, and 255.255.255.255
  ]
}

function v4ToInt(o: readonly number[]): number {
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]
}

function isBlockedV4(o: readonly number[]): boolean {
  const n = v4ToInt(o)
  return v4Blocked().some(([a, b, c, d, bits]) => n >>> (32 - bits) === v4ToInt([a, b, c, d]) >>> (32 - bits))
}

/** Eight 16-bit groups of an IPv6 address `net.isIPv6` already accepted (zone stripped). */
function v6Groups(ip: string): number[] {
  let text = ip
  const tail: number[] = []
  // A dotted IPv4 tail (`::ffff:1.2.3.4`) is two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    const o = dotted[1].split('.').map(Number)
    tail.push((o[0] << 8) | o[1], (o[2] << 8) | o[3])
    text = text.slice(0, -dotted[1].length)
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1)
  }
  const [head, rest] = text.split('::') as [string, string | undefined]
  const read = (s: string | undefined) => (s ? s.split(':').filter(Boolean).map((h) => Number.parseInt(h, 16)) : [])
  const left = read(head)
  const right = [...read(rest), ...tail]
  const fill = rest === undefined ? 0 : 8 - left.length - right.length
  return [...left, ...Array<number>(Math.max(0, fill)).fill(0), ...right]
}

function v4In(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]
}

function isBlockedV6(g: readonly number[]): boolean {
  // ::ffff:a.b.c.d — IPv4 wearing an IPv6 hat. Judge the IPv4.
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isBlockedV4(v4In(g[6], g[7]))
  // NAT64 (64:ff9b::/96) reaches the IPv4 it embeds.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return isBlockedV4(v4In(g[6], g[7]))
  // 6to4 (2002::/16) reaches the IPv4 in its next 32 bits.
  if (g[0] === 0x2002) return isBlockedV4(v4In(g[1], g[2]))
  // Everything outside global unicast (2000::/3) is special: ::, ::1, IPv4-compatible,
  // local-use NAT64, discard, unique-local, link-local, site-local, multicast, SRv6.
  if ((g[0] & 0xe000) !== 0x2000) return true
  if (g[0] === 0x2001 && g[1] < 0x200) return true // 2001::/23 IETF (Teredo, ORCHID, benchmarking)
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true // documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return true // 3fff::/20 documentation
  return false
}

/**
 * Is this address somewhere the server must NOT connect to on an outsider's say-so? Anything
 * that is not a well-formed IP address is refused too: a resolver's answer is not trusted to
 * be sane.
 */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const kind = net.isIP(bare)
  if (kind === 4) return isBlockedV4(bare.split('.').map(Number))
  if (kind === 6) return isBlockedV6(v6Groups(bare.toLowerCase()))
  return true
}

/* ── resolving a name ─────────────────────────────────────────────────────────────── */

export type ResolvedAddress = { address: string; family: 4 | 6 }
/** A name → its addresses. Injected in tests; `systemResolver` (getaddrinfo) otherwise. */
export type Resolver = (hostname: string) => Promise<readonly { address: string; family?: number }[]>

function systemResolver(hostname: string): ReturnType<Resolver> {
  return dnsLookup(hostname, { all: true, verbatim: true })
}

/** The one error this module raises for a refused address. `code` survives any wrapper. */
export class BlockedAddressError extends Error {
  readonly code = 'ERR_ADDRESS_BLOCKED'
  constructor(
    readonly host: string,
    readonly address: string,
  ) {
    super(`refused: ${host} points at a non-public address`)
    this.name = 'BlockedAddressError'
  }
}

export function isBlockedAddressError(e: unknown): e is BlockedAddressError {
  for (let x: unknown = e, depth = 0; x && typeof x === 'object' && depth < 4; x = (x as { cause?: unknown }).cause, depth++) {
    if (x instanceof BlockedAddressError || (x as { code?: unknown }).code === 'ERR_ADDRESS_BLOCKED') return true
  }
  return false
}

function notFound(host: string, cause?: unknown): Error & { code: string } {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND', hostname: host, cause })
}

/**
 * Every address `hostname` resolves to, or an error: `BlockedAddressError` when ANY address
 * is non-public (one private answer among public ones is still a private answer — the socket
 * may pick it), and the resolver's own error (ENOTFOUND) when the name does not resolve. An IP
 * literal is judged as it stands.
 */
export async function resolvePublic(hostname: string, resolver: Resolver = systemResolver): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, '')
  const literal = net.isIP(host)
  if (literal) {
    if (isPrivateAddress(host)) throw new BlockedAddressError(host, host)
    return [{ address: host, family: literal as 4 | 6 }]
  }
  let answers: readonly { address: string; family?: number }[]
  try {
    answers = await resolver(host)
  } catch (e) {
    throw e instanceof Error && 'code' in e ? e : notFound(host, e)
  }
  if (!Array.isArray(answers) || answers.length === 0) throw notFound(host)
  const out: ResolvedAddress[] = []
  for (const a of answers) {
    const address = typeof a?.address === 'string' ? a.address : ''
    if (isPrivateAddress(address)) throw new BlockedAddressError(host, address)
    out.push({ address, family: net.isIP(address) as 4 | 6 })
  }
  return out
}

/* ── the connect-time lookup ──────────────────────────────────────────────────────── */

type LookupOptions = { family?: number | string; all?: boolean }

function isLoopbackAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '')
  if (net.isIPv4(bare)) return bare.startsWith('127.')
  if (!net.isIPv6(bare)) return false
  const g = v6Groups(bare.toLowerCase())
  const mapped = g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff
  return mapped ? g[6] >> 8 === 127 : g.slice(0, 7).every((n) => n === 0) && g[7] === 1
}

/**
 * A `net` lookup function that resolves through `resolver`, refuses the WHOLE answer when any
 * address is non-public, and hands the socket exactly the addresses it checked. Pass it as
 * `lookup` to http(s).request / an Agent / undici's `connect`: the check and the connect are
 * then one lookup, so a rebinding record has no second answer to give.
 */
export function guardedLookup(resolver: Resolver = systemResolver, opts: { allowLoopback?: boolean } = {}): net.LookupFunction {
  const resolve = async (hostname: string): Promise<ResolvedAddress[]> => {
    if (!opts.allowLoopback) return resolvePublic(hostname, resolver)
    // Test hatch: loopback answers pass, every other private answer is still refused.
    const answers = await resolver(hostname.replace(/^\[|\]$/g, ''))
    if (!Array.isArray(answers) || answers.length === 0) throw notFound(hostname)
    return answers.map((a) => {
      if (!isLoopbackAddress(a.address) && isPrivateAddress(a.address)) throw new BlockedAddressError(hostname, a.address)
      return { address: a.address, family: net.isIP(a.address) as 4 | 6 }
    })
  }
  return ((hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    const want = options?.family === 6 || options?.family === 'IPv6' ? 6 : options?.family === 4 || options?.family === 'IPv4' ? 4 : 0
    resolve(hostname).then(
      (all) => {
        const list = want ? all.filter((a) => a.family === want) : all
        if (list.length === 0) return callback(notFound(hostname), options?.all ? [] : '', 0)
        if (options?.all) return callback(null, list)
        callback(null, list[0].address, list[0].family)
      },
      (err: NodeJS.ErrnoException) => callback(err, options?.all ? [] : '', 0),
    )
  }) as net.LookupFunction
}

/* ── the transport ────────────────────────────────────────────────────────────────── */

export type SafeFetchOptions = {
  resolver?: Resolver
  /** Close a connection that goes quiet this long (ms). A caller's own signal usually ends it first. */
  idleTimeoutMs?: number
  /** TESTS ONLY: let 127.0.0.0/8 and ::1 through (a loopback test server); every other
   *  private range stays refused. No production caller passes it. */
  allowLoopback?: boolean
}

const NULL_BODY = new Set([101, 103, 204, 205, 304])

function decoderFor(encoding: string): NodeJS.ReadWriteStream | null {
  switch (encoding.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip()
    case 'deflate':
      return zlib.createInflate()
    case 'br':
      return zlib.createBrotliDecompress()
    default:
      return null
  }
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error && (reason.name === 'AbortError' || reason.name === 'TimeoutError')) return reason
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR', cause: reason })
}

function bodyBytes(body: BodyInit | null | undefined): Buffer | null {
  if (body == null) return null
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8')
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  throw new TypeError('safeFetch: only string, URLSearchParams and byte bodies are supported')
}

/**
 * A `fetch` whose every socket goes through `guardedLookup`. Differences from the global
 * fetch, all deliberate: it NEVER follows a redirect (a 3xx comes back as itself, Location
 * intact, whatever `redirect` says); it keeps no connection pool shared with anything else
 * (a pooled socket from another client would skip the check); it refuses non-http(s)
 * addresses and credentials in the URL; and `cache`/`next` options are ignored.
 */
export function createSafeFetch(opts: SafeFetchOptions = {}): typeof fetch {
  const resolver = opts.resolver ?? systemResolver
  const allowLoopback = opts.allowLoopback === true
  const lookup = guardedLookup(resolver, { allowLoopback })
  const idleTimeoutMs = opts.idleTimeoutMs ?? 30_000
  const agents: Record<'http:' | 'https:', http.Agent> = {
    'http:': new http.Agent({ keepAlive: false, lookup } as http.AgentOptions),
    'https:': new https.Agent({ keepAlive: false, lookup } as https.AgentOptions),
  }

  const safeFetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const req0 = typeof Request !== 'undefined' && input instanceof Request ? input : null
      let url: URL
      try {
        url = new URL(req0 ? req0.url : String(input))
      } catch {
        return reject(new TypeError('safeFetch: invalid URL'))
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new TypeError(`safeFetch: ${url.protocol} is not http(s)`))
      if (url.username || url.password) return reject(new TypeError('safeFetch: credentials in the URL'))
      // net.connect never calls `lookup` for a literal, so judge a literal here.
      const host = url.hostname.replace(/^\[|\]$/g, '')
      if (net.isIP(host) && isPrivateAddress(host) && !(allowLoopback && isLoopbackAddress(host))) {
        return reject(new BlockedAddressError(host, host))
      }
      const signal = init.signal ?? req0?.signal ?? null
      if (signal?.aborted) return reject(abortError(signal))

      const headers = new Headers(req0?.headers)
      new Headers(init.headers).forEach((value, name) => headers.set(name, value))
      if (!headers.has('accept')) headers.set('accept', '*/*')
      if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br')
      const method = (init.method ?? req0?.method ?? 'GET').toUpperCase()
      let payload: Buffer | null
      try {
        payload = bodyBytes(init.body)
      } catch (e) {
        return reject(e)
      }
      if (payload) {
        headers.set('content-length', String(payload.length))
        if (init.body instanceof URLSearchParams && !headers.has('content-type')) {
          headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
        }
      }

      const mod = url.protocol === 'https:' ? https : http
      const req = mod.request(
        {
          ...urlToHttpOptions(url),
          method,
          headers: Object.fromEntries(headers),
          agent: agents[url.protocol],
          lookup,
          ...(signal ? { signal } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0
          const out = new Headers()
          for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
            try {
              out.append(res.rawHeaders[i], res.rawHeaders[i + 1])
            } catch {
              // A header value fetch would refuse to carry: drop it, keep the answer.
            }
          }
          const empty = method === 'HEAD' || NULL_BODY.has(status)
          let body: ReadableStream<Uint8Array> | null = null
          if (empty) {
            res.resume()
          } else {
            const decoder = decoderFor(String(res.headers['content-encoding'] ?? ''))
            const stream: Readable = decoder ? (pipeline(res, decoder, () => {}) as unknown as Readable) : res
            body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
          }
          let response: Response
          try {
            response = new Response(body, { status, statusText: res.statusMessage ?? '', headers: out })
          } catch {
            res.destroy()
            return reject(new TypeError(`safeFetch: unusable response status ${status}`))
          }
          Object.defineProperty(response, 'url', { value: url.href })
          resolve(response)
        },
      )
      req.setTimeout(idleTimeoutMs, () => {
        req.destroy(Object.assign(new Error('safeFetch: the connection went quiet'), { name: 'TimeoutError', code: 'ETIMEDOUT' }))
      })
      req.on('error', (e: Error) => reject(signal?.aborted && e.name !== 'BlockedAddressError' ? abortError(signal) : e))
      req.end(payload ?? undefined)
    })

  return safeFetch as typeof fetch
}

/** The transport every server-side fetch of an outside address uses by default. */
const safeFetch: typeof fetch = createSafeFetch()

/**
 * The transport a guarded fetch should use: the caller's own fetcher when it injected one
 * (tests; or a production wrapper, which must itself wrap `pickTransport()`), else `safeFetch`
 * (built on `resolver` when one is given). The GLOBAL fetch is never a safe transport — it
 * resolves the name again on its own — so being handed it means "the default".
 */
export function pickTransport(fetcher: typeof fetch | undefined, resolver?: Resolver): typeof fetch {
  if (fetcher && fetcher !== globalThis.fetch) return fetcher
  return resolver ? createSafeFetch({ resolver }) : safeFetch
}
