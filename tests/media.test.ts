/**
 * MILESTONE — per-artist media (table + Storage), isolation.
 *
 * Media rows and the underlying Storage objects are scoped to the artist's
 * manager: writes go in the artist's own folder ({artist_id}/...), and a
 * non-owner can neither read the rows nor upload into the folder.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  await svc.from('media').delete().in('artist_id', [artistA, artistB])
  await svc.storage.from('media').remove([
    `${artistA}/hero-videos/iso-test.png`,
    `${artistB}/hero-videos/iso-test.png`,
  ])
})

describe('media table isolation', () => {
  it('manager A registers media for their own artist', async () => {
    const { data, error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'hero_video', storage_path: `${artistA}/hero-videos/x.mp4` })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('CRITICAL: manager A cannot register media for artist B', async () => {
    const { error } = await asA
      .from('media')
      .insert({ artist_id: artistB, purpose: 'hero_video', storage_path: `${artistB}/hero-videos/x.mp4` })
      .select()
    expect(error).not.toBeNull()
  })

  it("CRITICAL: manager A cannot read artist B's media", async () => {
    await svc
      .from('media')
      .insert({ artist_id: artistB, purpose: 'profile_photo', storage_path: `${artistB}/profile/p.jpg` })
    const { data } = await asA.from('media').select('id').eq('artist_id', artistB)
    expect(data).toEqual([])
  })
})

describe('storage path isolation', () => {
  const body = Buffer.from('iso-test')

  it('manager A can upload into their own folder', async () => {
    const { error } = await asA.storage
      .from('media')
      .upload(`${artistA}/hero-videos/iso-test.png`, body, { contentType: 'image/png', upsert: true })
    expect(error).toBeNull()
  })

  // Named "no HTML/SVG XSS" while only ever uploading text/html — the name claimed
  // coverage this assertion does not have. SVG is the mime the bucket-caps migration
  // (20260708140000) actually singles out, and it is pinned in
  // tests/brand.isolation.test.ts with the STRONGER actor (service role: if even the
  // god key is refused, no session can do better) against this same bucket, so
  // re-asserting it here would be a pure duplicate. This one owns text/html only.
  it('CRITICAL: the media bucket rejects text/html (stored XSS on a public bucket)', async () => {
    const { error } = await asA.storage
      .from('media')
      .upload(`${artistA}/hero-videos/xss.html`, Buffer.from('<script>alert(1)</script>'), {
        contentType: 'text/html',
        upsert: true,
      })
    expect(error).not.toBeNull()
  })

  it("CRITICAL: manager A cannot upload into artist B's folder", async () => {
    const { error } = await asA.storage
      .from('media')
      .upload(`${artistB}/hero-videos/iso-test.png`, body, { contentType: "image/png", upsert: true })
    expect(error).not.toBeNull()
  })
})
