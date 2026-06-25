/**
 * Shared GET-with-retry helper. The client tests exercise it indirectly; this
 * locks the cross-cutting behavior — notably the NaN-guarded Retry-After (the
 * drift bug that motivated the extraction) and the onBody retry hook.
 */
import { describe, expect, it, vi } from 'vitest'
import { httpGetJson } from '@/lib/http'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }
function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

describe('httpGetJson', () => {
  it('returns the parsed body on success', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { ok: 1 } }) as unknown as Response)
    expect(await httpGetJson('https://x/', { fetchImpl: fetchImpl as never })).toEqual({ ok: 1 })
  })

  it('retries on 429 honoring a numeric Retry-After', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let n = 0
    const fetchImpl = vi.fn(async () =>
      (n++ === 0 ? res({ status: 429, headers: { 'retry-after': '3' }, body: {} }) : res({ body: { ok: 1 } })) as unknown as Response,
    )
    await httpGetJson('https://x/', { fetchImpl: fetchImpl as never, sleep })
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it('CRITICAL: a non-numeric (HTTP-date) Retry-After falls back to 1s, not NaN', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let n = 0
    const fetchImpl = vi.fn(async () =>
      (n++ === 0
        ? res({ status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }, body: {} })
        : res({ body: { ok: 1 } })) as unknown as Response,
    )
    await httpGetJson('https://x/', { fetchImpl: fetchImpl as never, sleep })
    expect(sleep).toHaveBeenCalledWith(1000) // never sleep(NaN)
  })

  it('throws a provider-labelled error on HTTP failure', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 500, body: {} }) as unknown as Response)
    await expect(httpGetJson('https://x/', { fetchImpl: fetchImpl as never, provider: 'Acme' })).rejects.toThrow(
      /Acme API error 500/,
    )
  })

  it('onBody can request a retry (in-body rate limit) or throw', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => res({ body: { code: n } }) as unknown as Response)
    const out = await httpGetJson<{ code: number }>('https://x/', {
      fetchImpl: fetchImpl as never,
      sleep: () => Promise.resolve(),
      onBody: (b) => ((b as { code: number }).code === 0 ? (n++, 'retry') : undefined),
    })
    expect(out.code).toBe(1)
  })

  it('applies per-attempt headers (so token clients refresh)', async () => {
    const fetchImpl = vi.fn(async () => res({ body: {} }) as unknown as Response)
    await httpGetJson('https://x/', { fetchImpl: fetchImpl as never, headers: () => ({ Authorization: 'Bearer t' }) })
    expect(fetchImpl).toHaveBeenCalledWith('https://x/', { headers: { Authorization: 'Bearer t' } })
  })
})
