/**
 * Nothing the server fetches can fill its memory or hold a request open: every read stops at a
 * byte cap, and every fetch ends at its time limit.
 *
 * Code:     src/lib/seo-tests/guarded-fetch.ts (guardedFetch: maxBytes, timeoutMs, deadlineMs),
 *           src/lib/seo-audit.ts (fetchGuarded), src/lib/og.ts (fetchOpenGraph), src/lib/net-guard.ts
 *           (createSafeFetch: idle timeout, abort signal)
 * Feature:  safe fetching: the SEO/GEO checks, the old live check, IndexNow, and the Add modal's
 *           link preview
 * Tier:     STRICT (AGENTS.md "Test depth"): security. The transport unzips, so a few hundred KB
 *           on the wire can be gigabytes in memory, and a body that drips a byte at a time can
 *           hold a request open forever (security review 2026-09-29, F3).
 * Covers:   • each reader stops PULLING at its cap (not reading everything and cutting after),
 *             for a streamed body and one without a stream
 *           • a server that never answers, or a body that drips and ignores the abort signal,
 *             ends at the timeout
 *           • a deadline ends the WHOLE call (every redirect hop together), cuts a single slow
 *             hop short, and a spent deadline sends nothing
 *           • the transport drops a connection that goes quiet, and an abort stops a body that
 *             never ends; an already-aborted request sends nothing
 * Not here: parsers that are slow on hostile text (slow-parsers.test.ts); the SEO checks' own run
 *           budget across many pages (tests/unit/seo-tests).
 * Fixtures: hand-made streams that count what was pulled, or drip a byte every 20 ms; the fake web
 *           (tests/unit/seo-tests/fake-site.ts) with delays and a server that never answers; a real
 *           loopback server whose /slow page never finishes (_loopback-server.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSafeFetch } from '@/lib/net-guard'
import { guardedFetch } from '@/lib/seo-tests/guarded-fetch'
import { fetchGuarded } from '@/lib/seo-audit'
import { fetchOpenGraph } from '@/lib/og'
import { fakeDns } from '@tests/helpers/fake-dns'
import { fakeSite } from '@tests/unit/seo-tests/fake-site'
import { startLoopbackServer, type LoopbackServer } from '@tests/unit/safe-fetching/_loopback-server'

const SITE = 'https://www.example.com/'
const MIB = 1024 * 1024
const SIXTY_FOUR_MIB = 64 * MIB

/** An answer of `total` bytes of html, pulled a MiB at a time; counts what was pulled. */
function big(total: number) {
  const counter = { pulled: 0 }
  const chunk = new TextEncoder().encode(`<p>${'x'.repeat(MIB - 7)}</p>`)
  const fetcher = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          if (counter.pulled >= total) return c.close()
          counter.pulled += chunk.length
          c.enqueue(chunk)
        },
      }),
      { status: 200, headers: { 'content-type': 'text/html' } },
    )) as unknown as typeof fetch
  return { fetcher, counter }
}

/** A body that sends one byte every 20 ms, forever, and stops only when the request is aborted. */
function drip() {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    let timer: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        timer = setInterval(() => c.enqueue(new Uint8Array([120])), 20)
        init?.signal?.addEventListener('abort', () => {
          clearInterval(timer)
          c.error(init.signal!.reason)
        })
      },
      cancel() {
        clearInterval(timer)
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
  }) as unknown as typeof fetch
}

