/**
 * PHASE 5 (Analytics) — the secure ingest gate. Anon fans record events ONLY
 * through record_event (a SECURITY DEFINER door that resolves the artist from
 * the slug); nobody can insert arbitrary rows, and an owner can read only their
 * own events.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()
const anon = anonClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('analytics_events').delete().eq('artist_id', artistA)
  await svc.from('analytics_events').delete().eq('artist_id', artistB)
})

describe('analytics ingest + isolation', () => {
  it('anon records an event via record_event; the owner can read it', async () => {
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'view' })
    const { data } = await asA.from('analytics_events').select('type').eq('artist_id', artistA)
    expect((data ?? []).some((e) => e.type === 'view')).toBe(true)
  })

  it("CRITICAL: A cannot READ B's analytics events", async () => {
    await anon.rpc('record_event', { p_slug: SEED.artistBSlug, p_type: 'view' })
    const { data } = await asA.from('analytics_events').select('*').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: nobody can INSERT events directly (only via record_event)', async () => {
    const asAInsert = await asA.from('analytics_events').insert({ artist_id: artistA, type: 'view' })
    expect(asAInsert.error).not.toBeNull()
    const anonInsert = await anon.from('analytics_events').insert({ artist_id: artistA, type: 'view' })
    expect(anonInsert.error).not.toBeNull()
  })
})
