/**
 * In the real database, an address receives enquiries only once it is confirmed (or still in its
 * legacy grace), and it is confirmed only by a manager of that artist typing the code from that
 * inbox, or by the link from that inbox.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ NOT RUN until the migration is pushed. Flip EMAIL_CONFIRMATIONS_PUSHED in                │
 * │ tests/helpers/email-confirmations.ts in the SAME change as the push, then run            │
 * │ tests/integration/enquiries/ and `npm run audit:grants`.                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Code:     supabase/migrations/20261006120000_email_confirmations.sql
 * Feature:  Sam, 2026-09-30: "there should be a confirmation email sent with a code for us to
 *           make sure the email is legit" … "this should be required before deploying".
 *           EMAIL_CONFIRM_PLAN.md, piece 1.
 * Tier:     STRICT (AGENTS.md "Test depth"): permissions, and who the live routing mails. Every
 *           denial has a planted witness (the address IS listed, the code IS right, the token IS
 *           live), every row state is read back through the service client, and every row sits
 *           under a throwaway artist this file drops. Seen red on a throwaway local Postgres 18
 *           (2026-10-05, Supabase's default EXECUTE grants stubbed in): with the row lock removed
 *           from confirm_email_code, 8 wrong guesses at once all came back 'wrong' and 1 try was
 *           stored; with the per-artist lock removed, two sends at 19 both went.
 * Covers:   • the doors: anon executes none of the four functions, a manager neither of the two
 *             service-only ones, and nobody but the service role reads or writes the table
 *           • who: a manager cannot read or confirm another artist's addresses; a code is sent
 *             only for a manager of the artist, and only to an address on its lists
 *           • routing: unconfirmed receives nothing, confirmed does; grace receives until it
 *             ends; one confirm covers every list; the primary is the first CONFIRMED address;
 *             confirming for one artist confirms nothing for another
 *           • the code: 5 wrong tries and it is dead, also when fired at once; 15 minutes; a new
 *             send replaces code and link; the 60 s, 5-per-address and 20-per-artist caps
 *           • the link: it confirms once; used, unknown and expired all answer 'invalid'
 *           • only SHA-256 hashes are stored
 * Not here: the legacy-grace SEED, which runs once, at push time, on real artists' rows
 *           (checked locally: one row per artist and lower(email), 14 days, safe to re-run).
 *           The email itself: supabase/functions/email-confirm, tests/unit/enquiries/.
 *           The door end to end (submit_enquiry with an unconfirmed address): enquiry-door.test.ts.
 * Fixtures: the HOSTED project: managers A and B signed in, the service client, throwaway
 *           artists dropped by this file (their confirmations, kinds and lists cascade).
 */
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { EMAIL_CONFIRMATIONS_PUSHED, confirmForRouting } from '@tests/helpers/email-confirmations'
import { expectExecuteDenied, expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const MIN = 60 * 1000
const HOUR = 60 * MIN

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

type Begin = {
  status: string
  code: string | null
  token: string | null
  artist_name: string | null
  kinds: string[] | null
  site_host: string | null
}
type TokenReply = { status: string; email: string | null; artist_name: string | null; kinds: string[] | null }
type Row = {
  email: string
  confirmed_at: string | null
  grace_until: string | null
  code_hash: string | null
  code_expires_at: string | null
  code_attempts: number
  token_hash: string | null
  token_expires_at: string | null
  sent_at: string[]
}
type Status = { email: string; confirmed: boolean; waiting: boolean }

describe.skipIf(!EMAIL_CONFIRMATIONS_PUSHED)('email confirmations', () => {
  const svc = serviceClient()
  const anon = anonClient()
  let asA: SupabaseClient
  let asB: SupabaseClient
  let userA: string
  let userB: string
  /** Managed by A. */
  let a: ThrowawayArtist
  /** Managed by B: the other side of every isolation assertion. */
  let b: ThrowawayArtist

  /** A new address per test, so no test reads another's row. */
  const fresh = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@example.com`
  /** Certainly not the code. */
  const wrongFor = (code: string) => (code === '000000' ? '000001' : '000000')

  async function kindId(artistId: string, slug: string): Promise<string> {
    const { data, error } = await svc.from('enquiry_kinds').select('id').eq('artist_id', artistId).eq('slug', slug).single()
    if (error) throw new Error(`kind ${slug}: ${error.message}`)
    return (data as { id: string }).id
  }

  /** Put an address on a kind's list, and prove it is there: the witness every "receives nothing" needs. */
  async function list(artistId: string, slug: string, email: string, createdAt?: string): Promise<void> {
    const { error } = await svc.from('enquiry_recipients').insert({
      artist_id: artistId,
      kind_id: await kindId(artistId, slug),
      email,
      ...(createdAt ? { created_at: createdAt } : {}),
    })
    if (error) throw new Error(`list ${email}: ${error.message}`)
    const { data } = await svc.from('enquiry_recipients').select('id').eq('artist_id', artistId).eq('email', email)
    expect(data, `${email} was not planted on ${slug}`).toHaveLength(1)
  }

  async function begin(userId: string, artistId: string, email: string): Promise<Begin> {
    const { data, error } = await svc.rpc('begin_email_confirmation', {
      p_user_id: userId,
      p_artist_id: artistId,
      p_email: email,
    })
    if (error) throw new Error(`begin_email_confirmation: ${error.message}`)
    return (data as Begin[])[0]
  }

  /** begin, insisting it SENT: the code and the token are what the test types back. */
  async function send(artistId: string, email: string, userId = userA): Promise<{ code: string; token: string }> {
    const r = await begin(userId, artistId, email)
    expect(r.status, `send to ${email}`).toBe('sent')
    return { code: r.code!, token: r.token! }
  }

  const confirmCode = async (client: SupabaseClient, artistId: string, email: string, code: string) => {
    const { data, error } = await client.rpc('confirm_email_code', { p_artist_id: artistId, p_email: email, p_code: code })
    return { verdict: data as string | null, error }
  }

  async function confirmToken(token: string): Promise<TokenReply> {
    const { data, error } = await svc.rpc('confirm_email_token', { p_token: token })
    if (error) throw new Error(`confirm_email_token: ${error.message}`)
    return (data as TokenReply[])[0]
  }

  async function row(artistId: string, email: string): Promise<Row | null> {
    const { data, error } = await svc
      .from('artist_email_confirmations')
      .select('*')
      .eq('artist_id', artistId)
      .eq('email', email.toLowerCase())
      .maybeSingle()
    if (error) throw new Error(`read confirmation: ${error.message}`)
    return data as Row | null
  }

  async function status(client: SupabaseClient, artistId: string): Promise<Status[]> {
    const { data, error } = await client.rpc('email_confirmation_status', { p_artist_id: artistId })
    if (error) throw new Error(`email_confirmation_status: ${error.message}`)
    return data as Status[]
  }

  /** Who an enquiry of this kind is addressed to, lower case. */
  async function routed(artistId: string, purpose: string): Promise<string[]> {
    const { data, error } = await svc.rpc('resolve_enquiry_recipients', { p_artist_id: artistId, p_purpose: purpose })
    if (error) throw new Error(`resolve_enquiry_recipients: ${error.message}`)
    return ((data ?? []) as { to_email: string }[]).map((r) => r.to_email.toLowerCase())
  }

  /** Forget an artist's send times so the caps do not carry between tests. Every row under a
   *  throwaway artist is this file's own. */
  async function forgetSends(artistId: string): Promise<void> {
    const { error } = await svc.from('artist_email_confirmations').update({ sent_at: [] }).eq('artist_id', artistId)
    if (error) throw new Error(`forget sends: ${error.message}`)
  }

  async function setSends(artistId: string, email: string, times: string[]): Promise<void> {
    const { error } = await svc
      .from('artist_email_confirmations')
      .update({ sent_at: times })
      .eq('artist_id', artistId)
      .eq('email', email.toLowerCase())
    if (error) throw new Error(`set sends: ${error.message}`)
  }

  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    asB = await signInAs(SEED.managerB)
    userA = (await asA.auth.getUser()).data.user!.id
    userB = (await asB.auth.getUser()).data.user!.id
    a = await createThrowawayArtist(svc, 'email confirm A', asA)
    b = await createThrowawayArtist(svc, 'email confirm B', asB)
  })

  beforeEach(async () => {
    if (a) await forgetSends(a.id)
    if (b) await forgetSends(b.id)
  })

  afterAll(async () => {
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, b)
  })

  describe('the doors', () => {
    // Anon is refused all four by GRANT (42501 naming the function), not by a missing function.
    it('CRITICAL: anon can execute none of the four', async () => {
      const calls: [string, Record<string, unknown>][] = [
        ['email_confirmation_status', { p_artist_id: a.id }],
        ['begin_email_confirmation', { p_user_id: userA, p_artist_id: a.id, p_email: 'x@example.com' }],
        ['confirm_email_code', { p_artist_id: a.id, p_email: 'x@example.com', p_code: '000000' }],
        ['confirm_email_token', { p_token: 'x' }],
      ]
      for (const [fn, args] of calls) expectExecuteDenied((await anon.rpc(fn, args)).error, fn)
    })

    // A manager cannot mail anyone or confirm by link themselves: only the Edge Function and the link page can.
    it('CRITICAL: a signed-in manager cannot send a code or use a link, even for their own artist', async () => {
      // Witnesses: A manages `a`, the address is listed, and the token is live. A call that got
      // through would send an email, or confirm without the inbox.
      const email = fresh('svc-only')
      await list(a.id, 'booking', email)
      const { token } = await send(a.id, email)

      expectExecuteDenied(
        (await asA.rpc('begin_email_confirmation', { p_user_id: userA, p_artist_id: a.id, p_email: email })).error,
        'begin_email_confirmation',
      )
      expectExecuteDenied((await asA.rpc('confirm_email_token', { p_token: token })).error, 'confirm_email_token')

      const r = await row(a.id, email)
      expect(r!.sent_at).toHaveLength(1)
      expect(r!.confirmed_at).toBeNull()
      expect(r!.token_hash).toBe(sha256(token))
    })

    // Nobody but the service role reads or writes the table: a manager cannot mark their own typo confirmed.
    it('CRITICAL: nobody but the service role reads or writes the table', async () => {
      // The bypass this closes: a manager marking their own typo "confirmed", or reading hashes.
      const email = fresh('table')
      await list(a.id, 'booking', email)
      await send(a.id, email)
      expect(await row(a.id, email)).not.toBeNull()

      expectRlsDenied((await anon.from('artist_email_confirmations').select('email').eq('artist_id', a.id)).error, 'anon read')
      expectRlsDenied((await asA.from('artist_email_confirmations').select('email').eq('artist_id', a.id)).error, 'manager read')
      expectRlsDenied(
        (await asA.from('artist_email_confirmations').update({ confirmed_at: new Date().toISOString() }).eq('artist_id', a.id)).error,
        'manager self-confirm',
      )
      const other = fresh('self-insert')
      await list(a.id, 'booking', other)
      expectRlsDenied(
        (await asA.from('artist_email_confirmations').insert({ artist_id: a.id, email: other, confirmed_at: new Date().toISOString() })).error,
        'manager insert',
      )
      expectRlsDenied(
        (await anon.from('artist_email_confirmations').insert({ artist_id: a.id, email: other, confirmed_at: new Date().toISOString() })).error,
        'anon insert',
      )

      expect((await row(a.id, email))!.confirmed_at).toBeNull()
      expect(await row(a.id, other)).toBeNull()
      expect(await routed(a.id, 'booking')).not.toContain(other)
    })
  })

  describe('who', () => {
    // One manager cannot see another artist's addresses or which are confirmed.
    it("CRITICAL: a manager cannot read another artist's addresses", async () => {
      const email = fresh('b-status')
      await list(b.id, 'booking', email)
      expect((await status(asB, b.id)).map((s) => s.email)).toContain(email)

      const { error } = await asA.rpc('email_confirmation_status', { p_artist_id: b.id })

      expectRlsDenied(error, 'email_confirmation_status for another artist')
    })

    // One manager cannot confirm another artist's address, even holding the right code.
    it("CRITICAL: a manager cannot confirm another artist's address, even with the right code", async () => {
      const email = fresh('b-code')
      await list(b.id, 'booking', email)
      const { code } = await send(b.id, email, userB)

      const { error } = await confirmCode(asA, b.id, email, code)

      expectRlsDenied(error, 'confirm_email_code for another artist')
      const r = await row(b.id, email)
      expect(r!.confirmed_at).toBeNull()
      expect(r!.code_attempts).toBe(0)
      // The witness: the code WAS right.
      expect((await confirmCode(asB, b.id, email, code)).verdict).toBe('confirmed')
    })

    // Tapir mails a code only for the artist's own manager, and only to an address on its lists.
    it('CRITICAL: a code is sent only for a manager of the artist, and only to an address on its lists', async () => {
      const email = fresh('who-sends')
      await list(a.id, 'booking', email)

      const notMine = await begin(userB, a.id, email)
      expect(notMine).toMatchObject({ status: 'not_allowed', code: null, token: null })
      expect(await row(a.id, email)).toBeNull()

      const unlisted = fresh('unlisted')
      const nobody = await begin(userA, a.id, unlisted)
      expect(nobody).toMatchObject({ status: 'not_listed', code: null, token: null })
      expect(await row(a.id, unlisted)).toBeNull()

      // The witness: the address was sendable all along, by the right person.
      expect((await begin(userA, a.id, email)).status).toBe('sent')
    })

    // A send returns what the email needs: the artist, the kind labels in order, the site host, the code, the link.
    it('a send hands back what the email needs, and the code and token in plaintext', async () => {
      const { error: e } = await svc
        .from('artists')
        .update({ site_kind: 'custom', custom_site_url: 'https://www.Example-Band.test/tour?x=1' })
        .eq('id', a.id)
      if (e) throw new Error(`custom site: ${e.message}`)
      const email = fresh('shape')
      await list(a.id, 'other', email)
      await list(a.id, 'booking', email.toUpperCase())
      const { data: artist } = await svc.from('artists').select('name').eq('id', a.id).single()

      const r = await begin(userA, a.id, ` ${email.toUpperCase()} `)

      expect(r).toMatchObject({
        status: 'sent',
        artist_name: (artist as { name: string }).name,
        // Labels, in the kinds' own order: booking (0) before other, labelled Contact (2).
        kinds: ['Booking', 'Contact'],
        site_host: 'www.example-band.test',
      })
      expect(r.code).toMatch(/^[0-9]{6}$/)
      expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(await row(a.id, email)).not.toBeNull()
    })
  })

  describe('routing', () => {
    // The rule itself: an address nobody confirmed receives no enquiries; after the code, it does.
    it('CRITICAL: an unconfirmed address receives nothing; confirmed by code, it does', async () => {
      const email = fresh('route')
      await list(a.id, 'booking', email)

      expect(await routed(a.id, 'booking')).not.toContain(email)
      expect(await status(asA, a.id)).toContainEqual({ email, confirmed: false, waiting: true })

      const { code } = await send(a.id, email)
      expect((await confirmCode(asA, a.id, email.toUpperCase(), code)).verdict).toBe('confirmed')

      expect(await routed(a.id, 'booking')).toContain(email)
      expect(await status(asA, a.id)).toContainEqual({ email, confirmed: true, waiting: false })
      const r = await row(a.id, email)
      expect(r).toMatchObject({ code_hash: null, code_expires_at: null, token_hash: null, token_expires_at: null })
    })

    // Ross and skeen@ keep receiving through the 14-day grace, then stop until confirmed.
    it('CRITICAL: a legacy address in grace receives; when the grace ends it stops', async () => {
      const email = fresh('grace')
      await list(a.id, 'demo', email)
      const { error } = await svc
        .from('artist_email_confirmations')
        .insert({ artist_id: a.id, email, grace_until: new Date(Date.now() + 24 * HOUR).toISOString() })
      if (error) throw new Error(error.message)

      expect(await routed(a.id, 'demo')).toContain(email)
      // Still blue with the key: grace is not confirmation.
      expect(await status(asA, a.id)).toContainEqual({ email, confirmed: false, waiting: true })

      await svc.from('artist_email_confirmations').update({ grace_until: ago(MIN) }).eq('artist_id', a.id).eq('email', email)

      expect(await routed(a.id, 'demo')).not.toContain(email)
    })

    // One confirmation covers the address on every list, however it was typed on each.
    it('one confirm covers every list, whatever the case on each', async () => {
      const email = fresh('multi')
      await list(a.id, 'booking', email.toUpperCase())
      await list(a.id, 'other', email)

      const { code } = await send(a.id, email)
      expect((await confirmCode(asA, a.id, email, code)).verdict).toBe('confirmed')

      expect(await routed(a.id, 'booking')).toContain(email)
      expect(await routed(a.id, 'other')).toContain(email)
      expect((await status(asA, a.id)).filter((s) => s.email === email)).toHaveLength(1)
    })

    // The primary (the To: address) is the first confirmed one, so a waiting address never blocks the rest.
    it('the primary is the first CONFIRMED address, not the first added', async () => {
      // submit_enquiry takes the one is_primary row as to_email. Numbered before the filter, a
      // waiting first address would leave the kind with no primary at all, and every enquiry
      // stored unroutable while a confirmed address sat second.
      const slug = `k${randomUUID().slice(0, 8)}`
      const { error } = await svc.from('enquiry_kinds').insert({ artist_id: a.id, slug, label: 'Primary test' })
      if (error) throw new Error(error.message)
      const waiting = fresh('first-added')
      const confirmed = fresh('second-added')
      await list(a.id, slug, waiting, '2026-01-01T00:00:00Z')
      await list(a.id, slug, confirmed, '2026-01-02T00:00:00Z')
      await confirmForRouting(svc, a.id, [confirmed])

      const { data } = await svc.rpc('resolve_enquiry_recipients', { p_artist_id: a.id, p_purpose: slug })

      expect(data).toEqual([{ to_email: confirmed, recipient_source: 'recipient_list', is_primary: true, ordinal: 1 }])
    })

    // Confirming for one artist does not confirm the same address for another.
    it('confirming for one artist confirms nothing for another', async () => {
      const email = fresh('two-artists')
      await list(a.id, 'booking', email)
      await list(b.id, 'booking', email)
      const { code } = await send(a.id, email)
      expect((await confirmCode(asA, a.id, email, code)).verdict).toBe('confirmed')

      expect(await routed(a.id, 'booking')).toContain(email)
      expect(await routed(b.id, 'booking')).not.toContain(email)
      expect(await status(asB, b.id)).toContainEqual({ email, confirmed: false, waiting: true })
    })
  })

  describe('the code', () => {
    // Five wrong tries kill the code, so it cannot be guessed.
    it('CRITICAL: five wrong tries kill it; the right code after that is refused', async () => {
      const email = fresh('wrong')
      await list(a.id, 'booking', email)
      const { code } = await send(a.id, email)

      for (let i = 1; i <= 4; i++) {
        expect((await confirmCode(asA, a.id, email, wrongFor(code))).verdict, `try ${i}`).toBe('wrong')
        expect((await row(a.id, email))!.code_attempts).toBe(i)
      }
      expect((await confirmCode(asA, a.id, email, wrongFor(code))).verdict).toBe('locked')
      expect((await confirmCode(asA, a.id, email, code)).verdict).toBe('locked')

      const r = await row(a.id, email)
      expect(r!.code_attempts).toBe(5)
      expect(r!.confirmed_at).toBeNull()
      expect(await routed(a.id, 'booking')).not.toContain(email)
    })

    // Guesses fired all at once still count one by one.
    it('CRITICAL: wrong guesses fired at once cannot skip the count', async () => {
      // Without the row lock each call reads "0 tries so far" and gets a verdict, so the limit is
      // however many requests fit in one round trip. Over HTTP the calls may also arrive one by
      // one, and then this passes with or without the lock: the bite was shown locally (8 at
      // once, lock removed: 8 'wrong', 1 stored). Kept because a real burst is exactly how it
      // would fail in production.
      const email = fresh('burst')
      await list(a.id, 'booking', email)
      const { code } = await send(a.id, email)

      const verdicts = await Promise.all(
        Array.from({ length: 8 }, () => confirmCode(asA, a.id, email, wrongFor(code)).then((r) => r.verdict)),
      )

      expect((await row(a.id, email))!.code_attempts).toBe(5)
      expect(verdicts.filter((v) => v === 'wrong')).toHaveLength(4)
      expect(verdicts.filter((v) => v === 'locked')).toHaveLength(4)
    })

    // The code lives 15 minutes.
    it('CRITICAL: it lives 15 minutes; after that the right code is refused', async () => {
      const email = fresh('expiry')
      await list(a.id, 'booking', email)
      const { code } = await send(a.id, email)
      const expires = Date.parse((await row(a.id, email))!.code_expires_at!)
      // A minute either way for the clock gap between this machine and the database.
      expect(expires).toBeGreaterThan(Date.now() + 14 * MIN)
      expect(expires).toBeLessThan(Date.now() + 16 * MIN)

      await svc.from('artist_email_confirmations').update({ code_expires_at: ago(1000) }).eq('artist_id', a.id).eq('email', email)

      expect((await confirmCode(asA, a.id, email, code)).verdict).toBe('expired')
      expect((await row(a.id, email))!.confirmed_at).toBeNull()
    })

    // Typing a code that was never sent says expired and creates nothing.
    it('a code never sent is "expired", and creates nothing', async () => {
      const email = fresh('never-sent')
      await list(a.id, 'booking', email)

      expect((await confirmCode(asA, a.id, email, '123456')).verdict).toBe('expired')
      expect(await row(a.id, email)).toBeNull()
    })

    // A new send replaces both the code and the link, so only the latest email works.
    it('a new send replaces the code AND the link, and clears the count', async () => {
      const email = fresh('resend')
      await list(a.id, 'booking', email)
      const first = await send(a.id, email)
      expect((await confirmCode(asA, a.id, email, wrongFor(first.code))).verdict).toBe('wrong')

      await forgetSends(a.id)
      const second = await send(a.id, email)

      expect((await row(a.id, email))!.code_attempts).toBe(0)
      expect((await confirmToken(first.token)).status).toBe('invalid')
      expect((await row(a.id, email))!.confirmed_at).toBeNull()
      expect((await confirmCode(asA, a.id, email, first.code)).verdict).toBe('wrong')
      // The email prints "482 913"; a paste keeps the gap.
      const spaced = `${second.code.slice(0, 3)} ${second.code.slice(3)}`
      expect((await confirmCode(asA, a.id, email, spaced)).verdict).toBe('confirmed')
    })

    // Resend limits: not within 60 s, at most 5 an hour to one address.
    it('not again within 60 s, and at most 5 an hour to one address', async () => {
      const email = fresh('caps')
      await list(a.id, 'booking', email)
      await send(a.id, email)

      expect(await begin(userA, a.id, email)).toMatchObject({ status: 'too_soon', code: null, token: null })
      // A refusal is not a send.
      expect((await row(a.id, email))!.sent_at).toHaveLength(1)

      await setSends(a.id, email, [ago(50 * MIN), ago(40 * MIN), ago(30 * MIN), ago(20 * MIN), ago(10 * MIN)])
      expect(await begin(userA, a.id, email)).toMatchObject({ status: 'too_many', code: null, token: null })

      // Only the last hour counts: one of five is older, so this is the 5th, and the old one is dropped.
      await setSends(a.id, email, [ago(70 * MIN), ago(40 * MIN), ago(30 * MIN), ago(20 * MIN)])
      expect((await begin(userA, a.id, email)).status).toBe('sent')
      expect((await row(a.id, email))!.sent_at).toHaveLength(4)
    })

    // At most 20 sends an hour for one artist, across all its addresses.
    it('at most 20 sends an hour for one artist', async () => {
      const c = await createThrowawayArtist(svc, 'email confirm artist cap', asA)
      try {
        const fill = Array.from({ length: 5 }, (_, i) => ({
          artist_id: c.id,
          email: `filler${i}@example.com`,
          sent_at: [ago(50 * MIN), ago(40 * MIN), ago(30 * MIN), ago(20 * MIN)],
        }))
        const { error } = await svc.from('artist_email_confirmations').insert(fill)
        if (error) throw new Error(error.message)
        const email = fresh('artist-cap')
        await list(c.id, 'booking', email)

        expect((await begin(userA, c.id, email)).status).toBe('too_many')

        await setSends(c.id, 'filler0@example.com', [ago(61 * MIN), ago(40 * MIN), ago(30 * MIN), ago(20 * MIN)])
        expect((await begin(userA, c.id, email)).status).toBe('sent')
      } finally {
        await deleteThrowawayArtist(svc, c)
      }
    })

    // A confirmed address is not sent another code.
    it('an address already confirmed is not sent another code', async () => {
      const email = fresh('done')
      await list(a.id, 'booking', email)
      const { code } = await send(a.id, email)
      expect((await confirmCode(asA, a.id, email, code)).verdict).toBe('confirmed')
      await forgetSends(a.id)

      expect(await begin(userA, a.id, email)).toMatchObject({ status: 'confirmed', code: null, token: null })
      expect((await row(a.id, email))!.sent_at).toHaveLength(0)
    })
  })

  describe('the link', () => {
    // The link confirms once; a used or unknown link answers 'invalid' and names nobody.
    it('CRITICAL: it confirms once, then it is dead; a dead link names nobody', async () => {
      // The page only calls this from its button's POST (link scanners pre-open URLs), and a
      // used, unknown or expired link must not say whose it was.
      const email = fresh('link')
      await list(a.id, 'booking', email)
      const { token } = await send(a.id, email)
      const { data: artist } = await svc.from('artists').select('name').eq('id', a.id).single()
      expect(await routed(a.id, 'booking')).not.toContain(email)

      expect(await confirmToken(token)).toEqual({
        status: 'confirmed',
        email,
        artist_name: (artist as { name: string }).name,
        kinds: ['Booking'],
      })
      expect(await routed(a.id, 'booking')).toContain(email)
      expect(await row(a.id, email)).toMatchObject({ token_hash: null, code_hash: null })

      const dead = { status: 'invalid', email: null, artist_name: null, kinds: null }
      expect(await confirmToken(token)).toEqual(dead)
      expect(await confirmToken(randomUUID())).toEqual(dead)
    })

    // The link lives 7 days.
    it('CRITICAL: it lives 7 days; after that it is refused and confirms nothing', async () => {
      const email = fresh('old-link')
      await list(a.id, 'booking', email)
      const { token } = await send(a.id, email)
      const expires = Date.parse((await row(a.id, email))!.token_expires_at!)
      expect(expires).toBeGreaterThan(Date.now() + 7 * 24 * HOUR - MIN)
      expect(expires).toBeLessThan(Date.now() + 7 * 24 * HOUR + MIN)

      await svc.from('artist_email_confirmations').update({ token_expires_at: ago(1000) }).eq('artist_id', a.id).eq('email', email)

      expect(await confirmToken(token)).toEqual({ status: 'invalid', email: null, artist_name: null, kinds: null })
      expect((await row(a.id, email))!.confirmed_at).toBeNull()
    })
  })

  // Only SHA-256 hashes are kept: a copy of the table holds no working code or link.
  it('CRITICAL: only SHA-256 hashes are stored, never the code or the token', async () => {
    const email = fresh('hashes')
    await list(a.id, 'booking', email)
    const { code, token } = await send(a.id, email)

    const r = (await row(a.id, email))!

    expect(r.code_hash).toBe(sha256(code))
    expect(r.token_hash).toBe(sha256(token))
    expect(r.code_hash).not.toBe(code)
    expect(JSON.stringify(r)).not.toContain(token)
  })
})
