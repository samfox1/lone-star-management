// What has changed since the last publish, per section, with no false positives.
/**
 * PHASE 1 — diffUnpublished(artistId): what's changed since the last publish,
 * per section. Powers the Overview "unpublished" summary and the per-section
 * dirty badges. The critical property is NO FALSE POSITIVES: a freshly published
 * artist shows nothing pending.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). Two defects, and the second is the
 * interesting one.
 *
 * The first is the ordinary kind: this file overwrote the artist's `bio` four times and put
 * back a hard-coded `SEED_BIO` copied from the seed script, then republished the profile —
 * on the shared live project, over whatever a human had actually written there.
 *
 * The second is that the HEADLINE assertion was never true of a shared artist and could
 * only ever have passed by luck. "Reports nothing pending right after a full publish"
 * requires that NOTHING on that artist is dirty — but `publishAll` is catalog-wide, so on
 * the seed artist it was simultaneously (a) committing every other suite's and every
 * human's pending draft to the live site, and (b) depending on there being none left over,
 * which a concurrently-running suite can break at any moment. On an artist this file owns,
 * "nothing pending" is a statement about a catalog whose entire contents this file wrote.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, diffUnpublished, publishAll } from '@/lib/content'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

async function seedTrack(input: Record<string, unknown>) {
  return createContent(asA, 'track', artistA, input)
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Diff unpublished', asA)
  artistA = tenantA.id
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, tenantA)
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
