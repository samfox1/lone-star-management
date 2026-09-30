/**
 * The registration's database side, against the real table: the SERVICE client upserts, reruns,
 * marks, removes and connects exactly as registerSite expects.
 *
 * Code:     src/lib/search-engines/register-store.ts (supabaseStore)
 * Feature:  Add website · registering a site with Google and Bing (ADD_WEBSITE_PLAN.md step 4)
 * Tier:     STRICT (AGENTS.md "Test depth"): stored registrations and which site an artist is
 *           attached to. The post-push audit's rules: every write through the service client, an
 *           upsert on (artist_id, provider) so a rerun is clean, a failed run's rows removable.
 *           Every row lives on a throwaway artist (rule 6).
 * Covers:   • upsert twice is one row per provider; `reset` nulls verified_at, no reset keeps it
 *           • mark: verified stamps verified_at and clears or keeps the reason code
 *           • restore puts a row back exactly; remove deletes only the providers named
 *           • holderOf finds another artist on the address, never the artist itself
 *           • connect attaches the site (the service role passes the address guard)
 * Not here: the order of the steps (tests/unit/search-engines/register.test.ts); who may read or
 *           write the table (site-verifications.test.ts).
 * Fixtures: the HOSTED project, the service client, two throwaway artists made and deleted here.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supabaseStore } from '@/lib/search-engines/register-store'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { serviceClient } from '@tests/helpers/supabase'

const G = 'ptl8bmwM1LyyV7c1h9f8Jkz9aQ-lsnRVg5ZlwCmG1ZI'
const G2 = 'zzl8bmwM1LyyV7c1h9f8Jkz9aQ-lsnRVg5ZlwCmG1ZI'
const B = 'DFA80FE427DDB6FD866F4B6A6564E412'

describe('supabaseStore', () => {
  const svc = serviceClient()
  const store = supabaseStore(svc)
  let a: ThrowawayArtist
  let b: ThrowawayArtist
  const site = `https://www.tw-${randomUUID().slice(0, 8)}.example/`

  const row = async (artistId: string, provider: string) => (await store.rowsOf(artistId)).find((r) => r.provider === provider)

  beforeAll(async () => {
    a = await createThrowawayArtist(svc, 'register store A')
    b = await createThrowawayArtist(svc, 'register store B')
  })

  afterAll(async () => {
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, b)
  })

  // A first run stores both codes; a rerun with the same codes is still one row each.
  it('upserts one row per provider, rerun or not', async () => {
    await store.upsert(a.id, [{ provider: 'google', site_url: site, code: G, reset: true }, { provider: 'bing', site_url: site, code: B, reset: true }])
    await store.upsert(a.id, [{ provider: 'google', site_url: site, code: G, reset: false }, { provider: 'bing', site_url: site, code: B, reset: false }])
    const rows = await store.rowsOf(a.id)
    expect(rows.map((r) => r.provider).sort()).toEqual(['bing', 'google'])
  })

  // Verified stamps the time; a failure keeps its reason code.
  it('marks a provider verified, or failed with its reason', async () => {
    await store.mark(a.id, 'google', { verified: true, error_code: null })
    await store.mark(a.id, 'bing', { verified: false, error_code: 'bing_verify' })
    expect(await row(a.id, 'google')).toMatchObject({ error_code: null, verified_at: expect.any(String) })
    expect(await row(a.id, 'bing')).toMatchObject({ error_code: 'bing_verify', verified_at: null })
  })

  // A rerun with the same code keeps the verified time; a new code un-verifies until re-verified.
  it('keeps verified_at without reset and clears it with reset', async () => {
    const before = (await row(a.id, 'google'))!.verified_at
    await store.upsert(a.id, [{ provider: 'google', site_url: site, code: G, reset: false }])
    expect((await row(a.id, 'google'))!.verified_at).toBe(before)
    await store.upsert(a.id, [{ provider: 'google', site_url: site, code: G2, reset: true }])
    expect(await row(a.id, 'google')).toMatchObject({ code: G2, verified_at: null, error_code: null })
  })

  // Another artist on the same address is found; the artist itself never counts.
  it('finds another artist holding the address, never the artist itself', async () => {
    expect(await store.holderOf(site, a.id)).toBeNull()
    expect(await store.holderOf(site, b.id)).toBe(a.id)
  })

  // A failed rerun puts a row back exactly as it was: address, code, verified time, reason.
  it('restores a row exactly', async () => {
    const was = (await row(a.id, 'bing'))!
    await store.upsert(a.id, [{ provider: 'bing', site_url: `https://moved-${site.slice(8)}`, code: '0'.repeat(32), reset: true }])
    await store.restore(a.id, [{ ...was, error_code: 'not_live' }])
    expect(await row(a.id, 'bing')).toEqual({ ...was, error_code: 'not_live' })
  })

  // A failed run removes only what it names.
  it('removes only the providers named', async () => {
    await store.remove(a.id, ['bing'])
    expect((await store.rowsOf(a.id)).map((r) => r.provider)).toEqual(['google'])
  })

  // Connecting is a service-role write the address guard lets through.
  it('connects the site to the artist', async () => {
    await store.connect(b.id, 'https://www.tw-connect.example')
    expect(await store.siteOf(b.id)).toEqual({ site_kind: 'custom', custom_site_url: 'https://www.tw-connect.example' })
  })
})
