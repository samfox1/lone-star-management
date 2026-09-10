/**
 * MILESTONE 2 GATE — tenant isolation.
 *
 * The single most important property of this product: a manager can NEVER read
 * or write a tenant they are not assigned to. This is enforced in Postgres with
 * RLS (see the migration), and verified here against the real database.
 *
 * Seed layout (scripts/seed.ts):
 *   manager A  -> Lone Pine  (lone-pine)
 *   manager B  -> Gulf Static (gulf-static)
 *   admin      -> all tenants
 *
 * Items marked CRITICAL are the cross-tenant denials that gate the milestone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SEED,
  anonClient,
  artistIdBySlug,
  serviceClient,
  signInAs,
} from '@tests/helpers/supabase'
import { expectRlsDenied } from '@tests/helpers/rls'

let artistA: string // Lone Pine, managed by A
let artistB: string // Gulf Static, managed by B
let trackA: string // a fixture track on artist A
let trackB: string // a fixture track on artist B
let uidA: string // manager A's auth id
let uidB: string // manager B's auth id

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
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)

  // Fixtures: one track per tenant, created via service role (bypasses RLS).
  const { data, error } = await svc
    .from('tracks')
    .insert([
      { artist_id: artistA, title: 'ISO-FIXTURE A' },
      { artist_id: artistB, title: 'ISO-FIXTURE B' },
    ])
    .select('id, artist_id')
  if (error) throw error
  trackA = data!.find((t) => t.artist_id === artistA)!.id
  trackB = data!.find((t) => t.artist_id === artistB)!.id

  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  asAdmin = await signInAs(SEED.admin)
  uidA = await uidOf(asA)
  uidB = await uidOf(asB)
})

afterAll(async () => {
  // Remove fixtures regardless of test outcome.
  await svc.from('tracks').delete().in('id', [trackA, trackB])
})

describe('artists table isolation', () => {
  it("manager A reads A's own artist", async () => {
    const { data } = await asA.from('artists').select('id').eq('id', artistA)
    expect(data).toHaveLength(1)
  })

  it('CRITICAL: manager A cannot read B\'s artist', async () => {
    const { data } = await asA.from('artists').select('id').eq('id', artistB)
    expect(data).toEqual([])
  })

  it('manager A listing artists sees only their own tenant', async () => {
    const { data } = await asA.from('artists').select('id')
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(artistA)
    expect(ids).not.toContain(artistB)
  })

  it('admin reads every tenant', async () => {
    const { data } = await asAdmin.from('artists').select('id')
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(artistA)
    expect(ids).toContain(artistB)
  })
})

describe('content (tracks) isolation', () => {
  it("manager A reads A's tracks", async () => {
    const { data } = await asA.from('tracks').select('id').eq('artist_id', artistA)
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(trackA)
  })

  it("CRITICAL: manager A cannot read B's tracks", async () => {
    const { data } = await asA.from('tracks').select('id').eq('artist_id', artistB)
    expect(data).toEqual([])
  })

  it("CRITICAL: manager A cannot INSERT a track into B's tenant", async () => {
    const { error } = await asA
      .from('tracks')
      .insert({ artist_id: artistB, title: 'should-be-blocked' })
      .select()
    expectRlsDenied(error, "a cross-tenant track insert")
  })

  it("CRITICAL: manager A cannot UPDATE B's track", async () => {
    const { data } = await asA
      .from('tracks')
      .update({ title: 'hacked' })
      .eq('id', trackB)
      .select()
    // RLS hides the row entirely, so the update matches nothing.
    expect(data).toEqual([])

    // And confirm it really didn't change.
    const { data: after } = await svc
      .from('tracks')
      .select('title')
      .eq('id', trackB)
      .single()
    expect(after!.title).toBe('ISO-FIXTURE B')
  })

  it("CRITICAL: manager A cannot DELETE B's track", async () => {
    const { data } = await asA.from('tracks').delete().eq('id', trackB).select()
    expect(data).toEqual([])

    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('id', trackB)
    expect(count).toBe(1) // still there
  })

  it('admin can read both tenants\' tracks', async () => {
    const { data } = await asAdmin
      .from('tracks')
      .select('id')
      .in('id', [trackA, trackB])
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(trackA)
    expect(ids).toContain(trackB)
  })
})

describe('unauthenticated access', () => {
  it('CRITICAL: anon cannot read any tracks', async () => {
    const { data } = await anonClient()
      .from('tracks')
      .select('id')
      .in('id', [trackA, trackB])
    expect(data).toEqual([])
  })

  it('CRITICAL: anon cannot read any artists', async () => {
    const { data } = await anonClient().from('artists').select('id')
    expect(data).toEqual([])
  })

  it('CRITICAL: anon cannot insert content', async () => {
    const { error } = await anonClient()
      .from('tracks')
      .insert({ artist_id: artistA, title: 'anon-write' })
      .select()
    expectRlsDenied(error, 'an anon content insert')
  })
})

/**
 * `artist_managers` is the table `is_manager_of()` reads. Every other policy in this
 * schema resolves tenancy through it, so a write regression here is not "a leak" — it is
 * an instant, total cross-tenant takeover: insert one row and every other policy in the
 * database starts agreeing that you own that artist. Until now it had ZERO test coverage
 * anywhere in the suite.
 */
