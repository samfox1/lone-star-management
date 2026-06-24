/**
 * MILESTONE 8 — per-store Shopify credentials via Supabase Vault (PLAN #3).
 *
 * The storefront token is the highest-value secret in the system. It is stored
 * in Vault (encrypted), and the integrations row holds only a secret_ref pointer
 * — never the raw token. Access is owner-only through SECURITY DEFINER
 * functions; no manager-readable column and no public path can ever reach it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

const DOMAIN = 'lonepine-test.myshopify.com'
const TOKEN = 'shptok_SECRET_must_never_leak_0xA1'
const TOKEN2 = 'shptok_SECRET_rotated_0xB2'

let artistA: string
let artistB: string
let asA: SupabaseClient
let asB: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)

  const { error } = await asA.rpc('connect_shopify', {
    p_artist_id: artistA,
    p_domain: DOMAIN,
    p_token: TOKEN,
  })
  if (error) throw new Error(`connect_shopify failed: ${error.message}`)
})

afterAll(async () => {
  await asA.rpc('disconnect_shopify', { p_artist_id: artistA })
  await svc.from('integrations').delete().eq('artist_id', artistA)
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
  })
})

describe('public read path', () => {
  it('CRITICAL: the public site never exposes integrations or the token', async () => {
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const blob = JSON.stringify(data)
    expect(blob).not.toContain(TOKEN)
    expect(blob).not.toContain('secret_ref')
    expect(data).not.toHaveProperty('integrations')
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
