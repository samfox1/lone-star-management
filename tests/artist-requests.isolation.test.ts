/**
 * Tenant isolation for the artist-request queue.
 *
 * `artist_requests` holds lead/contact intake (name, email, notes), so the same
 * deny-by-default RLS that protects tenants must protect it: a manager sees and
 * files only their OWN requests, cannot spoof `requested_by`, and cannot drive
 * the staff build workflow (status transitions are admin-only). Verified against
 * the real database — RLS can't be mocked.
 *
 * Requires the hardening migration (status-pinned insert, status CHECK).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, serviceClient, signInAs } from './helpers/supabase'

let uidA: string // manager A's auth id
let uidB: string // manager B's auth id
let reqA: string // a fixture request owned by A
let reqB: string // a fixture request owned by B
const createdByTest: string[] = [] // rows tests create, cleaned up in afterAll

let asA: SupabaseClient
let asB: SupabaseClient
let asAdmin: SupabaseClient
const svc = serviceClient()

async function uidOf(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('no authenticated user')
  return user.id
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  asAdmin = await signInAs(SEED.admin)
  uidA = await uidOf(asA)
  uidB = await uidOf(asB)

  // One request per manager, created via service role (bypasses RLS).
  const { data, error } = await svc
    .from('artist_requests')
    .insert([
      { requested_by: uidA, name: 'ISO-REQ A' },
      { requested_by: uidB, name: 'ISO-REQ B' },
    ])
    .select('id, requested_by')
  if (error) throw error
  reqA = data!.find((r) => r.requested_by === uidA)!.id
  reqB = data!.find((r) => r.requested_by === uidB)!.id
})

afterAll(async () => {
  await svc.from('artist_requests').delete().in('id', [reqA, reqB, ...createdByTest])
})

describe('artist_requests isolation', () => {
  it("manager A reads back A's own request", async () => {
    const { data } = await asA.from('artist_requests').select('id').eq('id', reqA)
    expect(data).toHaveLength(1)
  })

  it("CRITICAL: manager A cannot read B's request", async () => {
    const { data } = await asA.from('artist_requests').select('id').eq('id', reqB)
    expect(data).toEqual([])
  })

  it('manager A listing requests sees only their own', async () => {
    const { data } = await asA.from('artist_requests').select('id')
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(reqA)
    expect(ids).not.toContain(reqB)
  })

  it('CRITICAL: manager A cannot file a request as manager B (requested_by spoof)', async () => {
    const { error } = await asA
      .from('artist_requests')
      .insert({ requested_by: uidB, name: 'spoof' })
      .select()
    expect(error).not.toBeNull()
  })

  it('manager A can file their own request', async () => {
    const { data, error } = await asA
      .from('artist_requests')
      .insert({ requested_by: uidA, name: 'ISO-REQ A self' })
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    createdByTest.push(data![0].id)
  })

  it('CRITICAL: manager cannot self-insert at status=live (skips the build gate)', async () => {
    const { error } = await asA
      .from('artist_requests')
      .insert({ requested_by: uidA, name: 'ISO-REQ A live', status: 'live' })
      .select()
    expect(error).not.toBeNull()
  })

  it('rejects an out-of-enum status (CHECK constraint)', async () => {
    const { error } = await asA
      .from('artist_requests')
      .insert({ requested_by: uidA, name: 'ISO-REQ A bogus', status: 'bogus' })
      .select()
    expect(error).not.toBeNull()
  })

  it("CRITICAL: manager A cannot advance their own request's status", async () => {
    const { data } = await asA
      .from('artist_requests')
      .update({ status: 'live' })
      .eq('id', reqA)
      .select()
    // No manager UPDATE policy → the update matches nothing.
    expect(data).toEqual([])

    const { data: after } = await svc
      .from('artist_requests')
      .select('status')
      .eq('id', reqA)
      .single()
    expect(after!.status).toBe('requested')
  })

  it("admin reads every manager's requests", async () => {
    const { data } = await asAdmin
      .from('artist_requests')
      .select('id')
      .in('id', [reqA, reqB])
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(reqA)
    expect(ids).toContain(reqB)
  })
})

describe('unauthenticated access to artist_requests', () => {
  it('CRITICAL: anon cannot read the request queue', async () => {
    const { data } = await anonClient()
      .from('artist_requests')
      .select('id')
      .in('id', [reqA, reqB])
    expect(data).toEqual([])
  })

  it('CRITICAL: anon cannot file a request', async () => {
    const { error } = await anonClient()
      .from('artist_requests')
      .insert({ requested_by: uidA, name: 'anon' })
      .select()
    expect(error).not.toBeNull()
  })
})
