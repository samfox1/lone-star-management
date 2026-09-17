// TEMPORARY (2026-09-17). The gate on the PostHog cross-check panel at the bottom of the
// artist dashboard. Delete with the panel when the 30-day comparison is over.
//
// The gate is the whole risk in that panel: it reads PostHog with a PERSONAL API key, which
// is a server-only secret, and the comparison exists for exactly one artist. So it must be
// off for everyone else, and off when the key is absent, rather than erroring in a manager's
// face on a page they visit every day.
import { describe, expect, it } from 'vitest'
import { CHECK_SLUG, checkState } from '@/lib/posthog-check'

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
