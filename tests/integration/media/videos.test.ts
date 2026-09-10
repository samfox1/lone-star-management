// The video type end to end, and the short list of fields that actually reach fans.
/**
 * PHASE 4 (Videos) — the new `video` content type: CRUD, draft → publish, public
 * read under the right key, tombstone on delete, dirty-tracking, and the PUBLIC
 * ALLOWLIST (only title/provider/embed_url reach fans — never youtube_id/source).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, diffUnpublished, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('videos').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'video')
})

async function publicVideos(): Promise<Record<string, unknown>[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { videos?: Record<string, unknown>[] } | null)?.videos ?? [])
}

describe('video content type — draft → publish → public', () => {
  it('CRITICAL: a created video is off-site until published AND toggled on-site', async () => {
    const made = await createContent(asA, 'video', artistA, {
      title: 'VID one',
      provider: 'youtube',
      embed_url: 'https://www.youtube.com/embed/aaaa',
    })

    expect((await publicVideos()).some((v) => v.title === 'VID one')).toBe(false) // draft
    // Snapshot alone isn't enough: new videos land on_site=false, so the public
    // door still hides it (the two gates — published content + the live toggle).
    await publishContent(asA, 'video', artistA)
    expect((await publicVideos()).some((v) => v.title === 'VID one')).toBe(false) // still off-site
    // Toggle it on-site (a LIVE toggle now — ADR 0009; no publish needed) → live.
    await asA.from('videos').update({ on_site: true }).eq('id', made.id).eq('artist_id', artistA)
    expect((await publicVideos()).some((v) => v.title === 'VID one')).toBe(true) // live
  })

  it('CRITICAL: the public video exposes title/provider/embed_url/is_short (no youtube_id/source)', async () => {
    const v = (await publicVideos()).find((x) => x.title === 'VID one')!
    expect(v).toMatchObject({
      title: 'VID one',
      provider: 'youtube',
      embed_url: 'https://www.youtube.com/embed/aaaa',
      is_short: false, // the Videos/Shorts split the site can key off
    })
    expect(v).not.toHaveProperty('youtube_id')
    expect(v).not.toHaveProperty('source')
  })

  it('diffUnpublished reports videos dirty on a new draft, clean after publish', async () => {
    const made = await createContent(asA, 'video', artistA, {
      title: 'VID two',
      provider: 'youtube',
      embed_url: 'https://www.youtube.com/embed/bbbb',
    })
    expect((await diffUnpublished(asA, artistA)).video.dirty).toBe(true)
    await publishContent(asA, 'video', artistA)
    expect((await diffUnpublished(asA, artistA)).video.dirty).toBe(false)

    // delete + republish → tombstoned off the public site
    await deleteContent(asA, 'video', made.id)
    await publishContent(asA, 'video', artistA)
    expect((await publicVideos()).some((v) => v.title === 'VID two')).toBe(false)
  })
})
