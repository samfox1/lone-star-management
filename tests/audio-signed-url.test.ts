/**
 * PHASE 3 — the signing door. signAudioUrl returns a working signed URL for a
 * PUBLISHED track's audio, and refuses to sign an unpublished track or another
 * artist's track (IDOR gate). The URL serves bytes (range-capable).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { signAudioUrl } from '@/lib/audio'
import { publishContent } from '@/lib/content'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
let publishedTrackId: string
let unpublishedTrackId: string
const svc = serviceClient()
const body = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22, 0x33, 0x44])
const audioPath = (suffix: string) => `${artistA}/audio/play-${suffix}.mp3`

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  await svc.storage.from('audio').upload(audioPath('pub'), body, { contentType: 'audio/mpeg', upsert: true })

  // A published track that carries audio.
  const { data: pub } = await svc
    .from('tracks')
    .insert({ artist_id: artistA, title: 'AUDIO pub', source: 'manual', audio_path: audioPath('pub') })
    .select('id')
    .single()
  publishedTrackId = pub!.id
  await publishContent(asA, 'track', artistA)

  // An unpublished track created AFTER the publish (no revision).
  const { data: unp } = await svc
    .from('tracks')
    .insert({ artist_id: artistA, title: 'AUDIO unpub', source: 'manual', audio_path: audioPath('unpub') })
    .select('id')
    .single()
  unpublishedTrackId = unp!.id
})

afterAll(async () => {
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'track')
  await svc.storage.from('audio').remove([audioPath('pub'), audioPath('unpub')])
})

describe('signAudioUrl', () => {
  it('signs a published track audio into a URL that serves the bytes', async () => {
    const url = await signAudioUrl(svc, SEED.artistASlug, publishedTrackId)
    expect(url).toBeTruthy()
    const res = await fetch(url!)
    expect([200, 206]).toContain(res.status)
  })

  it('serves a range request (Accept-Ranges / 206)', async () => {
    const url = await signAudioUrl(svc, SEED.artistASlug, publishedTrackId)
    const res = await fetch(url!, { headers: { Range: 'bytes=0-3' } })
    expect([200, 206]).toContain(res.status)
  })

  it('CRITICAL: refuses to sign an unpublished track', async () => {
    const url = await signAudioUrl(svc, SEED.artistASlug, unpublishedTrackId)
    expect(url).toBeNull()
  })

  it("CRITICAL: refuses to sign under another artist's slug", async () => {
    const url = await signAudioUrl(svc, SEED.artistBSlug, publishedTrackId)
    expect(url).toBeNull()
  })
})
