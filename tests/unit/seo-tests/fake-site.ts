/**
 * A fake web for the SEO / GEO tests: no network. Each url answers with a real `Response`, so
 * the code under test reads bodies, headers and streams exactly as it would from `fetch`.
 *
 * Like a real client, it FOLLOWS a redirect itself unless told `redirect: 'manual'`: the code
 * must walk redirects by hand to check each hop, and dropping that option fails a test.
 */

export type FakeAnswer = {
  status?: number
  body?: string | Uint8Array
  /** A body that never ends (chunks of `x` for as long as someone reads). */
  endless?: boolean
  headers?: Record<string, string>
  /** Shorthand for a redirect's Location. */
  location?: string
  /** Wait this long before answering (honours the abort signal). */
  delayMs?: number
  /** Never answer; reject only when the request's signal aborts. */
  hang?: boolean
  /** Throw like a dropped connection. */
  fail?: boolean
}

export type FakeRequest = { url: string; ua: string; init: RequestInit | undefined }
export type Route = FakeAnswer | string | ((req: FakeRequest) => FakeAnswer | string)
export type FakeFetch = typeof fetch & { calls: FakeRequest[]; maxInFlight: () => number }

const abortError = (signal: AbortSignal | null | undefined) =>
  signal?.reason instanceof Error ? signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' })

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(abortError(signal))
    })
  })
}

function endlessStream(): ReadableStream<Uint8Array> {
  const chunk = new TextEncoder().encode('x'.repeat(64 * 1024))
  return new ReadableStream({ pull: (c) => c.enqueue(chunk) })
}

/** `routes` maps an exact url to its answer; a string is a 200 text/html body. Anything else 404s. */
export function fakeSite(routes: Record<string, Route>, fallback?: (req: FakeRequest) => FakeAnswer | string | undefined): FakeFetch {
  const calls: FakeRequest[] = []
  let inFlight = 0
  let maxInFlight = 0
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const ua = new Headers(init?.headers).get('user-agent') ?? ''
    const req = { url, ua, init }
    calls.push(req)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      const route = routes[url] ?? fallback?.(req)
      const raw = typeof route === 'function' ? route(req) : route
      const a: FakeAnswer = raw === undefined ? { status: 404, body: 'not found' } : typeof raw === 'string' ? { body: raw } : raw
      if (a.hang) {
        await new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError(init.signal)))
        })
      }
      if (a.delayMs) await wait(a.delayMs, init?.signal)
      if (a.fail) throw new TypeError('fetch failed')
      const status = a.status ?? 200
      const headers = new Headers(a.headers ?? {})
      if (a.location) headers.set('location', a.location)
      if (!headers.has('content-type') && status >= 200 && status < 300 && typeof a.body === 'string') headers.set('content-type', 'text/html; charset=utf-8')
      if (status >= 300 && status < 400 && a.location && init?.redirect !== 'manual') {
        inFlight--
        try {
          return await impl(new URL(a.location, url).toString(), init)
        } finally {
          inFlight++
        }
      }
      const noBody = status === 204 || status === 304
      const body = noBody ? null : a.endless ? endlessStream() : (a.body ?? '')
      return new Response(body as BodyInit | null, { status, headers })
    } finally {
      inFlight--
    }
  }
  return Object.assign(impl as unknown as typeof fetch, { calls, maxInFlight: () => maxInFlight })
}
