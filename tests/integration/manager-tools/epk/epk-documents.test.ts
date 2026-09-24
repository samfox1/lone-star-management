// The stage plot and tech rider: stored privately, and published with the profile.
/**
 * The press-kit DOCUMENTS: the stage plot and the tech rider.
 *
 * They hang off `artists` columns pointing into the PRIVATE `documents` bucket, and they
 * ride ARTIST_SNAPSHOT — so a generated EPK is entirely published content rather than
 * published copy stapled to a draft rider.
 *
 * The path arrives from the client (the browser uploads direct-to-Storage, then asks us
 * to record where), so it is validated the same way brand assets are. The extra rule here
 * is the FOLDER: a document must live in `documents`, never in the public `media` bucket's
 * layout, or a rider could be recorded at a path that is world-readable.
 *
 * TENANCY, AND WHY THE ARTIST IS A THROWAWAY. This file used to run on the shared seed
 * artist `lone-pine`, and its teardown was
 *
 *     svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'artist')
 *
 * — i.e. it deleted that artist's ENTIRE profile publish history, every artist revision
 * ever made, and republished one fresh snapshot on top. That is not cleanup: `revisions`
 * IS the version history the editor's version picker reads, and a run of this file threw
 * all of it away — along with whatever tech_rider_path and stage_plot_path a human had
 * actually set, both nulled by the line above it. It also left every other suite's
 * published-content assertions standing on a profile snapshot this file had written.
 *
 * The artist is now created here and dropped here, and dropping it cascades its revisions
 * away, so the teardown deletes exactly what this file created. The publish-window test
 * needs a slug for get_public_site, which is why it uses the throwaway's own.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishProfile } from '@/lib/content'
import { setPressDocument } from '@/lib/epk'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let artist: ThrowawayArtist
/** Shorthand for the id, which every call below needs. */
let artistA: string
let asA: SupabaseClient
let asB: SupabaseClient
const svc = serviceClient()

/** A path in exactly the shape `buildStoragePath` produces — the filename must be a real
 *  uuid, so the seed is folded down to hex. */
const docPath = (seed: string) =>
  `${artistA}/documents/${seed.replace(/[^a-f0-9]/g, '0').padEnd(8, '0').slice(0, 8)}-0000-4000-8000-000000000000.pdf`

async function stored(): Promise<{ tech_rider_path: string | null; stage_plot_path: string | null }> {
  const { data } = await svc
    .from('artists')
    .select('tech_rider_path, stage_plot_path')
    .eq('id', artistA)
    .single()
  return data as never
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  // A is the manager, so setPressDocument's update passes RLS. B is deliberately NOT,
  // which is what the cross-tenant write test below rests on.
  artist = await createThrowawayArtist(svc, 'EPK documents', asA)
  artistA = artist.id
})

afterAll(async () => {
  // One statement: the artist row cascades its revisions (and anything else a future
  // migration hangs off an artist) away. Nothing here touches the seed artists.
  await deleteThrowawayArtist(svc, artist)
})

describe('setPressDocument', () => {
  it('stores a rider and a stage plot independently', async () => {
    expect((await setPressDocument(asA, artistA, 'tech_rider', docPath('rider'))).ok).toBe(true)
    expect((await setPressDocument(asA, artistA, 'stage_plot', docPath('plot'))).ok).toBe(true)
    const row = await stored()
    expect(row.tech_rider_path).toBe(docPath('rider'))
    expect(row.stage_plot_path).toBe(docPath('plot'))
  })

  it('replacing one leaves the other alone', async () => {
    await setPressDocument(asA, artistA, 'tech_rider', docPath('r1'))
    await setPressDocument(asA, artistA, 'stage_plot', docPath('p1'))
    await setPressDocument(asA, artistA, 'tech_rider', docPath('r2'))
    const row = await stored()
    expect(row.tech_rider_path).toBe(docPath('r2'))
    expect(row.stage_plot_path).toBe(docPath('p1'))
  })

  it('clears with null rather than storing an empty string', async () => {
    await setPressDocument(asA, artistA, 'tech_rider', docPath('gone'))
    expect((await setPressDocument(asA, artistA, 'tech_rider', null)).ok).toBe(true)
    expect((await stored()).tech_rider_path).toBeNull()
  })

  it("CRITICAL: refuses another artist's path", async () => {
    const foreign = `00000000-0000-4000-8000-000000000000/documents/11111111-0000-4000-8000-000000000000.pdf`
    const res = await setPressDocument(asA, artistA, 'tech_rider', foreign)
    expect(res.ok).toBe(false)
  })

  it('CRITICAL: refuses a path outside the documents folder', async () => {
    // `media` is PUBLIC. A rider recorded at a media path would be world-readable by URL,
    // which is the entire reason documents got their own private bucket.
    const inMedia = `${artistA}/brand/11111111-0000-4000-8000-000000000000.pdf`
    expect((await setPressDocument(asA, artistA, 'tech_rider', inMedia)).ok).toBe(false)
  })

  it('CRITICAL: B cannot write a document onto A', async () => {
    await setPressDocument(asA, artistA, 'stage_plot', docPath('mine'))
    await setPressDocument(asB, artistA, 'stage_plot', docPath('theirs'))
    expect((await stored()).stage_plot_path).toBe(docPath('mine'))
  })
})

describe('press documents ride the publish window', () => {
  it('CRITICAL: a rider is not in the published snapshot until the profile publishes', async () => {
    await setPressDocument(asA, artistA, 'tech_rider', null)
    await publishProfile(asA, artistA)

    await setPressDocument(asA, artistA, 'tech_rider', docPath('draft'))
    const before = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
    expect(
      ((before.data as { artist?: Record<string, unknown> } | null)?.artist ?? {}).tech_rider_path,
    ).toBeNull()

    await publishProfile(asA, artistA)
    const after = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
    expect(
      ((after.data as { artist?: Record<string, unknown> } | null)?.artist ?? {}).tech_rider_path,
    ).toBe(docPath('draft'))
  })
})
