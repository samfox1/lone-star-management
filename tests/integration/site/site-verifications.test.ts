/**
 * In the real database, the codes that prove to Google and Bing that Tapir controls a site are
 * written only by the service role, read by nobody but the service role (managers see a status
 * without the code), served to the live site by get_public_site, and only Tapir staff may move
 * an artist's site to another address.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ NOT RUN until the migration is pushed. Flip MIGRATION_PUSHED to true in the SAME change  │
 * │ as the push, then run this file (and `npm run audit:grants`).                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Code:     supabase/migrations/20260930120000_site_verifications.sql (site_verifications, its
 *           RLS and grants, site_verification_status, get_public_site's `verification`, the
 *           guard_site_address trigger on artists)
 * Feature:  Add website · who may see and change a site's registration (ADD_WEBSITE_PLAN.md)
 * Tier:     STRICT (AGENTS.md "Test depth"): RLS, grants and what the live site receives. Every
 *           denial has a planted witness (rule 2), every refused write is checked by row STATE
 *           through the service client (rule 3), and every row lives on a throwaway artist
 *           (rule 6).
 * Covers:   • a manager cannot change their own artist's site_kind or custom_site_url, but can
 *             still change the name; an admin can change the address
 *           • managers and anon can neither read nor write site_verifications
 *           • site_verification_status shows the artist's own managers a status without the code,
 *             another manager nothing, and anon may not call it
 *           • get_public_site hands the live site both codes, and nulls before registration
 *           • the table refuses a malformed code (either provider) or address (http, no trailing
 *             slash, upper case, a bare IP), one site under two artists, and deleting an artist
 *             that still holds a registration
 * Not here: the same rules first checked, and each broken once, on a throwaway local Postgres
 *           (2026-09-30). Registering with Google and Bing: src/lib/search-engines (step 4).
 * Fixtures: the HOSTED project (no fake): the seeded managers A and B and the admin signed in,
 *           the service client, and two throwaway artists made and deleted by this file.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectExecuteDenied, expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const MIGRATION_PUSHED = true

const GOOGLE_CODE = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const BING_CODE = 'DFA80FE427DDB6FD866F4B6A6564E412'

describe.skipIf(!MIGRATION_PUSHED)('site_verifications', () => {
  const svc = serviceClient()
  const anon = anonClient()
  let mA: SupabaseClient
  let mB: SupabaseClient
  let admin: SupabaseClient
  let a: ThrowawayArtist
  let b: ThrowawayArtist
  /** A fresh address per run, so a rerun inside the hour never trips the unique rule. */
  const host = `www.tw-${randomUUID().slice(0, 8)}.example`
  const siteUrl = `https://${host}/`

  const rowsOf = async (artistId: string) => {
    const { data, error } = await svc.from('site_verifications').select('provider, code').eq('artist_id', artistId).order('provider')
    if (error) throw new Error(error.message)
    return data
  }
  const addressOf = async (artistId: string) => {
    const { data, error } = await svc.from('artists').select('site_kind, custom_site_url, name').eq('id', artistId).single()
    if (error) throw new Error(error.message)
    return data
  }

  beforeAll(async () => {
    mA = await signInAs(SEED.managerA)
    mB = await signInAs(SEED.managerB)
    admin = await signInAs(SEED.admin)
    a = await createThrowawayArtist(svc, 'site verifications A', mA)
    b = await createThrowawayArtist(svc, 'site verifications B', mB)
    // A published profile is what makes get_public_site answer at all.
    const { error: revErr } = await svc
      .from('revisions')
      .insert({ artist_id: a.id, entity_type: 'artist', entity_id: a.id, data: { name: 'site verifications A throwaway' } })
    if (revErr) throw new Error(revErr.message)
    // The witnesses every read and write denial below is measured against.
    const { error } = await svc.from('site_verifications').insert([
      { artist_id: a.id, provider: 'google', site_url: siteUrl, code: GOOGLE_CODE },
      { artist_id: a.id, provider: 'bing', site_url: siteUrl, code: BING_CODE },
    ])
    if (error) throw new Error(error.message)
  })

  afterAll(async () => {
    // Exactly this file's rows: the registrations first (the FK restricts the artist delete).
    for (const t of [a, b]) {
      if (t) await svc.from('site_verifications').delete().eq('artist_id', t.id)
    }
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, b)
  })

  describe('where the site lives', () => {
    // The address is what Tapir registers with Google and Bing: a manager must not repoint it.
    it('a manager cannot change their own artist’s custom_site_url', async () => {
      const before = await addressOf(a.id)
      const { error } = await mA.from('artists').update({ custom_site_url: 'https://elsewhere.example' }).eq('id', a.id)
      expectRlsDenied(error, 'custom_site_url change')
      expect(error?.message).toContain('only Tapir staff')
      expect(await addressOf(a.id)).toEqual(before)
    })

    // site_kind flips the site between the built-in template and the custom address.
    it('a manager cannot change their own artist’s site_kind', async () => {
      const before = await addressOf(a.id)
      const { error } = await mA.from('artists').update({ site_kind: 'custom' }).eq('id', a.id)
      expectRlsDenied(error, 'site_kind change')
      expect(error?.message).toContain('only Tapir staff')
      expect(await addressOf(a.id)).toEqual(before)
    })

    // The witness for the two denials above: the manager CAN write this row, so the refusal
    // is the address guard, not a missing policy.
    it('a manager can still change their artist’s name', async () => {
      const { error } = await mA.from('artists').update({ name: 'site verifications A renamed' }).eq('id', a.id)
      expect(error).toBeNull()
      expect((await addressOf(a.id)).name).toBe('site verifications A renamed')
    })

    // Tapir staff set addresses when they add a website.
    it('an admin can change an artist’s address', async () => {
      const { error } = await admin.from('artists').update({ site_kind: 'custom', custom_site_url: `https://${host}` }).eq('id', a.id)
      expect(error).toBeNull()
      expect(await addressOf(a.id)).toMatchObject({ site_kind: 'custom', custom_site_url: `https://${host}` })
    })
  })

  describe('the codes table is closed', () => {
    // Nobody but the service role reads the table, not even the artist's own manager.
    it('a manager and anon cannot read it', async () => {
      expect(await rowsOf(a.id)).toHaveLength(2) // the witness is there
      for (const [who, client] of [['manager A', mA], ['anon', anon]] as const) {
        const { error } = await client.from('site_verifications').select('code').eq('artist_id', a.id)
        expectRlsDenied(error, `${who} read`)
      }
    })

    // A manager who could write here could plant their own code and claim the domain.
    it('a manager cannot insert, change or delete a code', async () => {
      const before = await rowsOf(a.id)
      const ins = await mA.from('site_verifications').insert({ artist_id: b.id, provider: 'google', site_url: `https://b-${host}/`, code: GOOGLE_CODE })
      expectRlsDenied(ins.error, 'insert')
      const upd = await mA.from('site_verifications').update({ code: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' }).eq('artist_id', a.id)
      expectRlsDenied(upd.error, 'update')
      const del = await mA.from('site_verifications').delete().eq('artist_id', a.id)
      expectRlsDenied(del.error, 'delete')
      expect(await rowsOf(a.id)).toEqual(before)
      expect(await rowsOf(b.id)).toEqual([])
    })
  })

  describe('what a manager sees', () => {
    // The Settings row reads this: provider and state, never the code.
    it('the artist’s own manager sees each provider’s status and no code', async () => {
      const { data, error } = await mA.rpc('site_verification_status', { p_artist: a.id })
      expect(error).toBeNull()
      expect(data).toHaveLength(2)
      for (const row of data as Record<string, unknown>[]) {
        expect(Object.keys(row).sort()).toEqual(['error_code', 'provider', 'site_url', 'updated_at', 'verified'])
        expect(row.site_url).toBe(siteUrl)
      }
    })

    // Tapir staff see every artist's status.
    it('an admin sees the status too', async () => {
      const { data, error } = await admin.rpc('site_verification_status', { p_artist: a.id })
      expect(error).toBeNull()
      expect((data as { provider: string }[]).map((r) => r.provider)).toEqual(['bing', 'google'])
    })

    // Another artist's manager learns nothing, not even that a registration exists.
    it('another manager sees nothing', async () => {
      const { data, error } = await mB.rpc('site_verification_status', { p_artist: a.id })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    // Logged-out callers may not call it at all.
    it('anon may not call it', async () => {
      const { error } = await anon.rpc('site_verification_status', { p_artist: a.id })
      expectExecuteDenied(error, 'site_verification_status')
    })
  })

  describe('the live site receives the codes', () => {
    // The site renders these in <head>; the codes must reach it exactly.
    it('get_public_site carries both codes', async () => {
      const { data, error } = await anon.rpc('get_public_site', { p_slug: a.slug })
      expect(error).toBeNull()
      expect((data as { verification: unknown }).verification).toEqual({ google: GOOGLE_CODE, bing: BING_CODE })
    })

    // Before registration the field is there and empty, so a site can read it unconditionally.
    it('an artist with no registration gets nulls', async () => {
      const rev = await svc.from('revisions').insert({ artist_id: b.id, entity_type: 'artist', entity_id: b.id, data: { name: 'site verifications B throwaway' } })
      expect(rev.error).toBeNull()
      const { data, error } = await anon.rpc('get_public_site', { p_slug: b.slug })
      expect(error).toBeNull()
      expect((data as { verification: unknown }).verification).toEqual({ google: null, bing: null })
    })
  })

  describe('the table’s own rules', () => {
    // A malformed code never reaches a live <head>: html, a quote or a space can't get in.
    it('refuses a code in the wrong shape', async () => {
      for (const [provider, code] of [['bing', 'not-32-hex'], ['google', '<meta name="x">'], ['google', 'has a space in it 0123456789'], ['google', 'short']]) {
        const { error } = await svc.from('site_verifications').insert({ artist_id: b.id, provider, site_url: `https://b-${host}/`, code })
        expect(error?.code, `${provider}: ${code}`).toBe('23514')
      }
      expect(await rowsOf(b.id)).toEqual([])
    })

    // One registered address: https, lower case, a trailing slash.
    it('refuses an address that is not the normalised one', async () => {
      for (const bad of [`http://b-${host}/`, `https://b-${host}`, `https://B-${host.toUpperCase()}/`, 'https://127.0.0.1/']) {
        const { error } = await svc.from('site_verifications').insert({ artist_id: b.id, provider: 'google', site_url: bad, code: GOOGLE_CODE })
        expect(error?.code, bad).toBe('23514')
      }
    })

    // Two artists can never be registered under the same site.
    it('refuses the same site under a second artist', async () => {
      const { error } = await svc.from('site_verifications').insert({ artist_id: b.id, provider: 'google', site_url: siteUrl, code: GOOGLE_CODE })
      expect(error?.code).toBe('23505')
      expect(await rowsOf(b.id)).toEqual([])
    })

    // Deleting an artist must not erase the only record of what Tapir owns at Google and Bing.
    it('refuses to delete an artist that still holds a registration', async () => {
      const { error } = await svc.from('artists').delete().eq('id', a.id)
      // Postgres 17 (the hosted project) says 23503 for a RESTRICT delete; 18 says 23001.
      expect(['23001', '23503']).toContain(error?.code)
      expect(error?.message).toContain('site_verifications_artist_id_fkey')
      expect(await rowsOf(a.id)).toHaveLength(2)
    })
  })
})
