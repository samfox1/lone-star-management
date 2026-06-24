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
} from './helpers/supabase'

let artistA: string // Lone Pine, managed by A
let artistB: string // Gulf Static, managed by B
let trackA: string // a fixture track on artist A
let trackB: string // a fixture track on artist B

let asA: SupabaseClient
let asB: SupabaseClient
let asAdmin: SupabaseClient
const svc = serviceClient()

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
    expect(error).not.toBeNull()
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
    expect(error).not.toBeNull()
  })
})