describe('byte caps', () => {
  // A 64 MiB answer is cut at the cap and only a chunk or two past it is ever pulled: a reader
  // that took everything and cut afterwards would pass a length check, but not this one.
  it('CRITICAL: guardedFetch cuts a big body at the cap, and stops reading there', async () => {
    const { fetcher, counter } = big(SIXTY_FOUR_MIB)
    const r = await guardedFetch(SITE, { fetcher, maxBytes: 200_000 })
    expect(r).toMatchObject({ status: 200, truncated: true })
    expect(r.text).toHaveLength(200_000)
    expect(counter.pulled).toBeLessThanOrEqual(200_000 + 2 * MIB)
  })

  // An answer with no stream (only a whole buffer) is capped too.
  it('guardedFetch caps a body that has no stream too', async () => {
    const whole = 'y'.repeat(50_000)
    const fetcher = (async () => ({ status: 200, headers: new Headers(), body: null, arrayBuffer: async () => new TextEncoder().encode(whole).buffer })) as unknown as typeof fetch
    const r = await guardedFetch(SITE, { fetcher, maxBytes: 1000 })
    expect(r).toMatchObject({ truncated: true })
    expect(r.text).toHaveLength(1000)
  })

  // fetchGuarded (the old live check, IndexNow) stops at its own 2 MiB cap and says it cut.
  it('CRITICAL: fetchGuarded stops pulling at its cap (2 MiB), whatever the answer’s size', async () => {
    const { fetcher, counter } = big(SIXTY_FOUR_MIB)
    const r = await fetchGuarded(`${SITE}`, fetcher)
    // The cap, plus the chunk that crossed it and the one a stream pulls ahead: not 64 MiB.
    expect(counter.pulled).toBeLessThanOrEqual(2 * MIB + 2 * MIB)
    expect(r.status).toBe(200)
    expect(r.body?.length ?? 0).toBeLessThanOrEqual(2 * MIB)
    expect(r.truncated).toBe(true)
  })

  // The link preview stops at its 512 KB cap and still reads the share tags at the top of the page.
  it('CRITICAL: fetchOpenGraph stops pulling at its cap, and still reads the tags at the top', async () => {
    const counter = { pulled: 0 }
    const head = new TextEncoder().encode('<html><head><meta property="og:title" content="Vinyl LP"></head><body>')
    const chunk = new Uint8Array(MIB).fill(120)
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            if (counter.pulled >= SIXTY_FOUR_MIB) return c.close()
            const piece = counter.pulled === 0 ? head : chunk
            counter.pulled += piece.length
            c.enqueue(piece)
          },
        }),
        { status: 200, headers: { 'content-type': 'text/html' } },
      )) as unknown as typeof fetch
    const og = await fetchOpenGraph('https://shop.example-artist.com/p', { fetchImpl, lookup: async () => ['93.184.216.34'] })
    expect(og?.title).toBe('Vinyl LP')
    // Its 512 KB cap, plus the chunk that crossed it and the one a stream pulls ahead.
    expect(counter.pulled).toBeLessThanOrEqual(512_000 + 2 * MIB + head.length)
  })
})

describe('time limits', () => {
  // A server that never answers is given up on at the timeout, reported as `timeout`.
  it('guardedFetch gives up on a server that never answers, at the timeout', async () => {
    const f = fakeSite({ [SITE]: { hang: true } })
    const t = Date.now()
    const r = await guardedFetch(SITE, { fetcher: f, timeoutMs: 100 })
    expect(r).toMatchObject({ status: null, error: 'timeout' })
    expect(Date.now() - t).toBeLessThan(1500)
  })

  // A transport that does not tie its body to the request's signal (a fake, a wrapper that drops
  // it) must not let a dripping body hold the read open: the reader races the signal itself.
  it('CRITICAL: a body that drips and IGNORES the abort signal still ends at the timeout', async () => {
    let timer: ReturnType<typeof setInterval> | undefined
    const fetcher = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (c) => void (timer = setInterval(() => c.enqueue(new Uint8Array([120])), 20)),
          cancel: () => clearInterval(timer),
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    const t = Date.now()
    const r = await guardedFetch(SITE, { fetcher, timeoutMs: 250 })
    clearInterval(timer)
    expect(Date.now() - t).toBeLessThan(1500)
    expect(r).toMatchObject({ status: 200, error: 'timeout', text: null })
  }, 4000)

  // fetchGuarded ends a dripping body at its timeout, with no body.
  it('CRITICAL: fetchGuarded ends a dripping body at its timeout', async () => {
    const t = Date.now()
    const r = await fetchGuarded(SITE, drip(), { timeoutMs: 300 })
    expect(Date.now() - t).toBeLessThan(2000)
    expect(r.body).toBeNull()
  }, 5000)

  // The link preview ends a dripping body at its timeout, with no preview.
  it('CRITICAL: fetchOpenGraph ends a dripping body at its timeout', async () => {
    const t = Date.now()
    const og = await fetchOpenGraph('https://shop.example-artist.com/p', { fetchImpl: drip(), lookup: async () => ['93.184.216.34'], timeoutMs: 300 })
    expect(Date.now() - t).toBeLessThan(2000)
    expect(og).toBeNull()
  }, 5000)
})

