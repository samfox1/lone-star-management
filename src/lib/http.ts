/**
 * Shared GET-with-retry for the integration clients (ADR-0005). Owns the one
 * thing all of them duplicated: the 429 / Retry-After backoff loop with a
 * NaN-guarded header parse. Per-client quirks parameterize cleanly:
 *   - auth      → `headers` (a thunk, so token clients refresh per attempt)
 *   - body errs → `onBody`  (e.g. Deezer signals quota in the body with HTTP 200)
 *   - messages  → `provider`
 * Each client shrinks to: build URL + auth + map. (Shopify is GraphQL POST and
 * keeps its own request path.)
 */
export type HttpGetOptions = {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  /** Provider name for error messages, e.g. 'Spotify'. */
  provider?: string
  /** Per-attempt request headers (a thunk so token clients can refresh). */
  headers?: () => Promise<Record<string, string>> | Record<string, string>
  /** Inspect the parsed body: return 'retry' to back off + retry (an in-body
   *  rate-limit), or throw to fail. Undefined → accept the body. */
  onBody?: (body: unknown) => 'retry' | undefined
}

export async function httpGetJson<T>(url: string, opts: HttpGetOptions = {}): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const provider = opts.provider ?? 'API'

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = opts.headers ? await opts.headers() : undefined
    const res = await doFetch(url, headers ? { headers } : undefined)

    if (res.status === 429) {
      const parsed = Number(res.headers.get('retry-after') ?? '1')
      const retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : 1 // date-form header → NaN
      await sleep(retryAfter * 1000)
      continue
    }
    if (!res.ok) throw new Error(`${provider} API error ${res.status}`)

    const body = (await res.json()) as T
    if (opts.onBody && opts.onBody(body) === 'retry') {
      await sleep(1000)
      continue
    }
    return body
  }
  throw new Error(`${provider} API rate-limited after ${maxRetries} retries`)
}
