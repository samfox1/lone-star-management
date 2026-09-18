// The Shopify storefront token lives encrypted in Vault; the row holds only a pointer to it.
/**
 * MILESTONE 8 — per-store Shopify credentials via Supabase Vault (PLAN #3).
 *
 * The storefront token is the highest-value secret in the system. It is stored
 * in Vault (encrypted), and the integrations row holds only a secret_ref pointer
 * — never the raw token. Access is owner-only through SECURITY DEFINER
 * functions; no manager-readable column and no public path can ever reach it.
 *
 * TENANCY, AND WHY THE ARTISTS ARE THROWAWAYS. This file used to run on the shared seed
 * artists, and `integrations` is not a fixture table — it holds the artist's REAL
 * connected accounts. Two separate harms followed. On the way IN, `connect_shopify` on
 * the seed artist OVERWRITES a live store connection (the function updates in place; the
 * rotation test at the bottom is that same code path, proving it). On the way OUT,
 * `svc.from('integrations').delete().eq('artist_id', artistA)` removed every connection
 * the artist had, this file's or not — a manager's Shopify link, silently gone because a
 * test ran.
 *
 * Both artists are created and dropped by this file now. Teardown DISCONNECTS first and
 * drops the artist second, on purpose: `disconnect_shopify` is the only thing that
 * deletes the Vault secret (20260624120000), and there is no trigger behind the
 * integrations table — so cascading the row away without disconnecting would leave an
 * encrypted storefront token orphaned in `vault.secrets` forever, once per run.
 *
 * Note the public-door test: it resolves by SLUG, and get_public_site answers NULL until
 * an `artist` revision exists. On a fresh throwaway that null would satisfy every
 * "the token is not in the payload" assertion for free, so beforeAll publishes the
 * profile and the test asserts it is looking at a real payload first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishProfile } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

const DOMAIN = 'lonepine-test.myshopify.com'
const TOKEN = 'shptok_SECRET_must_never_leak_0xA1'
const TOKEN2 = 'shptok_SECRET_rotated_0xB2'

let a: ThrowawayArtist
let b: ThrowawayArtist
let artistA: string
let artistB: string
let asA: SupabaseClient
let asB: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  a = await createThrowawayArtist(svc, 'integrations A', asA)
  b = await createThrowawayArtist(svc, 'integrations B', asB)
  artistA = a.id
  artistB = b.id
  await publishProfile(asA, artistA)

  const { error } = await asA.rpc('connect_shopify', {
    p_artist_id: artistA,
    p_domain: DOMAIN,
    p_token: TOKEN,
  })
  if (error) throw new Error(`connect_shopify failed: ${error.message}`)
})

afterAll(async () => {
  // Disconnect BEFORE dropping the artists: the cascade removes the integrations row but
  // nothing removes the Vault secret it points at except disconnect_shopify. B is
  // normally already disconnected by its own test; the function is a no-op when there is
  // no row, so calling it unconditionally costs nothing and covers a failed run.
  await asA.rpc('disconnect_shopify', { p_artist_id: artistA })
  await asB.rpc('disconnect_shopify', { p_artist_id: artistB })
  await deleteThrowawayArtist(svc, a)
  await deleteThrowawayArtist(svc, b)
})

describe('storage', () => {
  it('CRITICAL: the integrations row holds a pointer, never the raw token', async () => {
    const { data: rows } = await asA.from('integrations').select('*').eq('artist_id', artistA)
    expect(rows).toHaveLength(1)
    const row = rows![0]
    expect(row.provider).toBe('shopify')
    expect(row.metadata.store_domain).toBe(DOMAIN)
    expect(row.secret_ref).toBeTruthy()
    expect(row.secret_ref).not.toBe(TOKEN)
    // The token must not appear anywhere in the readable row.
    expect(JSON.stringify(row)).not.toContain(TOKEN)
  })

  it('CRITICAL: the raw token is not in the integrations table even via service role', async () => {
    const { data } = await svc.from('integrations').select('*').eq('artist_id', artistA)
    expect(JSON.stringify(data)).not.toContain(TOKEN)
  })
})

describe('retrieval', () => {
  it('the owner can retrieve the decrypted token + domain', async () => {
    const { data, error } = await asA.rpc('shopify_credentials', { p_artist_id: artistA })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0]).toEqual({ store_domain: DOMAIN, token: TOKEN })
  })

  it("CRITICAL: a non-owner manager cannot retrieve another tenant's token", async () => {
    const { data, error } = await asB.rpc('shopify_credentials', { p_artist_id: artistA })
    // Authorized check raises, so this errors (and never returns the token).
    expect(error).not.toBeNull()
    expect(JSON.stringify(data)).not.toContain(TOKEN)
  })

  it('CRITICAL: an anonymous caller cannot retrieve the token', async () => {
    const { data, error } = await anonClient().rpc('shopify_credentials', { p_artist_id: artistA })
    expect(error).not.toBeNull()
    expect(JSON.stringify(data)).not.toContain(TOKEN)
  })
})

describe('authorization on connect', () => {
  it("CRITICAL: a non-owner cannot connect a store to another tenant", async () => {
    const { error } = await asB.rpc('connect_shopify', {
      p_artist_id: artistA,
      p_domain: 'evil.myshopify.com',
      p_token: 'evil-token',
    })
    expect(error).not.toBeNull()

    // The error alone is not the guarantee: connect_shopify UPDATES IN PLACE when a row
    // already exists (see the rotation test), so the attack is a redirected store and a
    // swapped token, and only A's credentials can say it did not happen. A's connection
    // is the planted witness — it was made in beforeAll, before anything was denied.
    const { data } = await asA.rpc('shopify_credentials', { p_artist_id: artistA })
    expect(data).toEqual([{ store_domain: DOMAIN, token: TOKEN }])
  })
})

describe('public read path', () => {
  it('CRITICAL: the public site never exposes integrations or the token', async () => {
    const { data } = await anonClient().rpc('get_public_site', { p_slug: a.slug })
    // A null payload would satisfy all three assertions below without the door ever
    // having decided anything. Prove the door is serving this artist first.
    expect(data, 'the door must be serving this artist at all').not.toBeNull()
    const blob = JSON.stringify(data)
    expect(blob).not.toContain(TOKEN)
    expect(blob).not.toContain('secret_ref')
    expect(data).not.toHaveProperty('integrations')
  })
})

describe('domain validation', () => {
  it('CRITICAL: rejects a non-myshopify.com domain (no token exfiltration host)', async () => {
    for (const bad of ['evil.com', 'lonepine.myshopify.com/x', 'lonepine.myshopify.com:1337']) {
      const { error } = await asA.rpc('connect_shopify', {
        p_artist_id: artistA,
        p_domain: bad,
        p_token: 'shptok_should_be_rejected',
      })
      expect(error).not.toBeNull()
    }
  })
})

describe('disconnect', () => {
  it('CRITICAL: removes the row, empties credentials, and destroys the secret', async () => {
    // Throwaway connect on artist B so the suite fixture on A is undisturbed.
    await asB.rpc('connect_shopify', {
      p_artist_id: artistB,
      p_domain: 'gulf-test.myshopify.com',
      p_token: 'shptok_disconnect_me_0xC3',
    })
    const before = await asB.rpc('shopify_credentials', { p_artist_id: artistB })
    expect(before.data).toHaveLength(1)

    const { error } = await asB.rpc('disconnect_shopify', { p_artist_id: artistB })
    expect(error).toBeNull()

    const { count } = await asB
      .from('integrations')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)

    // Empty credentials proves the row is gone AND the Vault secret is no longer
    // reachable (shopify_credentials joins decrypted_secrets by secret_ref).
    const after = await asB.rpc('shopify_credentials', { p_artist_id: artistB })
    expect(after.error).toBeNull()
    expect(after.data).toHaveLength(0)
  })

  it('CRITICAL: a non-owner cannot disconnect another tenant', async () => {
    const { error } = await asB.rpc('disconnect_shopify', { p_artist_id: artistA })
    expect(error).not.toBeNull()
    // The owner's connection is untouched.
    const { data } = await asA.rpc('shopify_credentials', { p_artist_id: artistA })
    expect(data).toHaveLength(1)
  })
})

describe('rotation', () => {
  it('reconnecting updates the token in place (still one row)', async () => {
    const { error } = await asA.rpc('connect_shopify', {
      p_artist_id: artistA,
      p_domain: DOMAIN,
      p_token: TOKEN2,
    })
    expect(error).toBeNull()

    const { count } = await asA
      .from('integrations')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistA)
    expect(count).toBe(1)

    const { data } = await asA.rpc('shopify_credentials', { p_artist_id: artistA })
    expect(data[0].token).toBe(TOKEN2)
  })
})
