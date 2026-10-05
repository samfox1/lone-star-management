// The public confirm-link page: a token that is not the right shape never reaches the database.
/**
 * Code:     src/app/confirm-email/[token]/actions.ts (confirmEmailTokenAction),
 *           src/lib/enquiries/confirm.ts (isConfirmToken, tokenResult)
 * Feature:  the confirm email's button (EMAIL_CONFIRM_PLAN.md §4): a PUBLIC server action that
 *           calls confirm_email_token with the SERVICE key
 * Tier:     STRICT (AGENTS.md "Test depth"): a validator in front of a service-key call that
 *           anyone on the internet can reach
 * Covers:   • a malformed token (wrong length, padding, standard-base64 characters, spaces,
 *             path pieces, not a string) answers `invalid` and the RPC is NEVER called
 *           • a well-formed token DOES reach the RPC, once, as itself (the witness that the
 *             refusals above are the guard, not a broken mock)
 *           • only a whole confirmation names anyone; an `invalid` row or an error says nothing
 *           Equivalent mutant left: `typeof value === 'string'` in isConfirmToken → true. The
 *           regex coerces whatever it gets, and no File, null or object prints as 43 token
 *           characters; the check stays for the type guard.
 * Not here: what confirm_email_token does with a real token (tests/integration/enquiries/).
 * Fixtures: createAdminClient is faked; the fake records every rpc call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))

const { confirmEmailTokenAction } = await import('@/app/confirm-email/[token]/actions')
const { tokenResult } = await import('@/lib/enquiries/confirm')

/** 43 url-safe base64 characters, as begin_email_confirmation mints them. */
const GOOD = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ_-01234'

const post = (token: unknown) => {
  const form = new FormData()
  if (token !== undefined) form.set('token', token as string)
  return confirmEmailTokenAction(null, form)
}

beforeEach(() => {
  rpc.mockResolvedValue({ data: [{ status: 'confirmed', email: 'jo@x.com', artist_name: 'Skeen', kinds: ['Booking'] }], error: null })
})

describe('the token’s shape', () => {
  // The witness: the right shape reaches the RPC as itself, so a refusal below is the guard.
  it('a well-formed token reaches confirm_email_token, once', async () => {
    expect(GOOD).toHaveLength(43)
    expect(await post(GOOD)).toEqual({ status: 'confirmed', email: 'jo@x.com', artistName: 'Skeen', kinds: ['Booking'] })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('confirm_email_token', { p_token: GOOD })
  })

  // Anything else is not a token this system minted: `invalid`, and no service-key call.
  it.each([
    ['one short', GOOD.slice(1)],
    ['one long', `${GOOD}a`],
    ['with its padding', `${GOOD.slice(1)}=`],
    ['standard base64 +', `${GOOD.slice(1)}+`],
    ['standard base64 /', `${GOOD.slice(1)}/`],
    ['a space', `${GOOD.slice(1)} `],
    ['a newline', `${GOOD.slice(1)}\n`],
    ['a path', `../../${GOOD.slice(6)}`],
    ['a percent escape', `%2e${GOOD.slice(3)}`],
    ['empty', ''],
    ['missing', undefined],
  ])('refuses a token %s, without calling the database', async (_name, token) => {
    expect(await post(token)).toEqual({ status: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
  })

  // A file in the field (a crafted multipart POST) is not a string, so not a token.
  it('refuses a file in place of the token', async () => {
    const form = new FormData()
    form.set('token', new Blob([GOOD]), 'token.txt')
    expect(await confirmEmailTokenAction(null, form)).toEqual({ status: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('what comes back', () => {
  // Unknown, used and expired all answer `invalid` from SQL: nothing about whose link it was.
  it('an invalid row names no one', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'invalid', email: null, artist_name: null, kinds: null }], error: null })
    expect(await post(GOOD)).toEqual({ status: 'invalid' })
  })

  // A row is a confirmation only when it says so AND names an address; what it names is kept
  // to strings (the kinds' labels, the artist's name), anything else dropped.
  it('only a whole confirmation counts, and only its strings are kept', () => {
    expect(tokenResult(null)).toEqual({ status: 'invalid' })
    expect(tokenResult({ status: 'confirmed', email: '' })).toEqual({ status: 'invalid' })
    expect(tokenResult({ status: 'confirmed', email: 42 })).toEqual({ status: 'invalid' })
    expect(tokenResult({ status: 'invalid', email: 'jo@x.com' })).toEqual({ status: 'invalid' })
    expect(tokenResult({ status: 'confirmed', email: 'jo@x.com', artist_name: null, kinds: ['Booking', '', ' ', null, 7] })).toEqual({
      status: 'confirmed',
      email: 'jo@x.com',
      artistName: '',
      kinds: ['Booking'],
    })
    expect(tokenResult({ status: 'confirmed', email: 'jo@x.com', artist_name: 'Skeen', kinds: null })).toMatchObject({ artistName: 'Skeen', kinds: [] })
  })

  // A database error is its own answer (try again), never a confirmation.
  it('an error is an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } })
    expect(await post(GOOD)).toEqual({ status: 'error' })
  })
})
