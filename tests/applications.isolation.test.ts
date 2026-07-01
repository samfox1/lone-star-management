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

const MARKER = 'ISO-APPLY' // artist_name tag, so afterAll can clean up
const EMAIL = 'iso-apply@example.test'

let asAdmin: SupabaseClient
let asManager: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asAdmin = await signInAs(SEED.admin)
  asManager = await signInAs(SEED.managerA)
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
    expect(error).not.toBeNull()
  })

  it('rejects an invalid email', async () => {
    const { error } = await anonClient().rpc('submit_application', {
      p_name: 'X',
      p_email: 'not-an-email',
      p_artist_name: MARKER,
    })
    expect(error).not.toBeNull()
  })
})

describe('applications isolation', () => {
  it('CRITICAL: anon cannot read applications', async () => {
    const { data } = await anonClient().from('applications').select('id').eq('artist_name', MARKER)
    expect(data).toEqual([])
  })

  it('CRITICAL: a non-admin manager cannot read applications', async () => {
    const { data } = await asManager.from('applications').select('id').eq('artist_name', MARKER)
    expect(data).toEqual([])
  })

  it('CRITICAL: anon cannot insert directly, bypassing the door', async () => {
    const { error } = await anonClient()
      .from('applications')
      .insert({ name: 'spoof', email: EMAIL, artist_name: MARKER })
      .select()
    expect(error).not.toBeNull()
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
    const { data } = await asAdmin.from('applications').select('id').eq('artist_name', MARKER).limit(1)
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

  it('rejects an out-of-enum status (CHECK constraint)', async () => {
    const id = await markerId()
    const { error } = await asAdmin.from('applications').update({ status: 'bogus' }).eq('id', id)
    expect(error).not.toBeNull()
  })
})
