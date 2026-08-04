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

const svc = serviceClient()

let artistA: string
let asA: SupabaseClient
let asB: SupabaseClient

// Rows we plant directly (service role) so "anon reads nothing" is real evidence and
// not a vacuous pass over empty tables.
const MARKER = 'ISOLATION probe message'
const PROBE_IP = 'isolation-probe-ip-hash'
let enquiryA: string
let seededMailSettings = false

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
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
  await svc.from('artist_mail_settings').insert({ artist_id: artistA, from_name: 'Isolation Probe' })
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
  await svc.from('artist_mail_settings').delete().eq('artist_id', artistA)
  if (seededMailSettings) await svc.from('mail_settings').delete().eq('id', true)
})

describe('enquiries — the anon caller cannot reach the door', () => {
  it('anon cannot call submit_enquiry (it is service_role-only, not an anon door)', async () => {
    const { data, error } = await anonClient().rpc('submit_enquiry', {
      p_slug: SEED.artistASlug,
      p_purpose: 'booking',
      p_name: 'Attacker',
      p_email: 'attacker@example.com',
      p_message: 'harvesting booking addresses',
      p_ip_hash: 'forged-ip-hash-0000',
    })
    expect(error).not.toBeNull()
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
    expect(error).not.toBeNull()
  })

  it('anon cannot call the internal resolver or the ledger writer', async () => {
    const anon = anonClient()
    expect((await anon.rpc('resolve_booking_recipient', { p_artist_id: artistA })).error).not.toBeNull()
    expect(
      (
        await anon.rpc('log_contact_attempt', {
          p_slug: SEED.artistASlug,
          p_purpose: 'booking',
          p_ip_hash: 'forged',
          p_outcome: 'accepted',
        })
      ).error,
    ).not.toBeNull()
  })

  it('anon cannot select any of the four new tables', async () => {
    const anon = anonClient()
    for (const table of ['enquiries', 'contact_attempts', 'mail_settings', 'artist_mail_settings']) {
      const { data, error } = await anon.from(table).select('*').limit(1)
      // Either a hard RLS/permission error, or an empty set — never a row.
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    }
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
    expect(error).not.toBeNull()

    const { data } = await svc.from('enquiries').select('message').eq('id', enquiryA).single()
    expect(data?.message).toBe(MARKER)
  })

  it('cannot rewrite the resolved recipient or the delivery status', async () => {
    expect(
      (await asA.from('enquiries').update({ to_email: 'attacker@evil.example' }).eq('id', enquiryA))
        .error,
    ).not.toBeNull()
    expect(
      (await asA.from('enquiries').update({ status: 'sent' }).eq('id', enquiryA)).error,
    ).not.toBeNull()

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
