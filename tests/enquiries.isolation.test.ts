/**
 * ENQUIRIES — security boundary.
 *
 * Contact enquiries carry two things worth protecting: the artist's booking address
 * (resolved server-side, and the reason this feature exists at all — see
 * 20260722120000) and the visitor's message. The threat model has three shapes:
 *
 *  1. An anon caller holding the PUBLIC anon key calls submit_enquiry directly over
 *     PostgREST. If that worked it would (a) hand back the resolved booking address
 *     for any slug, turning the door into an address-harvesting endpoint, and (b) let
 *     the caller pass their own p_ip_hash, which is the rate limiter's entire basis.
 *     This is THE test — if only one of these ever runs, it should be this one.
 *  2. Manager B reads manager A's inbox.
 *  3. A manager mutates their own inbox beyond marking it read. RLS has no column
 *     granularity, so this is enforced by a column GRANT, not a policy, and column
 *     grants are exactly the kind of thing a later migration silently undoes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'
import { expectDeniedByMissingPolicy, expectExecuteDenied, expectRlsDenied } from './helpers/rls'

const svc = serviceClient()

let artistA: string
let artistB: string
let asA: SupabaseClient
let asB: SupabaseClient

// Rows we plant directly (service role) so "anon reads nothing" is real evidence and
// not a vacuous pass over empty tables.
const MARKER = 'ISOLATION probe message'
const PROBE_IP = 'isolation-probe-ip-hash'
const BOOKING_ADDRESS = 'isolation-booking-a@example.test'
let enquiryA: string
let seededMailSettings = false
let seededArtistMailSettings = false

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)

  const { data, error } = await svc
    .from('enquiries')
    .insert({
      artist_id: artistA,
      purpose: 'booking',
      name: 'Isolation Probe',
      email: 'probe@example.com',
      message: MARKER,
      to_email: 'booking-a@example.com',
      recipient_source: 'default',
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('enquiry insert failed')
  enquiryA = data.id

  // Plant a row in each of the other three tables too, so the "anon selects nothing"
  // assertions below are proving RLS rather than an empty table.
  await svc.from('contact_attempts').insert({
    slug: SEED.artistASlug,
    artist_id: artistA,
    purpose: 'booking',
    ip_hash: PROBE_IP,
    outcome: 'accepted',
  })
  // Only create the per-artist mail row if there isn't one — teardown deletes what we
  // made, and blowing away a real booking-address override would be a live-data loss.
  const { data: existingAms } = await svc
    .from('artist_mail_settings')
    .select('artist_id')
    .eq('artist_id', artistA)
    .maybeSingle()
  if (!existingAms) {
    await svc
      .from('artist_mail_settings')
      .insert({ artist_id: artistA, from_name: 'Isolation Probe', booking_email: BOOKING_ADDRESS })
    seededArtistMailSettings = true
  }
  const { data: ms } = await svc.from('mail_settings').select('id').maybeSingle()
  if (!ms) {
    await svc.from('mail_settings').insert({
      default_to_email: 'isolation-probe@example.com',
      sending_domain: 'mail.example.com',
    })
    seededMailSettings = true
  }
})

afterAll(async () => {
  await svc.from('enquiries').delete().eq('id', enquiryA)
  await svc.from('contact_attempts').delete().eq('ip_hash', PROBE_IP)
  if (seededArtistMailSettings) {
    await svc.from('artist_mail_settings').delete().eq('artist_id', artistA)
  }
  if (seededMailSettings) await svc.from('mail_settings').delete().eq('id', true)
})

describe('enquiries — the anon caller cannot reach the door', () => {
  // Every assertion in this block pins SQLSTATE 42501 ("permission denied for function
  // <name>") rather than merely "an error came back". PostgREST returns a non-null error
  // for any signature it cannot resolve — rename one parameter and you get PGRST202,
  // "Could not find the function public.submit_enquiry in the schema cache". A bare
  // not-null check stays green through that, so the day someone renames a param AND
  // grants EXECUTE to anon, the door is gone and nothing here fails.

  it('anon cannot call submit_enquiry (it is service_role-only, not an anon door)', async () => {
    const { data, error } = await anonClient().rpc('submit_enquiry', {
      p_slug: SEED.artistASlug,
      p_purpose: 'booking',
      p_name: 'Attacker',
      p_email: 'attacker@example.com',
      p_message: 'harvesting booking addresses',
      p_ip_hash: 'forged-ip-hash-0000',
    })
    expectExecuteDenied(error, 'submit_enquiry')
    // Belt and braces: even if the call somehow returned, it must carry no address.
    expect(data ?? []).toEqual([])
  })

  it('an authenticated manager also cannot call submit_enquiry', async () => {
    const { error } = await asA.rpc('submit_enquiry', {
      p_slug: SEED.artistASlug,
      p_purpose: 'booking',
      p_name: 'Manager',
      p_email: 'manager@example.com',
      p_message: 'still not allowed',
      p_ip_hash: 'forged-ip-hash-0001',
    })
    expectExecuteDenied(error, 'submit_enquiry')
  })

  it('anon cannot call the internal resolver or the ledger writer', async () => {
    const anon = anonClient()
    expectExecuteDenied(
      (await anon.rpc('resolve_booking_recipient', { p_artist_id: artistA })).error,
      'resolve_booking_recipient',
    )
    expectExecuteDenied(
      (
        await anon.rpc('log_contact_attempt', {
          p_slug: SEED.artistASlug,
          p_purpose: 'booking',
          p_ip_hash: 'forged',
          p_outcome: 'accepted',
        })
      ).error,
      'log_contact_attempt',
    )
  })

  it('anon cannot select any of the four new tables', async () => {
    const anon = anonClient()
    for (const table of ['enquiries', 'contact_attempts', 'mail_settings', 'artist_mail_settings']) {
      const { data, error } = await anon.from(table).select('*').limit(1)
      // Either a hard RLS/permission error, or an empty set — never a row.
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    }
  })

  it('CRITICAL: anon cannot INSERT an enquiry — there is deliberately no policy', async () => {
    // The one thing standing between a bot and every manager's inbox is the ABSENCE of
    // an INSERT policy. anon still holds the stock column-level INSERT grant on this
    // table (nobody revoked it), so adding any innocuous-looking `enquiries_insert`
    // policy in a later migration instantly makes forged enquiries writable at scale —
    // with a plausible reply-to address on somebody else's artist. Pin the omission: the
    // refusal must come from RLS, not from a grant that might be re-widened.
    const { error } = await anonClient()
      .from('enquiries')
      .insert({
        artist_id: artistA,
        purpose: 'booking',
        name: 'Forged Bot',
        email: 'bot@example.test',
        message: 'FORGED enquiry',
        to_email: 'attacker@evil.example',
        recipient_source: 'default',
      })
      .select()
    expectDeniedByMissingPolicy(error, 'anon inserting an enquiry')

    const { data } = await svc.from('enquiries').select('id').eq('message', 'FORGED enquiry')
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: a manager cannot INSERT an enquiry into their own inbox either", async () => {
    // Same omission, other side: the Edge Function (service role) is the sole writer, so
    // even the owner may not fabricate an enquiry — otherwise anything holding a
    // manager's token could manufacture booking history.
    const { error } = await asA
      .from('enquiries')
      .insert({
        artist_id: artistA,
        purpose: 'booking',
        name: 'Self Forged',
        email: 'self@example.test',
        message: 'SELF FORGED enquiry',
        to_email: 'self@example.test',
        recipient_source: 'default',
      })
      .select()
    expectDeniedByMissingPolicy(error, 'a manager inserting an enquiry')
  })
})

describe('enquiries — cross-tenant reads', () => {
  it("manager B cannot read manager A's enquiries", async () => {
    const { data } = await asB.from('enquiries').select('id, message').eq('artist_id', artistA)
    expect(data ?? []).toEqual([])
  })

  it('manager A can read their own', async () => {
    const { data } = await asA.from('enquiries').select('id, message').eq('id', enquiryA)
    expect(data?.[0]?.message).toBe(MARKER)
  })

  it('a manager cannot read the abuse ledger at all', async () => {
    const { data } = await asA.from('contact_attempts').select('*').limit(1)
    expect(data ?? []).toEqual([])
  })
})

describe('contact_attempts — the rate limiter owns its own ledger', () => {
  // The read denial was covered; the WRITE side was not. The limiter counts rows in this
  // table, so anyone who can insert into it can pre-burn an IP's slots (locking a real
  // visitor out) or, with a helpful `delete`, erase their own flood and reset the cap.
  // Only the service role writes here, via log_contact_attempt.

  it('CRITICAL: a manager cannot INSERT into the ledger', async () => {
    const { error } = await asA
      .from('contact_attempts')
      .insert({
        slug: SEED.artistASlug,
        artist_id: artistA,
        purpose: 'booking',
        ip_hash: 'forged-ledger-hash',
        outcome: 'accepted',
      })
      .select()
    expectDeniedByMissingPolicy(error, 'a manager inserting a contact attempt')
  })

  it('CRITICAL: anon cannot INSERT into the ledger', async () => {
    const { error } = await anonClient()
      .from('contact_attempts')
      .insert({ slug: SEED.artistASlug, ip_hash: 'forged-ledger-hash', outcome: 'accepted' })
      .select()
    expectDeniedByMissingPolicy(error, 'anon inserting a contact attempt')

    const { data } = await svc.from('contact_attempts').select('id').eq('ip_hash', 'forged-ledger-hash')
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: a manager cannot erase ledger rows (silent no-op, so check state)', async () => {
    // No DELETE policy → RLS scopes every row out of the statement and PostgREST reports
    // success over zero rows. The proof is that the planted row is still there.
    await asA.from('contact_attempts').delete().eq('ip_hash', PROBE_IP)
    const { data } = await svc.from('contact_attempts').select('id').eq('ip_hash', PROBE_IP)
    expect(data ?? []).toHaveLength(1)
  })
})

describe('artist_mail_settings — the resolved booking address', () => {
  // ams_read is what stops one manager reading another artist's booking address, and the
  // address IS the feature. Only the anon case had a test; the manager-to-manager case,
  // which is the realistic threat, had none.

  it('the booking address fixture is really there (service role)', async () => {
    const { data } = await svc
      .from('artist_mail_settings')
      .select('artist_id')
      .eq('artist_id', artistA)
    expect(data ?? []).toHaveLength(1)
  })

  it("A's own manager can read their resolved booking config", async () => {
    const { data } = await asA
      .from('artist_mail_settings')
      .select('artist_id')
      .eq('artist_id', artistA)
    expect(data ?? []).toHaveLength(1)
  })

  it("CRITICAL: manager B cannot read A's booking address", async () => {
    const { data } = await asB
      .from('artist_mail_settings')
      .select('artist_id, booking_email, sending_domain')
      .eq('artist_id', artistA)
    expect(data ?? []).toEqual([])
  })

  it('CRITICAL: a manager cannot WRITE their own mail config (ops-only, silent no-op)', async () => {
    // ams_admin_write is admin-only on purpose: a manager who could set `sending_domain`
    // could point sends at a domain Resend has not verified and break delivery silently.
    // The UPDATE is row-filtered rather than rejected, so assert the stored value.
    const { data: before } = await svc
      .from('artist_mail_settings')
      .select('booking_email, sending_domain')
      .eq('artist_id', artistA)
      .single()

    await asA
      .from('artist_mail_settings')
      .update({ booking_email: 'hijacked@evil.example', sending_domain: 'evil.example' })
      .eq('artist_id', artistA)

    const { data: after } = await svc
      .from('artist_mail_settings')
      .select('booking_email, sending_domain')
      .eq('artist_id', artistA)
      .single()
    expect(after).toEqual(before)
  })

  it("CRITICAL: a manager cannot create mail config for another tenant", async () => {
    const { error } = await asA
      .from('artist_mail_settings')
      .insert({ artist_id: artistB, booking_email: 'redirect@evil.example' })
      .select()
    expectRlsDenied(error, "a manager inserting another tenant's mail settings")
  })
})

describe('enquiries — a manager may mark read, and nothing else', () => {
  it('can set read_at on their own enquiry', async () => {
    const { error } = await asA
      .from('enquiries')
      .update({ read_at: new Date().toISOString() })
      .eq('id', enquiryA)
    expect(error).toBeNull()

    const { data } = await svc.from('enquiries').select('read_at').eq('id', enquiryA).single()
    expect(data?.read_at).not.toBeNull()
  })

  it('cannot rewrite the message (column grant, not just policy)', async () => {
    const { error } = await asA
      .from('enquiries')
      .update({ message: 'tampered' })
      .eq('id', enquiryA)
    expectRlsDenied(error, 'a manager rewriting an enquiry message')

    const { data } = await svc.from('enquiries').select('message').eq('id', enquiryA).single()
    expect(data?.message).toBe(MARKER)
  })

  it('cannot rewrite the resolved recipient or the delivery status', async () => {
    expectRlsDenied(
      (await asA.from('enquiries').update({ to_email: 'attacker@evil.example' }).eq('id', enquiryA))
        .error,
      'a manager rewriting to_email',
    )
    expectRlsDenied(
      (await asA.from('enquiries').update({ status: 'sent' }).eq('id', enquiryA)).error,
      'a manager rewriting status',
    )

    const { data } = await svc.from('enquiries').select('to_email, status').eq('id', enquiryA).single()
    expect(data).toMatchObject({ to_email: 'booking-a@example.com', status: 'queued' })
  })

  it("cannot mark another tenant's enquiry read", async () => {
    // Reset first, so "still null" afterwards is real evidence and not a leftover.
    await svc.from('enquiries').update({ read_at: null }).eq('id', enquiryA)

    await asB.from('enquiries').update({ read_at: new Date().toISOString() }).eq('id', enquiryA)

    // RLS scopes the row out of B's UPDATE entirely, so PostgREST reports no error —
    // it matched zero rows. The proof is that the value did not move.
    const { data } = await svc.from('enquiries').select('read_at').eq('id', enquiryA).single()
    expect(data?.read_at).toBeNull()
  })
})

describe('booking_recipient_preview — owner-only', () => {
  it('a manager sees their own resolved recipient', async () => {
    const { data, error } = await asA.rpc('booking_recipient_preview', { p_artist_id: artistA })
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it("a non-owner gets nothing back for someone else's artist", async () => {
    const { data, error } = await asB.rpc('booking_recipient_preview', { p_artist_id: artistA })
    expect(error).toBeNull() // silent, not an error — nothing to probe
    expect(data ?? []).toEqual([])
  })

  it('anon gets nothing back', async () => {
    const { data } = await anonClient().rpc('booking_recipient_preview', { p_artist_id: artistA })
    expect(data ?? []).toEqual([])
  })
})
