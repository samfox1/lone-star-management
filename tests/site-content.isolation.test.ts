/**
 * SITE EDITOR — tenant isolation for the new site_content table (the
 * non-negotiable gate). A manager can never read/update/delete/insert another
 * artist's site text. RLS (is_manager_of) is the sole guard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'
import { expectRlsDenied } from './helpers/rls'

let artistA: string
let artistB: string
let asA: SupabaseClient
let bRowId: string
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)

  const { data, error } = await svc
    .from('site_content')
    .insert({ artist_id: artistB, key: 'hero_tagline', value: 'B private tagline' })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('seed B site_content failed')
  bRowId = data.id
})

afterAll(async () => {
  // Only the one row this file planted. It used to wipe every site_content row for BOTH
  // seed artists plus all of A's site_content revisions — i.e. it deleted the editor
  // copy of two live sites, on the shared hosted project, every run.
  if (bRowId) await svc.from('site_content').delete().eq('id', bRowId)
})

describe('site_content tenant isolation', () => {
  it('the B fixture really is in the table (service role)', async () => {
    // Guard rail for the read denial below: an empty table would pass it for free.
    const { data } = await svc.from('site_content').select('id').eq('id', bRowId)
    expect(data).toHaveLength(1)
  })

  it("CRITICAL: A cannot READ B's site_content", async () => {
    const { data } = await asA.from('site_content').select('*').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: A cannot UPDATE B's row", async () => {
    await asA.from('site_content').update({ value: 'hacked' }).eq('id', bRowId)
    const { data } = await svc.from('site_content').select('value').eq('id', bRowId).single()
    expect(data!.value).toBe('B private tagline')
  })

  it("CRITICAL: A cannot DELETE B's row", async () => {
    await asA.from('site_content').delete().eq('id', bRowId)
    const { count } = await svc
      .from('site_content')
      .select('id', { count: 'exact', head: true })
      .eq('id', bRowId)
    expect(count).toBe(1)
  })

  it("CRITICAL: A cannot INSERT into B's tenant", async () => {
    const { error } = await asA
      .from('site_content')
      .insert({ artist_id: artistB, key: 'x', value: 'y' })
    expectRlsDenied(error, "A inserting into B's site_content")
  })
})
