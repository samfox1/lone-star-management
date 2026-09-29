/**
 * The ONE way the SEO / GEO tests fetch anything. Every address here came from a manager or
 * from a document the server was pointed at (a sitemap, a page's share picture), so every hop
 * is checked before the request leaves:
 *
 *   - `isPublicSiteUrl` on the first address AND on every redirect target. A public host can
 *     302 to `http://169.254.169.254/`; redirects are therefore taken by hand.
 *   - `allow`, the caller's own rule for every hop (same-origin for a site's pages).
 *   - a timeout and a byte cap, so a slow or endless answer cannot hold a run open.
 *
 * It never throws. No answer is `status: null` with the reason in `error`, and a test that
 * reads it reports `unknown`, never `pass` (types.ts, honesty rule 1).
 *
 * The same guard as lib/seo-audit `fetchGuarded`, which the old live check and the IndexNow
 * ping still use; this one adds the visitor's name, the timeout, the cap and bytes.
 */
import { isPublicSiteUrl } from '@/lib/custom-site'

export type GuardedError = 'not-public' | 'not-allowed' | 'network' | 'timeout' | 'too-many-redirects' | 'bad-redirect'

export type GuardedResponse = {
  /** null = no answer; see `error`. */
  status: number | null
  /** The hop that answered, after redirects. */
  finalUrl: string | null
  /** How many redirects were followed to get there. */
  hops: number
  /** Lower-cased names. */
  headers: Record<string, string>
  /** The body as text (`as: 'text'`), whatever the status, capped at `maxBytes`. */
  text: string | null
  /** The body's first `maxBytes` bytes (`as: 'bytes'`). */
  bytes: Uint8Array | null
  /** The body was longer than `maxBytes` and was cut. */
  truncated: boolean
  error?: GuardedError
}

export type GuardedOptions = {
  fetcher?: typeof fetch
  /** The exact User-Agent to send. Default: Tapir's own check name. */
  userAgent?: string
  timeoutMs?: number
  maxBytes?: number
  as?: 'text' | 'bytes'
  /** A further rule every hop must pass (the first address included). */
  allow?: (url: string) => boolean
}

export const TAPIR_CHECK_UA = 'TapirSiteCheck/1.0 (+https://digitaltapir.com)'
/** apex → www is one hop, http → https another. Three is generous; the fourth is a loop. */
const MAX_HOPS = 3
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

const none = (error: GuardedError, hops = 0): GuardedResponse => ({
  status: null, finalUrl: null, hops, headers: {}, text: null, bytes: null, truncated: false, error,
})

function headersOf(r: Response): Record<string, string> {
  const out: Record<string, string> = {}
  r.headers?.forEach?.((value, name) => {
    out[name.toLowerCase()] = value
  })
  return out
}

/** The body's first `max` bytes. Streams when it can, so a huge answer is never held whole. */
async function readCapped(r: Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = r.body?.getReader?.()
  if (!reader) {
    const all = new Uint8Array(await r.arrayBuffer())
    return all.length > max ? { bytes: all.slice(0, max), truncated: true } : { bytes: all, truncated: false }
  }
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (size + value.length > max) {
      chunks.push(value.slice(0, max - size))
      size = max
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    size += value.length
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.length
  }
  return { bytes, truncated }
}

export async function guardedFetch(url: string, opts: GuardedOptions = {}): Promise<GuardedResponse> {
  const fetcher = opts.fetcher ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  let target = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isPublicSiteUrl(target)) return none('not-public', hop)
    if (opts.allow && !opts.allow(target)) return none('not-allowed', hop)
    let r: Response
    try {
      r = await fetcher(target, {
        headers: { 'user-agent': opts.userAgent ?? TAPIR_CHECK_UA, accept: opts.as === 'bytes' ? '*/*' : 'text/html,application/xhtml+xml,*/*;q=0.8' },
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      return none(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', hop)
    }
    const status = typeof r.status === 'number' ? r.status : 0
    if (status >= 300 && status < 400) {
      const location = r.headers?.get?.('location') ?? null
      let next: string | null = null
      try {
        next = location ? new URL(location, target).toString() : null
      } catch {
        next = null
      }
      if (!next) return { ...none('bad-redirect', hop), status }
      target = next
      continue
    }
    try {
      const { bytes, truncated } = await readCapped(r, maxBytes)
      return {
        status,
        finalUrl: target,
        hops: hop,
        headers: headersOf(r),
        text: opts.as === 'bytes' ? null : new TextDecoder('utf-8', { fatal: false }).decode(bytes),
        bytes: opts.as === 'bytes' ? bytes : null,
        truncated,
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      return { ...none(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', hop), status, finalUrl: target, headers: headersOf(r) }
    }
  }
  return none('too-many-redirects', MAX_HOPS)
}
