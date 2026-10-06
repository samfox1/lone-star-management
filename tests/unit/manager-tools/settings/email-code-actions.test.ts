/**
 * The code window's two server actions: what they send, and that only `{ status }` comes back.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/actions.ts
 *           (sendEmailCodeAction, confirmEmailCodeAction)
 * Feature:  confirming an address (EMAIL_CONFIRM_PLAN.md §3)
 * Tier:     STRICT (AGENTS.md "Test depth"): the session's token goes to the Edge Function, and
 *           a code must never reach the browser
 * Covers:   • send: POSTs { artistId, email } to /functions/v1/email-confirm with the SESSION's
 *             access token as the bearer; no session, no call
 *           • send: returns { status } and nothing else, even if the function answered more
 *           • confirm: anything but six digits never reaches confirm_email_code; six do, once
 * Not here: the function and the SQL (tests/unit/enquiries/email-confirm-build.test.ts,
 *           tests/integration/enquiries/).
 * Fixtures: the Supabase server client, requireOwnedArtist and fetch are faked; the project URL
 *           is a stand-in, never the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/_owns', () => ({ requireOwnedArtist: vi.fn(async () => ({ ok: true })) }))

let session: { access_token: string } | null = null
const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getSession: async () => ({ data: { session } }) }, rpc })),
}))

const { sendEmailCodeAction, confirmEmailCodeAction } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/settings/email/actions')

const fetchSpy = vi.fn()
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.example')
  vi.stubGlobal('fetch', fetchSpy)
  session = { access_token: 'tok-123' }
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ status: 'sent' })))
  rpc.mockResolvedValue({ data: 'wrong', error: null })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('sendEmailCodeAction', () => {
  // The function is told who is asking by the session's own token, and which address (as one
  // lower-case key: confirmation is per artist and address).
  it('posts the address with the session’s token as the bearer', async () => {
    expect(await sendEmailCodeAction('a1', ' Jo@X.com ')).toEqual({ status: 'sent' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://project.example/functions/v1/email-confirm')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(init.body as string)).toEqual({ artistId: 'a1', email: 'jo@x.com' })
  })

  // Only the status rides back: a code or token in the answer never reaches the browser.
  it('returns { status } and nothing else', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ status: 'sent', code: '482913', token: 'x'.repeat(43) })))
    expect(await sendEmailCodeAction('a1', 'jo@x.com')).toStrictEqual({ status: 'sent' })
  })

  // No session, no call: nothing else could vouch for the manager.
  it('without a session it sends nothing', async () => {
    session = null
    expect(await sendEmailCodeAction('a1', 'jo@x.com')).toEqual({ status: 'error' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('confirmEmailCodeAction', () => {
  // Only six digits are ever tried: anything else would cost one of the five tries for nothing.
  it.each(['48291', '4829134', '482 913', 'abcdef', ''])('never sends %j to confirm_email_code', async (code) => {
    expect(await confirmEmailCodeAction('a1', 'jo@x.com', code)).toEqual({ status: 'error' })
    expect(rpc).not.toHaveBeenCalled()
  })

  // Six digits go, once, for the address as one lower-case key; the status comes back as said.
  it('sends six digits once and returns the status', async () => {
    expect(await confirmEmailCodeAction('a1', 'Jo@X.com', '482913')).toEqual({ status: 'wrong' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('confirm_email_code', { p_artist_id: 'a1', p_email: 'jo@x.com', p_code: '482913' })
  })
})
