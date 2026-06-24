/**
 * PHASE 1 — diffUnpublished(artistId): what's changed since the last publish,
 * per section. Powers the Overview "unpublished" summary and the per-section
 * dirty badges. The critical property is NO FALSE POSITIVES: a freshly published
 * artist shows nothing pending.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, diffUnpublished, publishAll, publishProfile } from '@/lib/content'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const SEED_BIO = 'Dusty alt-country out of West Texas.'

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).in('entity_type', ['track', 'artist'])
  await svc.from('artists').update({ bio: SEED_BIO, template: 'classic' }).eq('id', artistA)
  await publishProfile(svc, artistA)
})

describe('diffUnpublished', () => {
  it('CRITICAL: reports nothing pending right after a full publish (no false positives)', async () => {
    await asA.from('artists').update({ bio: 'DIFF baseline bio' }).eq('id', artistA)
    await createContent(asA, 'track', artistA, { title: 'DIFF clean track' })
    await publishAll(asA, artistA)

    const diff = await diffUnpublished(asA, artistA)
    for (const [section, d] of Object.entries(diff)) {
      expect(d.dirty, `${section} should be clean`).toBe(false)
    }
  })

  it('detects an edited track and an edited bio; leaves clean sections clean', async () => {
    const track = await createContent(asA, 'track', artistA, { title: 'DIFF edit track' })
    await publishAll(asA, artistA)

    await asA.from('tracks').update({ title: 'DIFF edited' }).eq('id', track.id)
    await asA.from('artists').update({ bio: 'DIFF changed bio' }).eq('id', artistA)

    const diff = await diffUnpublished(asA, artistA)
    expect(diff.track.edited).toBeGreaterThanOrEqual(1)
    expect(diff.track.dirty).toBe(true)
    expect(diff.profile.dirty).toBe(true)
    expect(diff.merch.dirty).toBe(false)
    expect(diff.link.dirty).toBe(false)
  })

  it('detects a new unpublished track (added) and a removed published track (deleted)', async () => {
    await asA.from('artists').update({ bio: 'DIFF baseline 3' }).eq('id', artistA)
    const toDelete = await createContent(asA, 'track', artistA, { title: 'DIFF will delete' })
    await publishAll(asA, artistA)

    await createContent(asA, 'track', artistA, { title: 'DIFF added track' })
    await deleteContent(asA, 'track', toDelete.id)

    const diff = await diffUnpublished(asA, artistA)
    expect(diff.track.added).toBeGreaterThanOrEqual(1)
    expect(diff.track.deleted).toBeGreaterThanOrEqual(1)
    expect(diff.track.dirty).toBe(true)
  })
})
