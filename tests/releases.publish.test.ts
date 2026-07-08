/**
 * Release publish — the on-site visibility reconcile + the password gate.
 *
 * The public site gates on each release's `visible` flag. Managers pick which
 * releases are on the site and commit with a password-gated publish. This covers:
 *  - reconcileReleaseVisibility flips exactly the releases that should change,
 *    both directions, and is RLS-scoped (can't touch another tenant);
 *  - the password gate: signing in with the wrong password fails, the right one
 *    succeeds (this is the check publishReleasesAction runs before it writes).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileReleaseVisibility } from '@/lib/content'
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

/** Insert a release for artistA and return its id. */
async function seedRelease(over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await svc
    .from('releases')
    .insert({ artist_id: artistA, title: 'R', slug: 'r', ...over })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data!.id as string
}

describe('reconcileReleaseVisibility', () => {
  it('shows the selected releases and hides the rest, touching only what changes', async () => {
    const live = await seedRelease({ slug: 'live', visible: true }) // already on
    const off = await seedRelease({ slug: 'off', visible: false }) // to turn on
    const drop = await seedRelease({ slug: 'drop', visible: true }) // to turn off

    // Desired on-site set: keep `live`, add `off`, drop `drop`.
    const res = await reconcileReleaseVisibility(asA, artistA, [live, off])
    expect(res).toEqual({ shown: 1, hidden: 1 })

    const { data } = await svc.from('releases').select('id, visible').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r.visible]))
    expect(byId[live]).toBe(true)
    expect(byId[off]).toBe(true)
    expect(byId[drop]).toBe(false)
  })

  it('is a no-op when the selection already matches what is live', async () => {
    const a = await seedRelease({ slug: 'a', visible: true })
    await seedRelease({ slug: 'b', visible: false })
    const res = await reconcileReleaseVisibility(asA, artistA, [a])
    expect(res).toEqual({ shown: 0, hidden: 0 })
  })

  it("CRITICAL: cannot flip another tenant's releases visible", async () => {
    const { data: bRel } = await svc
      .from('releases')
      .insert({ artist_id: artistB, title: 'B', slug: 'b-secret', visible: false })
      .select('id')
      .single()

    // Manager A tries to publish B's release by id — RLS makes it a no-op.
    const res = await reconcileReleaseVisibility(asA, artistB, [bRel!.id as string])
    expect(res).toEqual({ shown: 0, hidden: 0 })

    const { data } = await svc.from('releases').select('visible').eq('id', bRel!.id as string).single()
    expect(data!.visible).toBe(false) // untouched
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
