// Media rows and their storage objects are both scoped to the artist's manager.
/**
 * MILESTONE — per-artist media (table + Storage), isolation.
 *
 * Media rows and the underlying Storage objects are scoped to the artist's
 * manager: writes go in the artist's own folder ({artist_id}/...), and a
 * non-owner can neither read the rows nor upload into the folder.
 *
 * WHY BOTH ARTISTS ARE THROWAWAYS (AGENTS.md rule 6). The afterEach here read
 * `delete().in('artist_id', [artistA, artistB])` against the two SHARED seed artists —
 * i.e. after every single test it deleted EVERY media row both of them owned: gallery
 * photos, profile photos, logos, hero clips, none of it created by this file, all of it on
 * the live hosted project. It also quietly propped up the read denial below: "A sees no
 * rows for B" is free on a `media` table that a teardown empties after each test. Both
 * artists are created and dropped by this file now, so the wipe is exactly the rows this
 * file wrote, and B's row is PLANTED before the denial so there is something to be denied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'

let tenantA: ThrowawayArtist
let tenantB: ThrowawayArtist
let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Media isolation A', asA)
  // B deliberately has NO manager link: nothing here acts as B, only against B, and the
  // hosted project rate-limits sign-ins hard enough that an unused session is a real cost.
  tenantB = await createThrowawayArtist(svc, 'Media isolation B')
  artistA = tenantA.id
  artistB = tenantB.id
})

afterEach(async () => {
  // A blanket wipe that is honest: this file owns both artists, so nothing under them
  // belongs to anyone else. Storage objects do NOT cascade with the artist row, so the
  // two paths this file can create are named explicitly.
  await svc.from('media').delete().in('artist_id', [artistA, artistB])
  await svc.storage.from('media').remove([
    `${artistA}/hero-videos/iso-test.png`,
    `${artistB}/hero-videos/iso-test.png`,
  ])
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, tenantA)
  await deleteThrowawayArtist(svc, tenantB)
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
    // 42501, not merely "an error": a bare not-null also passes on a renamed column or a
    // constraint violation, neither of which says anything about the tenant gate.
    expectRlsDenied(error, "A registering media for B")
  })

  it("CRITICAL: manager A cannot read artist B's media", async () => {
    const { data: planted, error: plantErr } = await svc
      .from('media')
      .insert({ artist_id: artistB, purpose: 'profile_photo', storage_path: `${artistB}/profile/p.jpg` })
      .select('id')
      .single()
    // The witness first (AGENTS.md rule 2): with the old afterEach emptying `media` for
    // both seed artists, this denial was a claim about a table nothing was in.
    expect(plantErr).toBeNull()
    const { data: seenByService } = await svc.from('media').select('id').eq('artist_id', artistB)
    expect((seenByService ?? []).map((r) => r.id)).toContain(planted!.id)

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
