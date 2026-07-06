/**
 * Security for the public email-list signup. `subscribers` holds anonymous fan
 * emails keyed to one artist, so — like analytics_events — the ONLY write path
 * is the SECURITY DEFINER door `subscribe`, there is no anon insert/select
 * policy, and reads are scoped to the artist's managers (+ admins). Verified
 * against the real DB; RLS can't be mocked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

const EMAIL = 'iso-sub@example.test' // unique enough to find + clean up

let asAdmin: SupabaseClient
let asManagerA: SupabaseClient
let asManagerB: SupabaseClient
let artistAId: string
const svc = serviceClient()

beforeAll(async () => {
  asAdmin = await signInAs(SEED.admin)
  asManagerA = await signInAs(SEED.managerA)
  asManagerB = await signInAs(SEED.managerB)
  artistAId = await artistIdBySlug(SEED.artistASlug)
})

afterAll(async () => {
  await svc.from('subscribers').delete().eq('email', EMAIL)
})

describe('subscribe (public door)', () => {
  it('anon can subscribe through the door', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: SEED.artistASlug,
      p_email: EMAIL,
    })
    expect(error).toBeNull()
  })

  it('re-subscribing the same email is a silent no-op (dedup)', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: SEED.artistASlug,
      p_email: EMAIL,
    })
    expect(error).toBeNull()
    const { data } = await svc.from('subscribers').select('id').eq('email', EMAIL)
    expect((data ?? []).length).toBe(1)
  })

  it('rejects an invalid email', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: SEED.artistASlug,
      p_email: 'not-an-email',
    })
    expect(error).not.toBeNull()
  })

  it('rejects an unknown artist slug', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: 'no-such-artist',
      p_email: EMAIL,
    })
    expect(error).not.toBeNull()
  })
})

describe('subscribers isolation', () => {
  it('CRITICAL: anon cannot read subscribers', async () => {
    const { data } = await anonClient().from('subscribers').select('id').eq('email', EMAIL)
    expect(data).toEqual([])
  })

  it('CRITICAL: anon cannot insert directly, bypassing the door', async () => {
    const { error } = await anonClient()
      .from('subscribers')
      .insert({ artist_id: artistAId, email: EMAIL })
      .select()
    expect(error).not.toBeNull()
  })

  it("CRITICAL: a manager of another artist cannot read this artist's list", async () => {
    const { data } = await asManagerB.from('subscribers').select('id').eq('email', EMAIL)
    expect(data).toEqual([])
  })

  it('the artist\'s own manager can read their subscribers', async () => {
    const { data } = await asManagerA
      .from('subscribers')
      .select('id, email')
      .eq('email', EMAIL)
    expect((data ?? []).length).toBeGreaterThan(0)
    expect(data![0].email).toBe(EMAIL)
  })

  it('admin can read submitted subscribers', async () => {
    const { data } = await asAdmin.from('subscribers').select('id, email').eq('email', EMAIL)
    expect((data ?? []).length).toBeGreaterThan(0)
    expect(data![0].email).toBe(EMAIL)
  })
})
