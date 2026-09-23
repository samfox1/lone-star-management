// TEMPORARY (2026-09-17). The gate on the PostHog cross-check panel at the bottom of the
// artist dashboard. Delete with the panel when the 30-day comparison is over.
//
// The gate is the whole risk in that panel: it reads PostHog with a PERSONAL API key, which
// is a server-only secret, and the comparison exists for exactly one artist. So it must be
// off for everyone else, and off when the key is absent, rather than erroring in a manager's
// face on a page they visit every day.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { CHECK_SLUG, checkState } from '@/lib/posthog-check'
import { PostHogCheck, PostHogCheckSlot, POSTHOG_TIMEOUT_MS } from '@/components/ui/posthog-check'
import { comparisonWindow, hogqlQueries, HOGQL_COLUMNS } from '@/lib/compare-posthog'

describe('checkState', () => {
  const env = { POSTHOG_PERSONAL_API_KEY: 'phx_test', POSTHOG_PROJECT_ID: '123' }

  it('CRITICAL: shows only for the one artist being compared', () => {
    expect(checkState('skeen', env)).toBe('ready')
    expect(CHECK_SLUG).toBe('skeen')
    for (const other of ['wren', 'ftbk', 'SKEEN', 'skeen-2', '']) {
      expect(checkState(other, env), other).toBe('hidden')
    }
  })

  it('CRITICAL: hidden when either PostHog credential is missing, never an error', () => {
    expect(checkState('skeen', { POSTHOG_PROJECT_ID: '123' })).toBe('hidden')
    expect(checkState('skeen', { POSTHOG_PERSONAL_API_KEY: 'phx_test' })).toBe('hidden')
    expect(checkState('skeen', {})).toBe('hidden')
    expect(checkState('skeen', { POSTHOG_PERSONAL_API_KEY: '', POSTHOG_PROJECT_ID: '' })).toBe('hidden')
  })

  it('CRITICAL: the key it reads is server-only — a NEXT_PUBLIC one would ship to every fan', () => {
    expect(checkState('skeen', { NEXT_PUBLIC_POSTHOG_PERSONAL_API_KEY: 'phx_test', POSTHOG_PROJECT_ID: '123' })).toBe('hidden')
  })
})

// Review 2026-09-23: the panel could hang skeen's overview page and could report false
// door drops. These drive the real component with the network and the database faked.
describe('PostHogCheck — the panel itself', () => {
  const NOW = Date.parse('2026-09-23T12:00:00Z')
  const calls: string[] = []
  const supabase = {
    rpc: vi.fn(async (fn: string) => {
      calls.push(`ours:${fn}`)
      return { data: [], error: null }
    }),
  }

  beforeEach(() => {
    calls.length = 0
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test')
    vi.stubEnv('POSTHOG_PROJECT_ID', '123')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reads PostHog BEFORE ours, so the gap can never look like a door drop', async () => {
    // Answer each query with ITS columns, so the PostHog read succeeds and ours runs.
    const byQuery = new Map(Object.entries(hogqlQueries(CHECK_SLUG, comparisonWindow(30, NOW), true)).map(([n, q]) => [q, n]))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      calls.push('posthog')
      await gate
      const name = byQuery.get(JSON.parse(String(init?.body)).query.query) as keyof typeof HOGQL_COLUMNS
      return new Response(JSON.stringify({ results: [], columns: HOGQL_COLUMNS[name] }))
    }))
    const out = PostHogCheck({ supabase: supabase as never, artistId: 'a1', slug: CHECK_SLUG, now: NOW })
    // PostHog is in flight and has not answered: ours must not have started. Listing
    // PostHog first inside a Promise.all would still overlap the reads, and fail here.
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.some((c) => c.startsWith('ours:'))).toBe(false)
    release()
    await out

    const firstOurs = calls.findIndex((c) => c.startsWith('ours:'))
    expect(firstOurs).toBeGreaterThan(-1)
    expect(calls.slice(0, firstOurs).length).toBeGreaterThan(0)
    expect(calls.slice(firstOurs).includes('posthog')).toBe(false)
  })

  it('gives up on a PostHog that never answers, instead of hanging the page', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((_ok, fail) => {
      init?.signal?.addEventListener('abort', () => fail(new Error('aborted')))
    })))
    const out = PostHogCheck({ supabase: supabase as never, artistId: 'a1', slug: CHECK_SLUG, now: Date.parse('2026-09-23T12:00:00Z') })
    await vi.advanceTimersByTimeAsync(POSTHOG_TIMEOUT_MS + 1)
    const el = (await out) as { props: { children: unknown[] } }
    expect(JSON.stringify(el)).toMatch(/could not run/)
  })

  it('gives up on a PostHog whose BODY never finishes, without aborting the stream', async () => {
    // Seen live 2026-09-23: aborting a fetch after the headers arrived tripped Node 20's
    // undici ("controller[kState].transformAlgorithm is not a function"), which escaped
    // the panel's try/catch and failed the Suspense boundary. So the body is raced
    // against a timer instead, and the signal must NOT be aborted once headers are in.
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return { ok: true, status: 200, json: () => new Promise(() => {}) }
    }))
    const out = PostHogCheck({ supabase: supabase as never, artistId: 'a1', slug: CHECK_SLUG, now: NOW })
    await vi.advanceTimersByTimeAsync(POSTHOG_TIMEOUT_MS + 1)
    expect(JSON.stringify(await out)).toMatch(/could not run/)
    expect(signal?.aborted).toBe(false)
  })

  it('streams in behind the page: the slot is a Suspense boundary with no fallback', () => {
    const el = PostHogCheckSlot({ supabase: supabase as never, artistId: 'a1', slug: CHECK_SLUG, now: 0 }) as { type: unknown; props: { fallback: unknown } }
    expect(el.type).toBe(Suspense)
    expect(el.props.fallback).toBeNull()
  })
})