describe('artist_managers — the root of tenancy', () => {
  it('a manager sees only their OWN membership rows', async () => {
    const { data } = await asA.from('artist_managers').select('user_id, artist_id')
    expect((data ?? []).length).toBeGreaterThan(0) // they manage something, or this is vacuous
    expect((data ?? []).every((r) => r.user_id === uidA)).toBe(true)
  })

  it("CRITICAL: A cannot grant themselves B's tenant", async () => {
    const { error } = await asA
      .from('artist_managers')
      .insert({ user_id: uidA, artist_id: artistB })
      .select()
    expectRlsDenied(error, "A inserting a membership for B's artist")

    const { data } = await svc
      .from('artist_managers')
      .select('user_id')
      .eq('user_id', uidA)
      .eq('artist_id', artistB)
    expect(data ?? [], 'a manager wrote themselves into another tenant').toHaveLength(0)
  })

  it('CRITICAL: A cannot hand their own artist to another user', async () => {
    const { error } = await asA
      .from('artist_managers')
      .insert({ user_id: uidB, artist_id: artistA })
      .select()
    expectRlsDenied(error, 'A granting their artist to another user')
  })

  it('CRITICAL: A cannot REPOINT their membership at another tenant (silent no-op)', async () => {
    // Writes are admin-only, so RLS filters the row out of the UPDATE and PostgREST
    // reports success over zero rows. `error === null` is meaningless; the stored
    // artist_id is the evidence.
    await asA
      .from('artist_managers')
      .update({ artist_id: artistB })
      .eq('user_id', uidA)
      .eq('artist_id', artistA)

    const { data } = await svc
      .from('artist_managers')
      .select('artist_id')
      .eq('user_id', uidA)
      .eq('artist_id', artistA)
    expect(data, "A's own membership row moved").toHaveLength(1)
  })

  it('CRITICAL: A cannot DELETE a membership row (silent no-op)', async () => {
    await asA.from('artist_managers').delete().eq('user_id', uidA).eq('artist_id', artistA)
    const { data } = await svc
      .from('artist_managers')
      .select('artist_id')
      .eq('user_id', uidA)
      .eq('artist_id', artistA)
    expect(data, 'a manager deleted their own membership row').toHaveLength(1)
  })

  it('CRITICAL: anon reads no memberships at all', async () => {
    const { data } = await anonClient().from('artist_managers').select('user_id')
    expect(data ?? []).toEqual([])
  })
})

/**
 * `profiles` carries the admin/manager split. Self-service role changes are the classic
 * privilege escalation, and this table also had ZERO coverage.
 *
 * CAREFUL, and this is why the test is written the way it is: a manager updating
 * `role` on their OWN row returns `error === null` and changes nothing, because
 * profiles_admin_write scopes the row out of the statement rather than rejecting it. A
 * test that asserted an error would fail; a test that asserted no error would pass
 * whether or not the escalation actually happened. Only the stored role settles it.
 */
describe('profiles — role escalation', () => {
  it('a manager sees only their own profile', async () => {
    const { data } = await asA.from('profiles').select('user_id, role')
    expect(data ?? []).toHaveLength(1)
    expect(data![0].user_id).toBe(uidA)
  })

  it('CRITICAL: a manager cannot promote THEMSELVES to admin', async () => {
    const { error } = await asA.from('profiles').update({ role: 'admin' }).eq('user_id', uidA)
    expect(error).toBeNull() // silent: RLS filtered the row, it did not reject it

    const { data } = await svc.from('profiles').select('role').eq('user_id', uidA).single()
    expect(data?.role, 'a manager escalated themselves to admin').toBe('manager')
  })

  it('CRITICAL: a manager cannot promote ANYONE ELSE', async () => {
    await asA.from('profiles').update({ role: 'admin' }).eq('user_id', uidB)
    const { data } = await svc.from('profiles').select('role').eq('user_id', uidB).single()
    expect(data?.role).toBe('manager')
  })

  it('CRITICAL: a manager cannot INSERT a profile row', async () => {
    const { error } = await asA
      .from('profiles')
      .insert({ user_id: uidA, role: 'admin' })
      .select()
    expectRlsDenied(error, 'a manager inserting a profile')
  })

  it('CRITICAL: anon reads no profiles', async () => {
    const { data } = await anonClient().from('profiles').select('user_id')
    expect(data ?? []).toEqual([])
  })
})

/**
 * artists_admin_insert / artists_admin_delete: creating and destroying tenants is an
 * admin operation. Existing coverage stopped at SELECT and UPDATE, so nothing pinned
 * either of these — and a manager who could DELETE their own artist would cascade away
 * their entire catalogue, revisions, enquiries and analytics in one statement.
 */
describe('artists — creating and destroying a tenant is admin-only', () => {
  it('CRITICAL: a manager cannot CREATE an artist', async () => {
    const { error } = await asA
      .from('artists')
      .insert({ slug: 'iso-should-never-exist', name: 'Should Never Exist' })
      .select()
    expectRlsDenied(error, 'a manager creating an artist')

    const { data } = await svc.from('artists').select('id').eq('slug', 'iso-should-never-exist')
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: a manager cannot DELETE their OWN artist (silent, so check the row)', async () => {
    // No delete policy applies to a manager, so the row is filtered out and PostgREST
    // answers with an empty result and no error. Deleting the artist would cascade the
    // whole tenant away, so the assertion has to be that it is still there.
    const { data: deleted, error } = await asA.from('artists').delete().eq('id', artistA).select()
    expect(error).toBeNull()
    expect(deleted ?? []).toEqual([])

    const { data } = await svc.from('artists').select('id').eq('id', artistA)
    expect(data, 'a manager deleted their own tenant').toHaveLength(1)
  })

  it("CRITICAL: a manager cannot DELETE another tenant's artist", async () => {
    await asA.from('artists').delete().eq('id', artistB)
    const { data } = await svc.from('artists').select('id').eq('id', artistB)
    expect(data).toHaveLength(1)
  })
})
