/**
 * A Shopify connection can only read, renew or delete the stored store token (in Vault) that
 * belongs to its own artist, even if its pointer is aimed at another artist's.
 *
 * Code:     supabase/migrations/20260929150000_shopify_secret_binding.sql (integrations grants,
 *           shopify_secret_bindings, shopify_credentials, shopify_store_for_slug, connect_shopify,
 *           disconnect_shopify, bind_legacy_shopify_secrets)
 * Feature:  Merch / Shopify: the stored store token behind the shop on an artist's site
 * Tier:     STRICT (AGENTS.md "Test depth"): security and money. A manager could aim their own
 *           row's pointer at another artist's secret; the doors then DECRYPTED, OVERWROTE or
 *           DELETED it (security review 2026-09-29).
 * Covers:   • layer 1: a manager cannot repoint, rewrite, insert or delete integrations rows, nor
 *             touch the bindings table or run the backfill; they can still read their own row
 *           • layer 2: every door checks the binding, so a pointer at another artist's secret
 *             (planted by the service role) reads nothing, Remove leaves that secret alone, and
 *             Connect makes a fresh secret instead of overwriting it
 *           • a Shopify row pointed at an Eventbrite secret reads nothing (the doors do not cross)
 *           • the one-time backfill binds a secret only when exactly one Shopify row points at
 *             it, however that pointer is spelled, and never binds an Eventbrite secret
 * Not here: the Eventbrite sign-in's own storage (tests/integration/sync/eventbrite-vault.test.ts);
 *           Shopify connect in the dashboard (tests/integration/sync/integrations.test.ts).
 * Fixtures: TALKS TO THE HOSTED DATABASE. Two throwaway artists (AGENTS.md rule 6), never Skeen;
 *           every Vault secret a test creates is destroyed through `disconnect_shopify` before its
 *           artist is dropped, or the cascade would orphan the encrypted token. Repoints are
 *           planted with the service role, the only writer left.
 *
 * PENDING MIGRATION: 20260929150000 was written 2026-09-29 and is NOT pushed. Until it is, this
 * whole file SKIPS itself. The probe asks the one thing the migration changes for everybody: may
 * a signed-in manager UPDATE integrations at all? Before it, an update matching no row succeeds
 * silently (error null) and the file skips; after it, Postgres refuses the statement (42501)
 * whatever it matches, and the file runs. Any other answer (a network failure) also runs the
 * file, so it fails loudly instead of skipping quietly. The two Eventbrite cases also wait for
 * 20260929120500 (EVENTBRITE_PENDING).
 *
 * The backfill runs once at push, on real tokens, and cannot safely be re-run by hand, so it is a
 * function and these tests run it again on throwaway artists: a secret whose binding row is
 * deleted is exactly what an old connect_shopify left behind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectExecuteDenied, expectRlsDenied } from '@tests/helpers/rls'
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
    /** Which artist a secret is bound to (service role), or null. */
    const bindingOf = async (secret: string) =>
      ((await svc.from('shopify_secret_bindings').select('artist_id').eq('secret_id', secret).maybeSingle()).data as { artist_id: string } | null)?.artist_id ?? null
    /** Make A's secret look like one an old connect_shopify left: no binding row. */
    const unbindA = async () => {
      const ref = (await row(a.id))!.secret_ref
      await svc.from('shopify_secret_bindings').delete().eq('secret_id', ref)
      expect(await bindingOf(ref)).toBeNull()
      return ref
    }
    const backfill = async () => {
      const { data, error } = await svc.rpc('bind_legacy_shopify_secrets')
      expect(error).toBeNull()
      return data as number
    }
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

    // Witness: before anything is tampered with, each owner reads their own token and the live
    // shop reads A's, so every "reads nothing" below means the guard, not a broken setup.
    it('witness: each owner reads their own token, and the live lane reads A’s', async () => {
      expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
      expect((await creds(asB, b.id)).data).toEqual([{ store_domain: DOMAIN_B, token: TOKEN_B }])
      expect((await svc.rpc('shopify_store_for_slug', { p_slug: a.slug })).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
    })

    describe('layer 1: only the definer functions write the pointer', () => {
      // The hole itself: a manager aiming their own row's pointer at another artist's secret is
      // refused, and the row and its token are unchanged.
      it('CRITICAL: a manager cannot repoint their OWN row at another artist’s secret (42501), and nothing changes', async () => {
        const before = await row(a.id)
        const bRef = (await row(b.id))!.secret_ref
        expect(before?.secret_ref).toMatch(/^[0-9a-f-]{36}$/) // the row exists: the denial is not over nothing
        const { error } = await asA.from('integrations').update({ secret_ref: bRef }).eq('artist_id', a.id).eq('provider', 'shopify')
        expectRlsDenied(error, 'manager repointing their own secret_ref')
        expect(await row(a.id)).toEqual(before)
        expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
      })

      // Nor can they change the store domain directly, skipping connect_shopify's check.
      it('CRITICAL: nor rewrite the store domain around connect_shopify’s check', async () => {
        const before = await row(a.id)
        const { error } = await asA.from('integrations').update({ metadata: { store_domain: 'evil.example.com' } }).eq('artist_id', a.id).eq('provider', 'shopify')
        expectRlsDenied(error, 'manager rewriting store_domain')
        expect(await row(a.id)).toEqual(before)
      })

      // Nor add a second row of their own that names someone else's secret.
      it('CRITICAL: nor insert a row of their own that names someone else’s secret', async () => {
        const bRef = (await row(b.id))!.secret_ref
        const { error } = await asA.from('integrations').insert({ artist_id: a.id, provider: 'shopify-forged', secret_ref: bRef })
        expectRlsDenied(error, 'manager inserting a forged integrations row')
        expect(await row(a.id, 'shopify-forged')).toBeNull()
      })

      // Nor delete their own row directly: the encrypted token would be left behind in Vault.
      it('CRITICAL: nor delete their own row (which would orphan the token in Vault)', async () => {
        const before = await row(a.id)
        expect(before).not.toBeNull()
        const { error } = await asA.from('integrations').delete().eq('artist_id', a.id).eq('provider', 'shopify')
        expectRlsDenied(error, 'manager deleting their own integrations row')
        expect(await row(a.id)).toEqual(before)
      })

      // The bindings table (which artist owns which secret) is out of a manager's reach both ways.
      it('CRITICAL: nor read or write the bindings table', async () => {
        const read = await asA.from('shopify_secret_bindings').select('secret_id')
        expectRlsDenied(read.error, 'manager reading shopify_secret_bindings')
        const bRef = (await row(b.id))!.secret_ref
        const write = await asA.from('shopify_secret_bindings').insert({ secret_id: bRef, artist_id: a.id })
        expectRlsDenied(write.error, 'manager binding another artist’s secret to theirs')
        expect(await bindingOf(bRef)).toBe(b.id)
      })

      // Only the push runs the backfill; a manager cannot.
      it('CRITICAL: nor run the backfill', async () => {
        expectExecuteDenied((await asA.rpc('bind_legacy_shopify_secrets')).error, 'bind_legacy_shopify_secrets')
      })

      // Reading their own row still works: the dashboard shows the store domain from it.
      it('the manager can still read their own row (the dashboard does)', async () => {
        const { data, error } = await asA.from('integrations').select('metadata').eq('artist_id', a.id).eq('provider', 'shopify').maybeSingle()
        expect(error).toBeNull()
        expect(data).toEqual({ metadata: { store_domain: DOMAIN_A } })
      })
    })

    describe('layer 2: every door checks the binding (a repoint planted by the service role)', () => {
      // A's row aimed at B's secret reads nothing, through the manager's door or the live shop's.
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

      // Remove through a pointer at B's secret deletes A's row only; B's token still reads.
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

      // Connect through a pointer at B's secret never overwrites B's token; A gets a new secret.
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

      // A Shopify row aimed at an Eventbrite sign-in reads nothing: each door reads only its own kind.
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

    describe('the backfill (bind_legacy_shopify_secrets): one pointer, one owner, or nobody', () => {
      // Witness: a secret with no binding row reads nothing, so the binding really is the gate.
      it('witness: an unbound secret reads nothing, so the binding really is the gate', async () => {
        const ref = await unbindA()
        try {
          expect((await creds(asA, a.id)).data).toEqual([])
        } finally {
          expect(await backfill()).toBeGreaterThanOrEqual(1)
          expect(await bindingOf(ref)).toBe(a.id)
        }
      })

      // The normal legacy case: one Shopify row points at the secret, so it is bound to that
      // artist and reads again; a second run binds nothing more.
      it('CRITICAL: a secret only its own Shopify row points at is bound to that artist, and reads again', async () => {
        const ref = await unbindA()
        expect(await backfill()).toBeGreaterThanOrEqual(1)
        expect(await bindingOf(ref)).toBe(a.id)
        expect((await creds(asA, a.id)).data).toEqual([{ store_domain: DOMAIN_A, token: TOKEN_A }])
        expect(await backfill()).toBe(0) // idempotent: nothing left to bind
      })

      for (const [label, spell] of [
        ['UPPER CASE', (u: string) => u.toUpperCase()],
        ['braces', (u: string) => `{${u}}`],
        ['no hyphens', (u: string) => u.replace(/-/g, '')],
      ] as const) {
        // Two rows reaching one secret (the second spelling it differently) means the owner is
        // unclear, so nobody is bound and neither row reads it (security review F1).
        it(`CRITICAL: a second row reaching the same secret in ${label} blocks the binding; neither row reads it`, async () => {
          const ref = await unbindA()
          const bRef = (await row(b.id))!.secret_ref
          // The old hole, used before the push: B's row names A's secret, spelled differently.
          await svc.from('integrations').update({ secret_ref: spell(ref) }).eq('artist_id', b.id).eq('provider', 'shopify')
          try {
            await backfill()
            expect(await bindingOf(ref)).toBeNull()
            expect((await creds(asA, a.id)).data).toEqual([])
            expect(JSON.stringify((await creds(asB, b.id)).data)).not.toContain(TOKEN_A)
          } finally {
            await svc.from('integrations').update({ secret_ref: bRef }).eq('artist_id', b.id).eq('provider', 'shopify')
            await backfill()
          }
          expect(await bindingOf(ref)).toBe(a.id)
          expect((await creds(asB, b.id)).data).toEqual([{ store_domain: DOMAIN_B, token: TOKEN_B }])
        })
      }

      // An Eventbrite sign-in is never bound to a Shopify row, even when that row is its only pointer.
      it.skipIf(EVENTBRITE_PENDING)('CRITICAL: a described secret (an Eventbrite sign-in) is never bound to a Shopify row, even as its only pointer', async () => {
        const { error: ebErr } = await asB.rpc('connect_eventbrite', { p_artist_id: b.id, p_organization_id: '911', p_organizer_id: '912', p_token: EB_TOKEN_B })
        expect(ebErr).toBeNull()
        const eb = (await row(b.id, 'eventbrite'))!
        const aRef = (await row(a.id))!.secret_ref
        // Leave A's Shopify row as the ONLY pointer to B's Eventbrite secret.
        await svc.from('integrations').delete().eq('id', eb.id)
        await pointA(eb.secret_ref)
        try {
          await backfill()
          expect(await bindingOf(eb.secret_ref)).toBeNull()
          expect(JSON.stringify((await creds(asA, a.id)).data)).not.toContain(EB_TOKEN_B)
        } finally {
          await pointA(aRef)
          await svc.from('integrations').insert({ artist_id: b.id, provider: 'eventbrite', secret_ref: eb.secret_ref, metadata: eb.metadata })
        }
      })
    })
  },
)
