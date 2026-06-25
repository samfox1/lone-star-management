/**
 * PHASE 4 (Videos) — the new `video` content type: CRUD, draft → publish, public
 * read under the right key, tombstone on delete, dirty-tracking, and the PUBLIC
 * ALLOWLIST (only title/provider/embed_url reach fans — never youtube_id/source).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, diffUnpublished, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

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
  it('CRITICAL: a created video is a draft until publish, then public under `videos`', async () => {
    await createContent(asA, 'video', artistA, {
      title: 'VID one',
      provider: 'youtube',
      embed_url: 'https://www.youtube.com/embed/aaaa',
    })

    expect((await publicVideos()).some((v) => v.title === 'VID one')).toBe(false) // draft
    await publishContent(asA, 'video', artistA)
    expect((await publicVideos()).some((v) => v.title === 'VID one')).toBe(true) // live
  })

  it('CRITICAL: the public video exposes only title/provider/embed_url (no youtube_id/source)', async () => {
    const v = (await publicVideos()).find((x) => x.title === 'VID one')!
    expect(v).toMatchObject({
      title: 'VID one',
      provider: 'youtube',
      embed_url: 'https://www.youtube.com/embed/aaaa',
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
