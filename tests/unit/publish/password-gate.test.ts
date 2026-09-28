// Every password-gated publish shares one gate; a rate limit is not a wrong password.
/**
 * `verifyPasswordGate` (actions.ts) turns Supabase's sign-in error into exactly one of
 * three copy strings. Before this, EVERY error — including Supabase's own 429 "Request
 * rate limit reached" (`over_request_rate_limit`) — was flattened into "Incorrect
 * password.", which told a manager they were wrong when the real problem was too many
 * tries (Sam, 2026-09-28).
 *
 * Exercised THROUGH `publishAction` (the Overview's "Publish all"): asserting on a stub
 * of the throwaway sign-in client would test Supabase's SDK shape, not the gate; the
 * action is what has to map the error, and it is what a regression here would actually
 * break. `publishAllGatedAction` shares the exact same `verifyPasswordGate`, so this
 * pins the one function every gated publish depends on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'm@example.test' } } }) },
  })),
}))

// The gate signs in on a THROWAWAY client built from '@supabase/supabase-js', never the
// request-bound one above — each test controls what that throwaway sign-in answers.
const signInWithPassword = vi.fn()
vi.mock('@supabase/supabase-js', async (orig) => ({
  ...(await orig<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({ auth: { signInWithPassword } }),
}))

const A = 'a1'

beforeEach(() => {
  signInWithPassword.mockReset()
})

describe('verifyPasswordGate (through publishAction)', () => {
  it('CRITICAL: a real wrong password says "Incorrect password."', async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' },
    })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'wrong')).toEqual({ ok: false, error: 'Incorrect password.' })
  })

  it("CRITICAL: Supabase's rate limit (429) does NOT read as a wrong password", async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: 'Request rate limit reached', status: 429, code: 'over_request_rate_limit' },
    })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: false, error: 'Too many tries — wait a minute and try again.' })
  })

  it('a rate limit is still recognised by status alone, with no `code` on the error', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Request rate limit reached', status: 429 } })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: false, error: 'Too many tries — wait a minute and try again.' })
  })

  it('an unrecognized auth error gets a generic message, never "Incorrect password."', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'network hiccup', status: 500 } })
    const { publishAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await publishAction(A, 'pw')).toEqual({ ok: false, error: "Couldn't check the password." })
  })

  // The right-password path (`{ error: null }`) is already pinned end-to-end in
  // publish-one-insert.test.ts, over a fake DB client this file has no need to rebuild.
})
