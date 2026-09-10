/**
 * PHASE 4 (Videos) — tenant isolation for the new videos table (the
 * non-negotiable gate). A manager can never read/write/delete/insert another
 * artist's videos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectRlsDenied } from '@tests/helpers/rls'

let artistA: string
let artistB: string
let asA: SupabaseClient
let bRowId: string
const svc = serviceClient()
const bVideo = {
  title: 'B private video',
  provider: 'youtube',
  embed_url: 'https://www.youtube.com/embed/bbbb',
  source: 'manual',
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  const { data, error } = await svc
    .from('videos')
    .insert({ artist_id: artistB, ...bVideo })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('seed B video failed')
  bRowId = data.id
})

afterAll(async () => {
  // Only the one row this file planted. It used to wipe every video for BOTH seed
  // artists plus all of A's video revisions — state this file never created.
  if (bRowId) await svc.from('videos').delete().eq('id', bRowId)
})

describe('videos tenant isolation', () => {
  it('the B fixture really is in the table (service role)', async () => {
    // Guard rail for the read denial below: an empty table would pass it for free.
    const { data } = await svc.from('videos').select('id').eq('id', bRowId)
    expect(data).toHaveLength(1)
  })

  it("CRITICAL: A cannot READ B's videos", async () => {
    const { data } = await asA.from('videos').select('*').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: A cannot UPDATE B's video", async () => {
    await asA.from('videos').update({ title: 'hacked' }).eq('id', bRowId)
    const { data } = await svc.from('videos').select('title').eq('id', bRowId).single()
    expect(data!.title).toBe('B private video')
  })

  it("CRITICAL: A cannot DELETE B's video", async () => {
    await asA.from('videos').delete().eq('id', bRowId)
    const { count } = await svc.from('videos').select('id', { count: 'exact', head: true }).eq('id', bRowId)
    expect(count).toBe(1)
  })

  it("CRITICAL: A cannot INSERT into B's tenant", async () => {
    const { error } = await asA.from('videos').insert({ artist_id: artistB, ...bVideo })
    expectRlsDenied(error, "A inserting into B's videos")
  })
})
