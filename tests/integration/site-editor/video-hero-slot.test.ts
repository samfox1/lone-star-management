// A video placed in a hero slot reaches the public site.
/**
 * A video placed in a hero slot (site_role) reaches the PUBLIC SITE.
 *
 * The editor's hero slots pick an uploaded video and set its `site_role`
 * (hero_landscape / hero_portrait) — assignHeroSlotAction. skeen reads that off
 * get_public_site.videos to render the hero background. So `site_role` must ride
 * PUBLISHABLE.video.snapshot to the door, exactly like `support` does for tour dates.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

type PublicVideo = { id: string; title: string; storage_path: string | null; site_role?: string | null }

let artistA: string
let asA: SupabaseClient
let id: string
const svc = serviceClient()

async function liveVideo(): Promise<PublicVideo | undefined> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as { videos: PublicVideo[] }).videos.find((v) => v.id === id)
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  // An uploaded (self-hosted) video, placed in the landscape hero slot.
  const row = await createContent(asA, 'video', artistA, {
    title: 'Hero landscape',
    provider: 'uploaded',
    storage_path: `${artistA}/videos/hero-land.mp4`,
  })
  id = row.id as string
  await asA.from('videos').update({ site_role: 'hero_landscape', on_site: true }).eq('id', id).eq('artist_id', artistA)
  await publishContent(asA, 'video', artistA)
})

afterAll(async () => {
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', id)
  await svc.from('videos').delete().eq('id', id)
})

describe('video hero slot', () => {
  it('CRITICAL: site_role + storage_path ride the snapshot to the public door', async () => {
    const live = await liveVideo()
    expect(live).toBeDefined()
    expect(live?.site_role).toBe('hero_landscape')
    expect(live?.storage_path).toBe(`${artistA}/videos/hero-land.mp4`)
  })

  it('rejects an unknown role at the DB (the CHECK guards junk)', async () => {
    // Named, not just "some error". `not.toBeNull()` is satisfied by an RLS denial, a
    // renamed column (PGRST204) or a network blip just as well as by the constraint, so
    // it stays green while the thing it claims to test is gone — the CHECK could be
    // replaced by a permissions mistake and nothing here would notice.
    const bad = await asA.from('videos').update({ site_role: 'hero_diagonal' }).eq('id', id).eq('artist_id', artistA)
    expect(bad.error?.code).toBe('23514') // check_violation
    expect(bad.error?.message).toContain('videos_site_role_check')
  })

  it('clearing the role takes it off the site', async () => {
    await asA.from('videos').update({ site_role: null, on_site: false }).eq('id', id).eq('artist_id', artistA)
    await publishContent(asA, 'video', artistA)
    expect(await liveVideo()).toBeUndefined()
  })
})
