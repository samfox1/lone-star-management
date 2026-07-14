/**
 * Release publish — the on-site visibility reconcile + the password gate.
 *
 * The public site gates on each release's `on_site` flag. Managers pick which
 * releases are on the site and commit with a password-gated publish. This covers:
 *  - reconcileOnSite flips exactly the releases that should change,
 *    both directions, and is RLS-scoped (can't touch another tenant);
 *  - the password gate: signing in with the wrong password fails, the right one
 *    succeeds (this is the check publishReleasesAction runs before it writes).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileOnSite } from '@/lib/content'
import {
  SEED,
  SEED_PASSWORD,
  anonClient,
  artistIdBySlug,
  serviceClient,
  signInAs,
} from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  await svc.from('releases').delete().eq('artist_id', artistA)
  await svc.from('releases').delete().eq('artist_id', artistB)
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
    const { data: bRel } = await svc
      .from('releases')
      .insert({ artist_id: artistB, title: 'B', slug: 'b-secret', on_site: false })
      .select('id')
      .single()

    // Manager A tries to publish B's release by id — RLS makes it a no-op.
    const res = await reconcileOnSite(asA, 'release', artistB, [bRel!.id as string])
    expect(res).toEqual({ shown: 0, hidden: 0 })

    const { data } = await svc.from('releases').select('on_site').eq('id', bRel!.id as string).single()
    expect(data!.on_site).toBe(false) // untouched
  })
})

describe('publish password gate', () => {
  it('rejects the wrong password and accepts the right one', async () => {
    const bad = await anonClient().auth.signInWithPassword({
      email: SEED.managerA,
      password: 'not-the-password',
    })
    expect(bad.error).toBeTruthy() // wrong password → publishReleasesAction returns an error

    const good = await anonClient().auth.signInWithPassword({
      email: SEED.managerA,
      password: SEED_PASSWORD,
    })
    expect(good.error).toBeNull() // correct password → publish proceeds
  })
})
