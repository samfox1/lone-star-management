/**
 * The ONE guarded way the server fetches an address someone else chose: the SEO / GEO tests,
 * the EPK download, share previews (lib/og), outside profiles and search-engine registration
 * all go through it. Every address here came from a manager or from a document the server was pointed at (a sitemap, a page's share picture), so every hop
 * is checked before the request leaves:
 *
 *   - `isPublicSiteUrl` on the first address AND on every redirect target. A public host can
 *     302 to `http://169.254.169.254/`; redirects are therefore taken by hand.
 *   - `allow`, the caller's own rule for every hop (same-origin for a site's pages).
 *   - WHERE THE NAME POINTS, at connect (lib/net-guard): the default transport resolves each
 *     hop's host itself and refuses to connect if any address is private, so a name like
 *     `169.254.169.254.nip.io`, or a rebinding record, is refused as `not-public` too.
 *   - a timeout per hop, an optional deadline for the whole call, and a byte cap, so a slow or
 *     endless answer cannot hold a run open.
 *
 * It never throws. No answer is `status: null` with the reason in `error`, and a test that
 * reads it reports `unknown`, never `pass` (lib/seo-tests/types.ts, honesty rule 1).
 *
 * The same guard as lib/seo-audit `fetchGuarded`, which the old live check and the IndexNow
 * ping still use; this one adds the visitor's name, the timeout, the cap and bytes.
 */
import { isPublicSiteUrl } from '@/lib/custom-site'
import { isBlockedAddressError, pickTransport, type Resolver } from '@/lib/net-guard'

type GuardedError = 'not-public' | 'not-allowed' | 'network' | 'timeout' | 'too-many-redirects' | 'bad-redirect'

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
  /** Tests inject a fake web here. Production passes nothing (net-guard's transport), or a
   *  wrapper around `pickTransport()`: an injected fetcher is trusted to check addresses itself.
   *  The global `fetch` is never trusted and is treated as "nothing". */
  fetcher?: typeof fetch
  /** Where names are looked up, for the default transport. Tests inject one; default: DNS. */
  resolver?: Resolver
  /** The exact User-Agent to send. Default: Tapir's own check name. */
  userAgent?: string
  /** Per hop (each request and its body). */
  timeoutMs?: number
  /** The WHOLE call: every hop and the body together. Default: no limit beyond the per-hop
   *  timeout, which lets a four-hop chain take four timeouts. */
  deadlineMs?: number
  maxBytes?: number
  as?: 'text' | 'bytes'
  /** A further rule every hop must pass (the first address included). May be async (a DNS
   *  pre-check, say); it runs before anything is sent. */
  allow?: (url: string) => boolean | Promise<boolean>
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

/** Rejects when `signal` aborts, with its reason. Never settles otherwise. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' }))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
}

/**
 * The body's first `max` bytes. Streams when it can, so a huge answer is never held whole.
 * Every read RACES the request's signal: a transport that does not tie its body to the signal
 * must not let a body that drips a byte at a time hold the read open past the timeout.
 */
async function readCapped(r: Response, max: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const aborted = whenAborted(signal)
  aborted.catch(() => {})
  const reader = r.body?.getReader?.()
  if (!reader) {
    const all = new Uint8Array(await Promise.race([r.arrayBuffer(), aborted]))
    return all.length > max ? { bytes: all.slice(0, max), truncated: true } : { bytes: all, truncated: false }
  }
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>
    try {
      step = await Promise.race([reader.read(), aborted])
    } catch (e) {
      reader.cancel().catch(() => {})
      throw e
    }
    const { done, value } = step
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

/** Why a request or its body failed, in this module's words. */
function failure(e: unknown): GuardedError {
  if (isBlockedAddressError(e)) return 'not-public'
  const name = e instanceof Error ? e.name : ''
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
}

/** Let go of a body nobody will read, so its connection is freed now rather than at GC.
 *  Never awaited: cancelling one branch of a CLONED response (a tee) settles only when the
 *  other branch is cancelled too, so awaiting it can hang forever. */
function discard(r: Response): void {
  try {
    r.body?.cancel?.().catch(() => {})
  } catch {
    // Already errored or locked: nothing left to free.
  }
}

export async function guardedFetch(url: string, opts: GuardedOptions = {}): Promise<GuardedResponse> {
  const fetcher = pickTransport(opts.fetcher, opts.resolver)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const budget = opts.deadlineMs == null ? null : Math.max(0, opts.deadlineMs)
  const endsAt = budget == null ? Infinity : Date.now() + budget
  const deadline = budget == null ? null : AbortSignal.timeout(budget)
  let target = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isPublicSiteUrl(target)) return none('not-public', hop)
    if (opts.allow && !(await opts.allow(target))) return none('not-allowed', hop)
    if (Date.now() >= endsAt) return none('timeout', hop)
    const perHop = AbortSignal.timeout(timeoutMs)
    const signal = deadline ? AbortSignal.any([perHop, deadline]) : perHop
    let r: Response
    try {
      r = await fetcher(target, {
        headers: { 'user-agent': opts.userAgent ?? TAPIR_CHECK_UA, accept: opts.as === 'bytes' ? '*/*' : 'text/html,application/xhtml+xml,*/*;q=0.8' },
        cache: 'no-store',
        redirect: 'manual',
        signal,
      })
    } catch (e) {
      return none(failure(e), hop)
    }
    const status = typeof r.status === 'number' ? r.status : 0
    if (status >= 300 && status < 400) {
      discard(r)
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
      const { bytes, truncated } = await readCapped(r, maxBytes, signal)
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
      return { ...none(failure(e), hop), status, finalUrl: target, headers: headersOf(r) }
    }
  }
  return none('too-many-redirects', MAX_HOPS)
}
