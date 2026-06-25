/**
 * PHASE 5 (Releases) — tenant isolation for the new releases table (the
 * non-negotiable gate). A manager can never read/write/delete/insert another
 * artist's releases.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
let bRowId: string
const svc = serviceClient()
const bRelease = {
  title: 'B private release',
  slug: 'b-private',
  cover_url: 'https://img/b.jpg',
  release_date: '2026-01-01',
  links: [{ label: 'Spotify', url: 'https://open.spotify.com/album/b' }],
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  const { data, error } = await svc.from('releases').insert({ artist_id: artistB, ...bRelease }).select('id').single()
  if (error || !data) throw error ?? new Error('seed B release failed')
  bRowId = data.id
})

afterAll(async () => {
  await svc.from('releases').delete().eq('artist_id', artistB)
  await svc.from('releases').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'release')
})

describe('releases tenant isolation', () => {
  it("CRITICAL: A cannot READ B's releases", async () => {
    const { data } = await asA.from('releases').select('*').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: A cannot UPDATE B's release", async () => {
    await asA.from('releases').update({ title: 'hacked' }).eq('id', bRowId)
    const { data } = await svc.from('releases').select('title').eq('id', bRowId).single()
    expect(data!.title).toBe('B private release')
  })

  it("CRITICAL: A cannot DELETE B's release", async () => {
    await asA.from('releases').delete().eq('id', bRowId)
    const { count } = await svc.from('releases').select('id', { count: 'exact', head: true }).eq('id', bRowId)
    expect(count).toBe(1)
  })

  it("CRITICAL: A cannot INSERT into B's tenant", async () => {
    const { error } = await asA.from('releases').insert({ artist_id: artistB, ...bRelease, slug: 'b-evil' })
    expect(error).not.toBeNull()
  })
})
