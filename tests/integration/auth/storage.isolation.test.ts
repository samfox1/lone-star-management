/**
 * `media` and `videos` bucket object policies — cross-tenant.
 *
 * Both buckets are keyed by the FIRST PATH SEGMENT: the policies read
 * `storage.foldername(name)[1]` and hand it to is_manager_of(). Nothing in the suite
 * ever tested that across tenants, so `media manager insert` / `videos manager insert`
 * could have been widened to any authenticated user — or the folder check dropped
 * entirely — with every storage test still green. A manager who can write
 * `{other_artist_id}/...` can replace another artist's hero video or profile photo on
 * their live public site.
 *
 * NOTE ON READS. Both buckets are PUBLIC (`storage.buckets.public = true`), so the
 * object endpoint serves bytes by URL without consulting RLS — that is the whole point,
 * it is how a fan's browser loads the images. The SELECT policies therefore guard
 * ENUMERATION (`.list()`), which is what 20260708120000 closed after the original
 * blanket "media public read" let anyone list every artist's draft assets. So: write
 * denial is a 403, read denial is an empty listing. Asserting a download failure here
 * would be asserting the opposite of the design.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

const svc = serviceClient()
const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])

let artistB: string
let asA: SupabaseClient

const mediaB = () => `${artistB}/gallery/iso-b.jpg`
const mediaForged = () => `${artistB}/gallery/iso-forged.jpg`
const videoB = () => `${artistB}/videos/iso-b.mp4`
const videoForged = () => `${artistB}/videos/iso-forged.mp4`

beforeAll(async () => {
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)

  // Real objects in B's folders, planted with the service role, so the enumeration
  // denials below have something to fail to enumerate.
  const m = await svc.storage.from('media').upload(mediaB(), bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (m.error) throw m.error
  const v = await svc.storage.from('videos').upload(videoB(), bytes, {
    contentType: 'video/mp4',
    upsert: true,
  })
  if (v.error) throw v.error
})

afterAll(async () => {
  await svc.storage.from('media').remove([mediaB(), mediaForged()])
  await svc.storage.from('videos').remove([videoB(), videoForged()])
})

describe('media bucket — cross-tenant', () => {
  it("the B fixture object really exists (service role)", async () => {
    const { data } = await svc.storage.from('media').list(`${artistB}/gallery`)
    expect((data ?? []).map((o) => o.name)).toContain('iso-b.jpg')
  })

  it("CRITICAL: manager A cannot upload into B's media folder", async () => {
    const { error } = await asA.storage.from('media').upload(mediaForged(), bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    })
    expect(error).not.toBeNull()

    // Nothing landed. A silent upload success would put attacker content on B's site.
    const { data } = await svc.storage.from('media').list(`${artistB}/gallery`)
    expect((data ?? []).map((o) => o.name)).not.toContain('iso-forged.jpg')
  })

  it("CRITICAL: manager A cannot delete B's media object", async () => {
    await asA.storage.from('media').remove([mediaB()])
    const { data } = await svc.storage.from('media').list(`${artistB}/gallery`)
    expect((data ?? []).map((o) => o.name), "A deleted another tenant's media").toContain('iso-b.jpg')
  })

  it("CRITICAL: manager A cannot ENUMERATE B's media folder", async () => {
    const { data } = await asA.storage.from('media').list(`${artistB}/gallery`)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: anon cannot enumerate the media bucket', async () => {
    const { data } = await anonClient().storage.from('media').list(`${artistB}/gallery`)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: anon cannot upload into the media bucket', async () => {
    const { error } = await anonClient().storage.from('media').upload(mediaForged(), bytes, {
      contentType: 'image/jpeg',
    })
    expect(error).not.toBeNull()
  })
})

describe('videos bucket — cross-tenant', () => {
  it('the B fixture object really exists (service role)', async () => {
    const { data } = await svc.storage.from('videos').list(`${artistB}/videos`)
    expect((data ?? []).map((o) => o.name)).toContain('iso-b.mp4')
  })

  it("CRITICAL: manager A cannot upload into B's videos folder", async () => {
    const { error } = await asA.storage.from('videos').upload(videoForged(), bytes, {
      contentType: 'video/mp4',
      upsert: true,
    })
    expect(error).not.toBeNull()

    const { data } = await svc.storage.from('videos').list(`${artistB}/videos`)
    expect((data ?? []).map((o) => o.name)).not.toContain('iso-forged.mp4')
  })

  it("CRITICAL: manager A cannot delete B's video object", async () => {
    await asA.storage.from('videos').remove([videoB()])
    const { data } = await svc.storage.from('videos').list(`${artistB}/videos`)
    expect((data ?? []).map((o) => o.name), "A deleted another tenant's video").toContain('iso-b.mp4')
  })

  it("CRITICAL: manager A cannot ENUMERATE B's videos folder", async () => {
    const { data } = await asA.storage.from('videos').list(`${artistB}/videos`)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: anon cannot enumerate the videos bucket', async () => {
    const { data } = await anonClient().storage.from('videos').list(`${artistB}/videos`)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: anon cannot upload into the videos bucket', async () => {
    const { error } = await anonClient().storage.from('videos').upload(videoForged(), bytes, {
      contentType: 'video/mp4',
    })
    expect(error).not.toBeNull()
  })
})
