// A Shopify row can only read, renew or delete the Vault secret bound to its own artist.
/**
 * PENDING MIGRATION: supabase/migrations/20260929150000_shopify_secret_binding.sql (written
 * 2026-09-29, NOT pushed). Until it is pushed this whole file SKIPS itself. The probe asks the
 * one thing the migration changes for everybody: may a signed-in manager UPDATE integrations
 * at all? Before it, an update matching no row succeeds silently (error null) and the file
 * skips; after it, Postgres refuses the statement (42501) whatever it matches, and the file
 * runs. Any OTHER answer (a network failure) also runs the file, so it fails loudly instead of
 * skipping quietly.
 *
 * THE HOLE (security review 2026-09-29). `integrations_rw` is FOR ALL to a manager and stock
 * Supabase grants `authenticated` UPDATE, so a manager could repoint their own row's
 * `secret_ref` at another artist's Vault secret; `shopify_credentials` then DECRYPTED it,
 * `connect_shopify` OVERWROTE it and `disconnect_shopify` DELETED it. The migration closes it
 * twice: the pointer is no longer writable by managers, and every Shopify door checks the
 * secret is bound to its artist (description 'shopify:<artist_id>'). The binding tests plant a
 * repoint with the SERVICE role (the only writer left), to prove the second layer on its own.
 *
 * Throwaway artists only (AGENTS.md rule 6), never Skeen. Every Vault secret a test creates is
 * destroyed through `disconnect_shopify` before its artist is dropped: the cascade would
 * otherwise orphan the encrypted token in `vault.secrets`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectRlsDenied } from '@tests/helpers/rls'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

const DOMAIN_A = 'binding-a-test.myshopify.com'
const DOMAIN_B = 'binding-b-test.myshopify.com'
const TOKEN_A = 'shptok_SECRET_binding_A_0xC1'
const TOKEN_A2 = 'shptok_SECRET_binding_A2_0xC2'
const TOKEN_B = 'shptok_SECRET_binding_B_0xC3'
const EB_TOKEN_B = 'EBTOKEN_SECRET_binding_B_0xC4'
const NO_ROW = '00000000-0000-4000-8000-000000000000'

const svc = serviceClient()
const probeClient = await signInAs(SEED.managerA)
const probe = await probeClient.from('integrations').update({ secret_ref: null }).eq('id', NO_ROW)
const PENDING = probe.error === null
const ebProbe = await svc.rpc('eventbrite_credentials', { p_artist_id: NO_ROW })
const EVENTBRITE_PENDING = ebProbe.error?.code === 'PGRST202'

describe.skipIf(PENDING)(
  PENDING ? 'PENDING MIGRATION 20260929150000 (not pushed): Shopify secret binding — skipped' : 'Shopify: the Vault secret is tied to its artist',
  () => {
    let a: ThrowawayArtist
    let b: ThrowawayArtist
    let asA: SupabaseClient
    let asB: SupabaseClient
    let merchId: string

    const creds = (who: SupabaseClient, artist: string) => who.rpc('shopify_credentials', { p_artist_id: artist })
    const row = async (artist: string, provider = 'shopify') =>
      (await svc.from('integrations').select('id, secret_ref, metadata').eq('artist_id', artist).eq('provider', provider).maybeSingle()).data as
        | { id: string; secret_ref: string; metadata: Record<string, string> }
        | null
    /** Point A's Shopify row at `ref`, as only the service role can now. */
    const pointA = (ref: string) =>
      svc.from('integrations').upsert({ artist_id: a.id, provider: 'shopify', secret_ref: ref, metadata: { store_domain: DOMAIN_A } }, { onConflict: 'artist_id,provider' })
    /** Destroy a secret bound to A through the only door that can: point at it, then Remove. */
    const destroyA = async (ref: string) => {
      await pointA(ref)
      const { error } = await asA.rpc('disconnect_shopify', { p_artist_id: a.id })
      if (error) throw new Error(`disconnect_shopify failed: ${error.message}`)
    }

    beforeAll(async () => {
      asA = await signInAs(SEED.managerA)
      asB = await signInAs(SEED.managerB)
      a = await createThrowawayArtist(svc, 'shopify binding A', asA)
      b = await createThrowawayArtist(svc, 'shopify binding B', asB)
      for (const [who, artist, domain, token] of [[asA, a, DOMAIN_A, TOKEN_A], [asB, b, DOMAIN_B, TOKEN_B]] as const) {
        const { error } = await who.rpc('connect_shopify', { p_artist_id: artist.id, p_domain: domain, p_token: token })
        if (error) throw new Error(`connect_shopify failed: ${error.message}`)
      }
      // The live lane's door answers only for an artist with PUBLISHED merch.
      const { data: m, error: mErr } = await svc.from('merch').insert({ artist_id: a.id, title: 'Binding Fixture', source: 'manual' }).select('id').single()
      if (mErr) throw new Error(mErr.message)
      merchId = m.id
      const { error: rErr } = await svc.from('revisions').insert({ artist_id: a.id, entity_type: 'merch', entity_id: merchId, data: { id: merchId, title: 'Binding Fixture' } })
      if (rErr) throw new Error(rErr.message)
    })

    afterAll(async () => {
      if (asA && a) await asA.rpc('disconnect_shopify', { p_artist_id: a.id })
      if (asB && b) {
        await asB.rpc('disconnect_shopify', { p_artist_id: b.id })
        if (!EVENTBRITE_PENDING) await asB.rpc('disconnect_eventbrite', { p_artist_id: b.id })
      }
      if (merchId) {
        await svc.from('revisions').delete().eq('entity_id', merchId)
        await svc.from('merch').delete().eq('id', merchId)
      }
      await deleteThrowawayArtist(svc, a)
      await deleteThrowawayArtist(svc, b)
    })

    it('witness: each owner reads their own token, and the live lane reads A’s', async () => {
      expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
      expect((await creds(asB, b.id)).data).toEqual([{ store_domain: DOMAIN_B, token: TOKEN_B }])
      expect((await svc.rpc('shopify_store_for_slug', { p_slug: a.slug })).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
    })

    describe('layer 1: only the definer functions write the pointer', () => {
      it('CRITICAL: a manager cannot repoint their OWN row at another artist’s secret (42501), and nothing changes', async () => {
        const before = await row(a.id)
        const bRef = (await row(b.id))!.secret_ref
        expect(before?.secret_ref).toMatch(/^[0-9a-f-]{36}$/) // the row exists: the denial is not over nothing
        const { error } = await asA.from('integrations').update({ secret_ref: bRef }).eq('artist_id', a.id).eq('provider', 'shopify')
        expectRlsDenied(error, 'manager repointing their own secret_ref')
        expect(await row(a.id)).toEqual(before)
        expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
      })

      it('CRITICAL: nor rewrite the store domain around connect_shopify’s check', async () => {
        const before = await row(a.id)
        const { error } = await asA.from('integrations').update({ metadata: { store_domain: 'evil.example.com' } }).eq('artist_id', a.id).eq('provider', 'shopify')
        expectRlsDenied(error, 'manager rewriting store_domain')
        expect(await row(a.id)).toEqual(before)
      })

      it('CRITICAL: nor insert a row of their own that names someone else’s secret', async () => {
        const bRef = (await row(b.id))!.secret_ref
        const { error } = await asA.from('integrations').insert({ artist_id: a.id, provider: 'shopify-forged', secret_ref: bRef })
        expectRlsDenied(error, 'manager inserting a forged integrations row')
        expect(await row(a.id, 'shopify-forged')).toBeNull()
      })

      it('the manager can still read their own row (the dashboard does)', async () => {
        const { data, error } = await asA.from('integrations').select('metadata').eq('artist_id', a.id).eq('provider', 'shopify').maybeSingle()
        expect(error).toBeNull()
        expect(data).toEqual({ metadata: { store_domain: DOMAIN_A } })
      })
    })

    describe('layer 2: every door checks the binding (a repoint planted by the service role)', () => {
      it('CRITICAL: a row pointed at another artist’s secret reads nothing, through either door', async () => {
        const aRef = (await row(a.id))!.secret_ref
        const bRef = (await row(b.id))!.secret_ref
        await pointA(bRef)
        try {
          expect((await creds(asA, a.id)).data).toEqual([])
          expect((await svc.rpc('shopify_store_for_slug', { p_slug: a.slug })).data).toEqual([])
        } finally {
          await pointA(aRef)
        }
        expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
      })

      it('CRITICAL: Remove through it deletes A’s row but leaves B’s secret alone', async () => {
        const aRef = (await row(a.id))!.secret_ref
        const bRef = (await row(b.id))!.secret_ref
        await pointA(bRef)
        const { error } = await asA.rpc('disconnect_shopify', { p_artist_id: a.id })
        expect(error).toBeNull()
        expect(await row(a.id)).toBeNull()
        expect((await creds(asB, b.id)).data).toEqual([{ store_domain: DOMAIN_B, token: TOKEN_B }])
        // A's own secret was never touched either: point back at it and it reads.
        await pointA(aRef)
        expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
      })

      it('CRITICAL: Connect through it never overwrites B’s token; A gets a fresh secret of its own', async () => {
        const aRef = (await row(a.id))!.secret_ref
        const bRef = (await row(b.id))!.secret_ref
        await pointA(bRef)
        const { error } = await asA.rpc('connect_shopify', { p_artist_id: a.id, p_domain: DOMAIN_A, p_token: TOKEN_A2 })
        expect(error).toBeNull()
        expect((await creds(asB, b.id)).data).toEqual([{ store_domain: DOMAIN_B, token: TOKEN_B }])
        const aNew = (await row(a.id))!.secret_ref
        expect([aNew === bRef, aNew === aRef]).toEqual([false, false])
        expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A2 }])
        // Tidy: A's first secret is now pointed at by nothing. Destroy both through the door,
        // then connect A again for the tests that follow.
        await destroyA(aRef)
        await destroyA(aNew)
        const again = await asA.rpc('connect_shopify', { p_artist_id: a.id, p_domain: DOMAIN_A, p_token: TOKEN_A })
        expect(again.error).toBeNull()
        expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
      })

      it.skipIf(EVENTBRITE_PENDING)('CRITICAL: a Shopify row pointed at an EVENTBRITE secret reads nothing (the doors do not cross)', async () => {
        const { error: ebErr } = await asB.rpc('connect_eventbrite', { p_artist_id: b.id, p_organization_id: '901', p_organizer_id: '902', p_token: EB_TOKEN_B })
        expect(ebErr).toBeNull()
        const ebRef = (await row(b.id, 'eventbrite'))!.secret_ref
        const aRef = (await row(a.id))!.secret_ref
        await pointA(ebRef)
        try {
          const { data } = await creds(asA, a.id)
          expect(data).toEqual([])
          expect(JSON.stringify(data)).not.toContain(EB_TOKEN_B)
        } finally {
          await pointA(aRef)
        }
      })
    })
  },
)