describe('a deadline for the whole call (guardedFetch)', () => {
  const chain = () =>
    fakeSite({
      'https://a.example.com/': { status: 302, location: 'https://b.example.com/', delayMs: 150 },
      'https://b.example.com/': { status: 302, location: 'https://c.example.com/', delayMs: 150 },
      'https://c.example.com/': { body: 'end', delayMs: 150 },
    })

  // Three slow hops each fit their own timeout (the chain arrives), but a deadline ends the
  // whole walk: without it, a four-hop chain could take four timeouts.
  it('a slow chain that fits each hop’s timeout is still ended by the deadline for the whole call', async () => {
    expect(await guardedFetch('https://a.example.com/', { fetcher: chain(), timeoutMs: 1000 })).toMatchObject({ status: 200, hops: 2, text: 'end' })
    const f = chain()
    const t = Date.now()
    const r = await guardedFetch('https://a.example.com/', { fetcher: f, timeoutMs: 1000, deadlineMs: 250 })
    expect(r).toMatchObject({ status: null, error: 'timeout' })
    expect(Date.now() - t).toBeLessThan(450)
    expect(f.calls.length).toBeLessThan(3)
  })

  // The deadline also cuts one slow hop short, not only the gaps between hops.
  it('the deadline also cuts a single slow hop short', async () => {
    const f = fakeSite({ [SITE]: { body: 'late', delayMs: 800 } })
    const t = Date.now()
    expect(await guardedFetch(SITE, { fetcher: f, timeoutMs: 2000, deadlineMs: 150 })).toMatchObject({ status: null, error: 'timeout' })
    expect(Date.now() - t).toBeLessThan(600)
  })

  // A deadline of zero or less means "no time left": nothing is sent.
  it('a deadline already spent sends nothing', async () => {
    const f = chain()
    expect(await guardedFetch('https://a.example.com/', { fetcher: f, deadlineMs: 0 })).toMatchObject({ status: null, error: 'timeout' })
    expect(await guardedFetch('https://a.example.com/', { fetcher: f, deadlineMs: -5 })).toMatchObject({ status: null, error: 'timeout' })
    expect(f.calls).toHaveLength(0)
  })
})

describe('the safe transport’s own limits (createSafeFetch)', () => {
  let server: LoopbackServer
  beforeAll(async () => {
    server = await startLoopbackServer()
  })
  afterAll(() => server.close())
  const local = () => createSafeFetch({ resolver: fakeDns({ 'site.test': ['127.0.0.1'] }), allowLoopback: true })

  // A connection that stops sending is dropped after the idle time, so reading its body fails.
  it('a connection that goes quiet is dropped', async () => {
    const f = createSafeFetch({ resolver: fakeDns({ 'site.test': ['127.0.0.1'] }), allowLoopback: true, idleTimeoutMs: 100 })
    const r = await f(`http://site.test:${server.port}/slow`)
    const err = await r.text().catch((e) => e)
    expect(err).toBeInstanceOf(Error)
  })

  // The caller's abort signal stops a body that never ends, promptly.
  it('an abort signal stops a body that never ends', async () => {
    const r = await local()(`http://site.test:${server.port}/slow`, { signal: AbortSignal.timeout(150) })
    const t = Date.now()
    const err = await r.text().catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(Date.now() - t).toBeLessThan(2000)
  })

  // A signal that is already aborted sends nothing, and the error is an AbortError that keeps
  // the caller's own reason.
  it('an already-aborted signal sends nothing, and rejects with an AbortError that keeps its reason', async () => {
    const before = server.connections()
    const plain = new AbortController()
    plain.abort()
    expect(((await local()(`http://site.test:${server.port}/`, { signal: plain.signal }).catch((e) => e)) as Error).name).toBe('AbortError')
    const reasoned = new AbortController()
    reasoned.abort('because')
    const err = (await local()(`http://site.test:${server.port}/`, { signal: reasoned.signal }).catch((e) => e)) as Error & { cause?: unknown }
    expect(err.name).toBe('AbortError')
    expect(err.cause).toBe('because')
    expect(server.connections()).toBe(before)
  })
})
