// What has changed since the last publish, per section, with no false positives.
/**
 * PHASE 1 — diffUnpublished(artistId): what's changed since the last publish,
 * per section. Powers the Overview "unpublished" summary and the per-section
 * dirty badges. The critical property is NO FALSE POSITIVES: a freshly published
 * artist shows nothing pending.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, diffUnpublished, publishAll, publishProfile } from '@/lib/content'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const SEED_BIO = 'Dusty alt-country out of West Texas.'

/** Track ids this file created. Teardown removes ONLY these: deleting every track for the
 *  artist on the shared live project erases whatever else is there and leaves the later
 *  music suites asserting over an empty catalog. */
const createdTracks: string[] = []

async function seedTrack(input: Record<string, unknown>) {
  const row = await createContent(asA, 'track', artistA, input)
  createdTracks.push(row.id)
  return row
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (createdTracks.length) {
    await svc.from('tracks').delete().in('id', createdTracks)
    await svc.from('revisions').delete().in('entity_id', createdTracks)
    createdTracks.length = 0
  }
  // The profile is a singleton snapshot: restore the seed bio and republish so the artist
  // is left LIVE with the content that was there before.
  await svc.from('artists').update({ bio: SEED_BIO }).eq('id', artistA)
  await publishProfile(svc, artistA)
})

describe('diffUnpublished', () => {
  it('CRITICAL: reports nothing pending right after a full publish (no false positives)', async () => {
    await asA.from('artists').update({ bio: 'DIFF baseline bio' }).eq('id', artistA)
    await seedTrack({ title: 'DIFF clean track' })
    await publishAll(asA, artistA)

    const diff = await diffUnpublished(asA, artistA)
    for (const [section, d] of Object.entries(diff)) {
      expect(d.dirty, `${section} should be clean`).toBe(false)
    }
  })

  it('detects an edited track and an edited bio; leaves clean sections clean', async () => {
    const track = await seedTrack({ title: 'DIFF edit track' })
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
    const toDelete = await seedTrack({ title: 'DIFF will delete' })
    await publishAll(asA, artistA)

    await seedTrack({ title: 'DIFF added track' })
    await deleteContent(asA, 'track', toDelete.id)

    const diff = await diffUnpublished(asA, artistA)
    expect(diff.track.added).toBeGreaterThanOrEqual(1)
    expect(diff.track.deleted).toBeGreaterThanOrEqual(1)
    expect(diff.track.dirty).toBe(true)
  })
})
