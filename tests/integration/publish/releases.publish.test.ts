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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileOnSite } from '@/lib/content'
import { SEED, SEED_PASSWORD, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

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
/** Set before a publish that snapshots tracks, so its revisions can be removed by time
 *  (they have no fixture id of ours to key off). */
let trackRevisionFloor: string | null = null

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  if (createdReleases.length) {
    await svc.from('revisions').delete().in('entity_id', createdReleases)
    await svc.from('releases').delete().in('id', createdReleases)
    createdReleases.length = 0
  }
  if (trackRevisionFloor) {
    await svc.from('revisions').delete().eq('artist_id', artistA)
      .eq('entity_type', 'track').gte('published_at', trackRevisionFloor)
    trackRevisionFloor = null
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

describe('reconcileOnSite', () => {
  it('shows the selected releases and hides the rest, touching only what changes', async () => {
    const live = await seedRelease({ slug: 'live', on_site: true }) // already on
    const off = await seedRelease({ slug: 'off', on_site: false }) // to turn on
    const drop = await seedRelease({ slug: 'drop', on_site: true }) // to turn off

    // Desired on-site set: keep `live`, add `off`, drop `drop`.
    const res = await reconcileOnSite(asA, 'release', artistA, [live, off])
    expect(res).toEqual({ shown: 1, hidden: 1 })

    const { data } = await svc.from('releases').select('id, on_site').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r.on_site]))
    expect(byId[live]).toBe(true)
    expect(byId[off]).toBe(true)
    expect(byId[drop]).toBe(false)
  })

  it('is a no-op when the selection already matches what is live', async () => {
    const a = await seedRelease({ slug: 'a', on_site: true })
    await seedRelease({ slug: 'b', on_site: false })
    const res = await reconcileOnSite(asA, 'release', artistA, [a])
    expect(res).toEqual({ shown: 0, hidden: 0 })
  })

  it('never touches an Unreleased release (dashboard-only; not in the on-site selection)', async () => {
    // A Released release that IS on-site but not in the selection would be hidden;
    // an Unreleased one (manual, no platform presence) must be left alone so it
    // isn't written on_site=false — a latent trap once promoted. (#11)
    const unreleased = await seedRelease({ slug: 'unrel', on_site: true, released: false })
    const res = await reconcileOnSite(asA, 'release', artistA, []) // select nothing
    expect(res).toEqual({ shown: 0, hidden: 0 })
    const { data } = await svc.from('releases').select('on_site').eq('id', unreleased).single()
    expect(data!.on_site).toBe(true) // untouched
  })

  it("CRITICAL: cannot flip another tenant's releases on-site", async () => {
    const bRel = await seedReleaseB({ slug: 'b-secret', on_site: false })

    // Manager A tries to publish B's release by id — RLS makes it a no-op.
    const res = await reconcileOnSite(asA, 'release', artistB, [bRel])
    expect(res).toEqual({ shown: 0, hidden: 0 })

    const { data } = await svc.from('releases').select('on_site').eq('id', bRel).single()
    expect(data!.on_site).toBe(false) // untouched
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
  const publish = async (onSiteIds: string[], password: string) => {
    const { publishReleasesAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    return publishReleasesAction(artistA, onSiteIds, password)
  }

  /** The releases already live for A. The publish under test only ADDS to that set:
   *  reconcile takes everything absent from the selection off the site, and this runs
   *  against the shared live project. */
  async function liveSelection(): Promise<string[]> {
    const { data } = await svc.from('releases').select('id').eq('artist_id', artistA).eq('on_site', true)
    return (data ?? []).map((r) => r.id as string)
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

    const res = await publish([...(await liveSelection()), rel], 'not-the-password')
    expect(res).toEqual({ ok: false, error: 'Incorrect password.' })

    // The flag and the snapshot are the load-bearing assertions: a gate that ran AFTER
    // the reconcile would return the same error with the release already on the site.
    const { data } = await svc.from('releases').select('on_site').eq('id', rel).single()
    expect(data!.on_site).toBe(false)
    expect(await revisionCount(rel)).toBe(0)
  })

  it('the same publish goes through with the right password', async () => {
    const rel = await seedRelease({ slug: 'gate-ok', on_site: false })

    trackRevisionFloor = new Date().toISOString()
    const res = await publish([...(await liveSelection()), rel], SEED_PASSWORD)
    expect(res).toEqual({ ok: true })

    const { data } = await svc.from('releases').select('on_site').eq('id', rel).single()
    expect(data!.on_site).toBe(true)
    expect(await revisionCount(rel)).toBe(1)
  })
})
