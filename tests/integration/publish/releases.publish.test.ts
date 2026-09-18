// Choosing which releases are on the site, committed behind a password-gated publish.
/**
 * Release publish — the on-site visibility reconcile + the password gate.
 *
 * The public site gates on each release's `on_site` flag. Managers pick which
 * releases are on the site and commit with a password-gated publish. This covers:
 *  - reconcileOnSite flips exactly the releases that should change,
 *    both directions, and is RLS-scoped (can't touch another tenant);
 *  - the password gate, exercised THROUGH publishReleasesAction: a wrong password
 *    leaves the on-site flags and the snapshots exactly as they were.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, SEED_PASSWORD, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'

/**
 * WHY BOTH ARTISTS ARE THROWAWAYS (2026-09-18). `publishMusicAction` snapshots the
 * artist's WHOLE music catalog, so running it on a shared seed artist committed whatever
 * a manager (or another suite) had pending, and wrote revisions for rows this file never
 * created. The cleanup that grew around that says it plainly: releases were tracked by
 * id, but track revisions had "no fixture id of ours to key off" and were deleted by
 * artist + type + a timestamp floor — a teardown that reaches for the clock is a teardown
 * deleting other people's rows and hoping the window is narrow enough.
 *
 * On an artist this file owns there is no window to get wrong: the catalog IS the
 * fixtures, and dropping the artist cascades every release, track and revision.
 */
let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// The action builds its client from the request cookies; here it gets manager A's REAL
// signed-in client, so RLS, the password gate and every write run exactly as in the app.
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => asA }))

/** Rows this file created, so teardown removes ONLY those — the project is shared and
 *  live, and a blanket delete by artist erases whatever else is in there. */
const createdReleases: string[] = []
beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const asB = await signInAs(SEED.managerB)
  artistA = (await createThrowawayArtist(svc, 'Release publish A', asA)).id
  // B is a REAL tenant with its own manager, so the cross-tenant no-op below is refused
  // by RLS rather than by the artist not existing.
  artistB = (await createThrowawayArtist(svc, 'Release publish B', asB)).id
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artistA)
  await deleteThrowawayArtist(svc, artistB)
})

afterEach(async () => {
  if (createdReleases.length) {
    await svc.from('revisions').delete().in('entity_id', createdReleases)
    await svc.from('releases').delete().in('id', createdReleases)
    createdReleases.length = 0
  }
})

/** Insert a RELEASED release for artistA and return its id. Reconcile only scopes
 *  to Released releases (Unreleased ones are dashboard-only and never in the
 *  on-site selection), so the visibility fixtures are released by default. */
async function seedRelease(over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await svc
    .from('releases')
    .insert({ artist_id: artistA, title: 'R', slug: 'r', released: true, ...over })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  createdReleases.push(data!.id as string)
  return data!.id as string
}

/** Insert a release for artistB (the other tenant) and return its id. */
async function seedReleaseB(over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await svc
    .from('releases')
    .insert({ artist_id: artistB, title: 'B', slug: 'b', ...over })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  createdReleases.push(data!.id as string)
  return data!.id as string
}

/**
 * THE TICK IS A DRAFT WRITE THAT CASCADES (PRESENCE_PLAN S1). `setReleaseOnSiteAction`
 * replaces publish-time reconcile: it writes the release's on_site and every song in it,
 * at once, on the WORKING rows. Nothing here reaches a door — that is the snapshot's job,
 * pinned in music-doors.test.ts.
 */
describe('setReleaseOnSiteAction — the tick is a draft write that cascades', () => {
  const setOn = async (releaseId: string, on: boolean, artist = artistA) => {
    const { setReleaseOnSiteAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    return setReleaseOnSiteAction(releaseId, artist, on)
  }
  const createdTracks: string[] = []
  afterEach(async () => {
    if (createdTracks.length) {
      await svc.from('tracks').delete().in('id', createdTracks)
      createdTracks.length = 0
    }
  })
  async function seedTrack(releaseId: string, on: boolean): Promise<string> {
    const { data, error } = await svc
      .from('tracks')
      .insert({ artist_id: artistA, title: 'T', release_id: releaseId, on_site: on })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    createdTracks.push(data!.id as string)
    return data!.id as string
  }

  it('CRITICAL: turning a release on turns its songs on too — a song follows its home release', async () => {
    const rel = await seedRelease({ slug: 'cascade-on', on_site: false })
    const song = await seedTrack(rel, false)
    expect(await setOn(rel, true)).toEqual({})
    const { data: r } = await svc.from('releases').select('on_site').eq('id', rel).single()
    const { data: t } = await svc.from('tracks').select('on_site').eq('id', song).single()
    expect(r!.on_site).toBe(true)
    expect(t!.on_site, 'the song did not follow its release').toBe(true)
  })

  it('CRITICAL: turning it off cascades off', async () => {
    const rel = await seedRelease({ slug: 'cascade-off', on_site: true })
    const song = await seedTrack(rel, true)
    await setOn(rel, false)
    const { data: t } = await svc.from('tracks').select('on_site').eq('id', song).single()
    expect(t!.on_site).toBe(false)
  })

  it("CRITICAL: cannot flip another tenant's release — RLS makes it a no-op, and the row proves it", async () => {
    const bRel = await seedReleaseB({ slug: 'b-secret', on_site: false })
    await setOn(bRel, true, artistB)
    // Row STATE, never the return value: a row-filtered UPDATE returns no error and
    // touches nothing (AGENTS.md rule 3).
    const { data } = await svc.from('releases').select('on_site').eq('id', bRel).single()
    expect(data!.on_site).toBe(false)
  })
})

/**
 * The gate is `verifyPasswordGate` INSIDE publishReleasesAction, so it is the action that
 * has to be called: asserting that Supabase rejects a bad sign-in tests Supabase, and stays
 * green if the gate is deleted from the action entirely.
 *
 * Both directions are here on purpose. Rejection alone would also pass against an action
 * that fails for any reason, so the accepted-password case is what proves the refusal came
 * from the password and not from a broken publish.
 */
describe('publish password gate', () => {
  const publish = async (password: string) => {
    const { publishMusicAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    return publishMusicAction(artistA, password)
  }


  const revisionCount = async (entityId: string) => {
    const { count } = await svc
      .from('revisions')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', entityId)
    return count ?? 0
  }

  it('CRITICAL: a wrong password publishes nothing', async () => {
    const rel = await seedRelease({ slug: 'gate-bad', on_site: false })

    const res = await publish('not-the-password')
    expect(res).toEqual({ ok: false, error: 'Incorrect password.' })

    // The flag and the snapshot are the load-bearing assertions: a gate that ran AFTER
    // the reconcile would return the same error with the release already on the site.
    const { data } = await svc.from('releases').select('on_site').eq('id', rel).single()
    expect(data!.on_site).toBe(false)
    expect(await revisionCount(rel)).toBe(0)
  })

  it('the same publish goes through with the right password', async () => {
    const rel = await seedRelease({ slug: 'gate-ok', on_site: false })

    const res = await publish(SEED_PASSWORD)
    expect(res).toEqual({ ok: true })

    // Publish no longer changes presence — it SNAPSHOTS it. The row stays what the
    // manager set (off), and the revision carries that same value for the door to read.
    const { data } = await svc.from('releases').select('on_site').eq('id', rel).single()
    expect(data!.on_site).toBe(false)
    expect(await revisionCount(rel)).toBe(1)
    const { data: rev } = await svc.from('revisions').select('data').eq('entity_id', rel).single()
    expect((rev!.data as { on_site?: boolean }).on_site, 'the snapshot does not carry on_site').toBe(false)
  })
})
