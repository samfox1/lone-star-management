/**
 * Security for the public "apply for access" flow. `applications` holds anonymous
 * lead submissions (name/email/notes), so — like analytics_events — the ONLY
 * write path is the SECURITY DEFINER door `submit_application`, there is no anon
 * insert/select policy, and only admins can read. Verified against the real DB;
 * RLS can't be mocked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, serviceClient, signInAs } from './helpers/supabase'
import { expectDeniedByMissingPolicy, expectRlsDenied } from './helpers/rls'

const MARKER = 'ISO-APPLY' // artist_name tag, so afterAll can clean up
const EMAIL = 'iso-apply@example.test'

let asAdmin: SupabaseClient
let asManager: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asAdmin = await signInAs(SEED.admin)
  asManager = await signInAs(SEED.managerA)

  // Plant the marker row with the SERVICE client, not through the door.
  //
  // Every denial below filters on artist_name = MARKER. If the only MARKER row came
  // from the `submit_application` test in the describe block above, then skipping,
  // reordering or breaking that test would silently turn "anon reads nothing" into a
  // query over an empty table — a pass that proves nothing. The door keeps its own
  // behavioural test; the denials get their own fixture.
  const { data, error } = await svc
    .from('applications')
    .insert({ name: 'Isolation Probe', email: EMAIL, artist_name: MARKER })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('applications fixture insert failed')
})

afterAll(async () => {
  await svc.from('applications').delete().eq('artist_name', MARKER)
})

describe('submit_application (public door)', () => {
  it('anon can submit an application through the door', async () => {
    const { error } = await anonClient().rpc('submit_application', {
      p_name: 'Test Manager',
      p_email: EMAIL,
      p_artist_name: MARKER,
      p_link: 'https://example.com',
      p_notes: 'hello',
    })
    expect(error).toBeNull()
  })

  it('rejects an empty name', async () => {
    const { error } = await anonClient().rpc('submit_application', {
      p_name: '  ',
      p_email: EMAIL,
      p_artist_name: MARKER,
    })
    // P0001 (the function's own RAISE), never bare not-null: a bare check passes on
    // PGRST202 "function does not exist" — i.e. it would stay green with the door gone.
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('Name and email')
  })

  it('rejects an invalid email', async () => {
    const { error } = await anonClient().rpc('submit_application', {
      p_name: 'X',
      p_email: 'not-an-email',
      p_artist_name: MARKER,
    })
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('valid email')
  })
})

describe('applications isolation', () => {
  // Guard rail for the three denials below: if the fixture is gone they are all
  // reading an empty table and cannot fail.
  it('the marker fixture really is in the table (service role)', async () => {
    const { data } = await svc.from('applications').select('id').eq('artist_name', MARKER)
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('CRITICAL: anon cannot read applications', async () => {
    const { data } = await anonClient().from('applications').select('id').eq('artist_name', MARKER)
    expect(data).toEqual([])
  })

  it('CRITICAL: a non-admin manager cannot read applications', async () => {
    const { data } = await asManager.from('applications').select('id').eq('artist_name', MARKER)
    expect(data).toEqual([])
  })

  it('CRITICAL: anon cannot insert directly, bypassing the door', async () => {
    // No anon INSERT policy exists, and anon still holds the stock table-level grant —
    // the missing policy is the only thing between a bot and this table.
    const { error } = await anonClient()
      .from('applications')
      .insert({ name: 'spoof', email: EMAIL, artist_name: MARKER })
      .select()
    expectDeniedByMissingPolicy(error, 'anon inserting an application')
  })

  it('CRITICAL: a non-admin manager cannot insert either', async () => {
    const { error } = await asManager
      .from('applications')
      .insert({ name: 'spoof', email: EMAIL, artist_name: MARKER })
      .select()
    expectRlsDenied(error, 'a manager inserting an application')
  })

  it('admin can read submitted applications', async () => {
    const { data } = await asAdmin
      .from('applications')
      .select('id, email')
      .eq('artist_name', MARKER)
    expect((data ?? []).length).toBeGreaterThan(0)
    expect(data![0].email).toBe(EMAIL)
  })
})

describe('applications status updates (admin inbox)', () => {
  async function markerId(): Promise<string> {
    // Ordered, so every test in this block operates on the SAME row regardless of how
    // many MARKER rows the door test added.
    const { data } = await asAdmin
      .from('applications')
      .select('id')
      .eq('artist_name', MARKER)
      .order('created_at', { ascending: true })
      .limit(1)
    const id = data?.[0]?.id
    expect(id).toBeTruthy()
    return id as string
  }

  it('admin can move an application through its status', async () => {
    const id = await markerId()
    const { error } = await asAdmin.from('applications').update({ status: 'contacted' }).eq('id', id)
    expect(error).toBeNull()
    const { data } = await asAdmin.from('applications').select('status').eq('id', id).single()
    expect(data?.status).toBe('contacted')
  })

  it('CRITICAL: a non-admin manager cannot update an application', async () => {
    const id = await markerId()
    const { data } = await asManager
      .from('applications')
      .update({ status: 'approved' })
      .eq('id', id)
      .select()
    expect(data).toEqual([]) // RLS: the row isn't visible/updatable to a manager
    const { data: after } = await asAdmin.from('applications').select('status').eq('id', id).single()
    expect(after?.status).not.toBe('approved')
  })

  it('rejects an out-of-enum status (CHECK constraint, exercised as admin)', async () => {
    // Admin, deliberately: a manager's update is filtered out by RLS before the CHECK is
    // ever evaluated, so a manager-side version of this test would measure 42501 and
    // never touch the constraint it names.
    const id = await markerId()
    const { error } = await asAdmin.from('applications').update({ status: 'bogus' }).eq('id', id)
    expect(error?.code).toBe('23514')
  })
})
