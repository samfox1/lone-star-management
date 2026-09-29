/**
 * An artist's Eventbrite sign-in is stored encrypted in the database's locked store (Vault),
 * bound to that artist: only its own manager can read, renew or remove it.
 *
 * Code:     supabase/migrations/20260929120500_eventbrite_integration.sql (connect_eventbrite,
 *           eventbrite_credentials, disconnect_eventbrite)
 * Feature:  Connect with Eventbrite (Connections page): the stored sign-in behind "shows pull
 *           into Tour"
 * Tier:     STRICT (AGENTS.md "Test depth"): security. A stored login is someone's password to
 *           their Eventbrite account.
 * Covers:   • the integrations row holds only a pointer and which organizer, never the token
 *           • the owner reads the token back; another artist's manager and anonymous visitors
 *             cannot, nor connect, nor remove it
 *           • ids must be digits and the token present, and a refusal changes nothing
 *           • a pointer aimed at another artist's secret reads nothing and deletes nothing
 *           • the public site never carries the token or the pointer
 *           • connecting again renews in place; Remove deletes the row AND destroys the secret
 * Not here: the Shopify twin (tests/integration/sync/integrations.test.ts); a manager being
 *           refused when rewriting the pointer at all (tests/integration/shopify/shopify-secret-binding.test.ts);
 *           the sign-in trip itself (tests/unit/manager-tools/connections/eventbrite-oauth*.test.ts).
 * Fixtures: TALKS TO THE HOSTED DATABASE. Two throwaway artists (AGENTS.md rule 6), never Skeen;
 *           teardown disconnects before dropping them, or the cascade would orphan the encrypted
 *           token in `vault.secrets`. Repoints are planted with the service role.
 *
 * PENDING MIGRATION: 20260929120500 was written 2026-09-28 and is NOT pushed. Until it is, this
 * whole file SKIPS itself: the probe below asks for `eventbrite_credentials` and skips only on
 * PGRST202 ("could not find the function"). Any other answer runs the suite, so a pushed
 * migration turns it on by itself and a network failure fails loudly instead of skipping.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishProfile } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectExecuteDenied } from '@tests/helpers/rls'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

const TOKEN = 'EBTOKEN_SECRET_must_never_leak_0xE1'
const TOKEN_B = 'EBTOKEN_SECRET_artist_b_0xE2'
const TOKEN2 = 'EBTOKEN_SECRET_rotated_0xE3'

const svc = serviceClient()
const probe = await svc.rpc('eventbrite_credentials', { p_artist_id: '00000000-0000-4000-8000-000000000000' })
const PENDING = probe.error?.code === 'PGRST202'

describe.skipIf(PENDING)(PENDING ? 'PENDING MIGRATION 20260929120500 (not pushed): Eventbrite Vault — skipped' : 'Eventbrite sign-in in Vault', () => {
  let a: ThrowawayArtist
  let b: ThrowawayArtist
  let asA: SupabaseClient
  let asB: SupabaseClient

  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    asB = await signInAs(SEED.managerB)
    a = await createThrowawayArtist(svc, 'eventbrite vault A', asA)
    b = await createThrowawayArtist(svc, 'eventbrite vault B', asB)
    await publishProfile(asA, a.id)
    const { error } = await asA.rpc('connect_eventbrite', { p_artist_id: a.id, p_organization_id: '111', p_organizer_id: '222', p_token: TOKEN })
    if (error) throw new Error(`connect_eventbrite failed: ${error.message}`)
  })

  afterAll(async () => {
    if (asA && a) await asA.rpc('disconnect_eventbrite', { p_artist_id: a.id })
    if (asB && b) await asB.rpc('disconnect_eventbrite', { p_artist_id: b.id })
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, b)
  })

  const creds = (who: SupabaseClient, artist: string) => who.rpc('eventbrite_credentials', { p_artist_id: artist })

  describe('storage', () => {
    // The row a manager can see holds a pointer and the organizer ids; the token appears
    // nowhere in it, not even to the service role.
    it('CRITICAL: the integrations row holds a pointer and which organizer — never the token, even to the service role', async () => {
      const { data: rows } = await asA.from('integrations').select('*').eq('artist_id', a.id)
      expect(rows).toHaveLength(1)
      expect(rows![0]).toMatchObject({ provider: 'eventbrite', metadata: { organization_id: '111', organizer_id: '222' } })
      expect(rows![0].secret_ref).toMatch(/^[0-9a-f-]{36}$/)
      const { data: all } = await svc.from('integrations').select('*').eq('artist_id', a.id)
      expect(JSON.stringify(all)).not.toContain(TOKEN)
    })
  })

  describe('retrieval', () => {
    // The owner reads the token back: this is what the server-side pull of shows uses.
    it('the owner reads the token back (the server-side pull)', async () => {
      const { data, error } = await creds(asA, a.id)
      expect(error).toBeNull()
      expect(data).toEqual([{ organization_id: '111', organizer_id: '222', token: TOKEN }])
    })

    // Another artist's manager is refused, and the token is not in the refusal.
    it("CRITICAL: another artist's manager cannot read it", async () => {
      const { data, error } = await creds(asB, a.id)
      expect(error?.message).toMatch(/not authorized/)
      expect(JSON.stringify(data)).not.toContain(TOKEN)
    })

    // A signed-out visitor cannot run any of the three database functions at all.
    it('CRITICAL: anon cannot execute any of the three doors (42501, by name)', async () => {
      const anon = anonClient()
      expectExecuteDenied((await anon.rpc('eventbrite_credentials', { p_artist_id: a.id })).error, 'eventbrite_credentials')
      expectExecuteDenied(
        (await anon.rpc('connect_eventbrite', { p_artist_id: a.id, p_organization_id: '1', p_organizer_id: '2', p_token: 'x' })).error,
        'connect_eventbrite',
      )
      expectExecuteDenied((await anon.rpc('disconnect_eventbrite', { p_artist_id: a.id })).error, 'disconnect_eventbrite')
      // The planted witness is untouched.
      expect((await creds(asA, a.id)).data).toEqual([{ organization_id: '111', organizer_id: '222', token: TOKEN }])
    })
  })

  describe('authorization and validation on connect', () => {
    // Another artist's manager cannot connect, or swap the token of, an artist they do not manage.
    it("CRITICAL: a non-owner cannot connect (or swap the token of) another tenant's artist", async () => {
      const { error } = await asB.rpc('connect_eventbrite', { p_artist_id: a.id, p_organization_id: '999', p_organizer_id: '999', p_token: 'evil' })
      expect(error?.message).toMatch(/not authorized/)
      expect((await creds(asA, a.id)).data).toEqual([{ organization_id: '111', organizer_id: '222', token: TOKEN }])
    })

    // Organizer ids must be digits (they end up in an Eventbrite URL) and the token present;
    // a refused connect changes nothing and never echoes the stored token.
    it('ids must be digits and the token present; nothing changes on a refusal', async () => {
      for (const [org, organizer, token] of [['1/..', '2', 't'], ['1', "2'; drop", 't'], ['1', '2', '']]) {
        const { error } = await asA.rpc('connect_eventbrite', { p_artist_id: a.id, p_organization_id: org, p_organizer_id: organizer, p_token: token })
        expect(error, `${org} ${organizer}`).not.toBeNull()
        expect(error!.message).not.toContain(TOKEN)
      }
      expect((await creds(asA, a.id)).data).toEqual([{ organization_id: '111', organizer_id: '222', token: TOKEN }])
    })
  })

  describe('the secret is bound to its artist', () => {
    // A's row pointed at B's secret (planted by the service role) reads nothing, and Remove
    // through it leaves B's secret alone: the binding is a second lock on its own.
    it('CRITICAL: a pointer repointed at another artist’s secret reads nothing and deletes nothing', async () => {
      // B signs in with its own token; A's manager learns B's secret id somehow.
      const { error } = await asB.rpc('connect_eventbrite', { p_artist_id: b.id, p_organization_id: '333', p_organizer_id: '444', p_token: TOKEN_B })
      expect(error).toBeNull()
      const { data: bRow } = await svc.from('integrations').select('secret_ref').eq('artist_id', b.id).eq('provider', 'eventbrite').single()
      const { data: aRow } = await svc.from('integrations').select('secret_ref').eq('artist_id', a.id).eq('provider', 'eventbrite').single()
      // Plant the repoint with the SERVICE role. A manager could once write their own row's
      // pointer (integrations_rw is FOR ALL); 20260929150000 revoked that, and
      // tests/integration/shopify/shopify-secret-binding.test.ts pins the refusal. The binding
      // is the second layer, so it is proven here on its own…
      const repoint = await svc.from('integrations').update({ secret_ref: bRow!.secret_ref }).eq('artist_id', a.id).eq('provider', 'eventbrite').select('id')
      expect(repoint.data).toHaveLength(1)
      try {
        // …but the door reads nothing through it,
        expect((await creds(asA, a.id)).data).toEqual([])
        // and Remove through it leaves B's secret alone.
        await asA.rpc('disconnect_eventbrite', { p_artist_id: a.id })
        expect((await creds(asB, b.id)).data).toEqual([{ organization_id: '333', organizer_id: '444', token: TOKEN_B }])
      } finally {
        // Put A back the way the other tests expect it.
        await svc.from('integrations').upsert({ artist_id: a.id, provider: 'eventbrite', secret_ref: aRow!.secret_ref, metadata: { organization_id: '111', organizer_id: '222' } }, { onConflict: 'artist_id,provider' })
        await asA.rpc('connect_eventbrite', { p_artist_id: a.id, p_organization_id: '111', p_organizer_id: '222', p_token: TOKEN })
      }
      expect((await creds(asA, a.id)).data).toEqual([{ organization_id: '111', organizer_id: '222', token: TOKEN }])
    })
  })

  describe('public read path', () => {
    // What the live site receives never contains the token or even the pointer.
    it('CRITICAL: the public site never carries the token or the pointer', async () => {
      const { data } = await anonClient().rpc('get_public_site', { p_slug: a.slug })
      expect(data, 'the door must be serving this artist at all').not.toBeNull()
      const blob = JSON.stringify(data)
      expect(blob).not.toContain(TOKEN)
      expect(blob).not.toContain('secret_ref')
    })
  })

  describe('renew and remove', () => {
    // Signing in again replaces the token in place: still one row, the same pointer.
    it('connecting again renews the token in place: still one row, the same pointer', async () => {
      const before = await svc.from('integrations').select('id, secret_ref').eq('artist_id', a.id).eq('provider', 'eventbrite').single()
      const { error } = await asA.rpc('connect_eventbrite', { p_artist_id: a.id, p_organization_id: '111', p_organizer_id: '555', p_token: TOKEN2 })
      expect(error).toBeNull()
      const after = await svc.from('integrations').select('id, secret_ref').eq('artist_id', a.id).eq('provider', 'eventbrite')
      expect(after.data).toEqual([before.data])
      expect((await creds(asA, a.id)).data).toEqual([{ organization_id: '111', organizer_id: '555', token: TOKEN2 }])
    })

    // Remove deletes the row and destroys the encrypted token: putting the old pointer back
    // finds nothing.
    it('CRITICAL: Remove deletes the row AND destroys the secret (a pointer restored to it reads nothing)', async () => {
      const { data: row } = await svc.from('integrations').select('secret_ref').eq('artist_id', a.id).eq('provider', 'eventbrite').single()
      expect((await creds(asA, a.id)).data).toHaveLength(1) // witness: there is a secret to destroy
      const { error } = await asA.rpc('disconnect_eventbrite', { p_artist_id: a.id })
      expect(error).toBeNull()
      const { count } = await svc.from('integrations').select('id', { count: 'exact', head: true }).eq('artist_id', a.id).eq('provider', 'eventbrite')
      expect(count).toBe(0)
      // The row alone being gone would empty the door either way; put the OLD pointer back
      // and the door still finds nothing — the encrypted token itself is gone.
      await svc.from('integrations').insert({ artist_id: a.id, provider: 'eventbrite', secret_ref: row!.secret_ref, metadata: {} })
      expect((await creds(asA, a.id)).data).toEqual([])
      await svc.from('integrations').delete().eq('artist_id', a.id).eq('provider', 'eventbrite')
    })

    // Another artist's manager cannot remove someone else's sign-in.
    it("CRITICAL: a non-owner cannot remove another tenant's sign-in", async () => {
      const { error } = await asA.rpc('disconnect_eventbrite', { p_artist_id: b.id })
      expect(error?.message).toMatch(/not authorized/)
      expect((await creds(asB, b.id)).data).toEqual([{ organization_id: '333', organizer_id: '444', token: TOKEN_B }])
    })
  })
})
