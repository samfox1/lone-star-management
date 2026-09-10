/**
 * `shopify_store_for_slug` — the live lane's door (20260902130000).
 *
 * It hands back a store's DECRYPTED storefront token, keyed on a public slug, so its
 * only protection is the EXECUTE grant: service_role and nobody else. Unlike
 * `shopify_credentials` it cannot check is_manager_of, because a slug identifies an
 * artist rather than a caller — so if `authenticated` could reach it, any signed-in
 * manager could read every other artist's token by typing their slug.
 *
 * Every denial below is asserted against a store that REALLY EXISTS and a token the
 * service client can actually read back (AGENTS.md rule 2): without the plant these
 * would pass against an artist with no store at all, which proves nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const STORE = 'lone-pine-live-door.myshopify.com'
const TOKEN = 'test-storefront-token-live-door'

let artistA: string
let asA: SupabaseClient
let plantedMerchId: string
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)

  // Plant the store: a real Vault secret behind a real integrations row.
  const { error: connErr } = await asA.rpc('connect_shopify', {
    p_artist_id: artistA,
    p_domain: STORE,
    p_token: TOKEN,
  })
  if (connErr) throw new Error(`plant failed: ${connErr.message}`)

  // The door also requires PUBLISHED merch, so plant one row and one revision.
  const { data: row, error: merchErr } = await svc
    .from('merch')
    .insert({ artist_id: artistA, title: 'Live Door Fixture', source: 'manual' })
    .select('id')
    .single()
  if (merchErr) throw new Error(merchErr.message)
  plantedMerchId = row.id
  const { error: revErr } = await svc.from('revisions').insert({
    artist_id: artistA,
    entity_type: 'merch',
    entity_id: plantedMerchId,
    data: { id: plantedMerchId, title: 'Live Door Fixture' },
  })
  if (revErr) throw new Error(revErr.message)
})

afterAll(async () => {
  // Scoped to exactly the rows this file created (AGENTS.md rule 6).
  await svc.from('revisions').delete().eq('entity_id', plantedMerchId)
  await svc.from('merch').delete().eq('id', plantedMerchId)
  await asA.rpc('disconnect_shopify', { p_artist_id: artistA })
})

describe('shopify_store_for_slug', () => {
  it('CRITICAL: the plant is real — service_role reads the decrypted token back', async () => {
    // This runs FIRST and is the witness every denial below depends on. If this fails,
    // the denials are vacuous and mean nothing.
    const { data, error } = await svc.rpc('shopify_store_for_slug', { p_slug: SEED.artistASlug })
    expect(error).toBeNull()
    expect(data).toEqual([{ store_domain: STORE, token: TOKEN }])
  })

  it('CRITICAL: anon cannot execute it', async () => {
    const { error } = await anonClient().rpc('shopify_store_for_slug', { p_slug: SEED.artistASlug })
    // The specific code matters: PGRST202 ("function does not exist") would mean the
    // migration never landed, which is not the same as a closed door.
    expect(error?.code).toBe('42501')
  })

  it('CRITICAL: a signed-in manager cannot execute it, not even for their OWN artist', async () => {
    // The dangerous case is manager A reading artist B's token, but the grant is all
    // or nothing — so proving A is denied on their own slug proves the door is shut
    // for every authenticated caller.
    const { error } = await asA.rpc('shopify_store_for_slug', { p_slug: SEED.artistASlug })
    expect(error?.code).toBe('42501')
  })

  it('stays shut for an artist with no store connected', async () => {
    const { data, error } = await svc.rpc('shopify_store_for_slug', { p_slug: SEED.artistBSlug })
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('stays shut for a slug that does not exist', async () => {
    const { data, error } = await svc.rpc('shopify_store_for_slug', { p_slug: 'no-such-artist-xyz' })
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
