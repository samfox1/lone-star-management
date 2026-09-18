// The public email signup: one guarded write door, and fan emails nobody else can read.
/**
 * Security for the public email-list signup. `subscribers` holds anonymous fan
 * emails keyed to one artist, so — like analytics_events — the ONLY write path
 * is the SECURITY DEFINER door `subscribe`, there is no anon insert/select
 * policy, and reads are scoped to the artist's managers (+ admins). Verified
 * against the real DB; RLS can't be mocked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectDeniedByMissingPolicy } from '@tests/helpers/rls'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

/** Used by the door tests only — `subscribe` must be the thing that creates it. */
const DOOR_EMAIL = 'iso-sub@example.test'
/**
 * Planted with the service role for the isolation block. Deliberately a DIFFERENT
 * address from DOOR_EMAIL: reusing it would make `subscribe` a no-op (the dedup index
 * would swallow the insert) and quietly gut the door's own test.
 */
const PLANTED_EMAIL = 'iso-sub-planted@example.test'

let asAdmin: SupabaseClient
let asManagerA: SupabaseClient
let asManagerB: SupabaseClient
let artistAId: string
let plantedId: string
const svc = serviceClient()

beforeAll(async () => {
  asAdmin = await signInAs(SEED.admin)
  asManagerA = await signInAs(SEED.managerA)
  asManagerB = await signInAs(SEED.managerB)
  artistAId = await artistIdBySlug(SEED.artistASlug)

  // Plant with the SERVICE client, not through the door. Every denial below filters on
  // this address; if the only row bearing it came from the `subscribe` test in the
  // describe block above, then skipping or breaking that test would turn each denial
  // into a query over an empty table — a pass that proves nothing.
  await svc.from('subscribers').delete().eq('email', PLANTED_EMAIL)
  const { data, error } = await svc
    .from('subscribers')
    .insert({ artist_id: artistAId, email: PLANTED_EMAIL })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('subscribers fixture insert failed')
  plantedId = data.id
})

afterAll(async () => {
  await svc.from('subscribers').delete().in('email', [DOOR_EMAIL, PLANTED_EMAIL])
})

describe('subscribe (public door)', () => {
  it('anon can subscribe through the door', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: SEED.artistASlug,
      p_email: DOOR_EMAIL,
    })
    expect(error).toBeNull()
  })

  it('re-subscribing the same email is a silent no-op (dedup)', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: SEED.artistASlug,
      p_email: DOOR_EMAIL,
    })
    expect(error).toBeNull()
    const { data } = await svc.from('subscribers').select('id').eq('email', DOOR_EMAIL)
    expect((data ?? []).length).toBe(1)
  })

  // THE THREE REFUSALS ARE INDISTINGUISHABLE BY CODE. `subscribe` raises all of them with
  // plpgsql's default SQLSTATE, P0001, so `expect(error).not.toBeNull()` — which is what
  // both tests below used to say — is satisfied by ANY of the three, and by PGRST202
  // "function does not exist" on top. Delete the email regex and the "invalid email" test
  // still passes, because an unknown-artist or flood-cap raise (or a renamed parameter)
  // fills the same hole. Each is pinned by its MESSAGE now, which is the only thing that
  // tells them apart.
  it('rejects an invalid email', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: SEED.artistASlug,
      p_email: 'not-an-email',
    })
    expect(error?.code).toBe('P0001')
    expect(error?.message ?? '').toContain('Enter a valid email address.')
  })

  it('rejects an unknown artist slug', async () => {
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: 'no-such-artist',
      p_email: DOOR_EMAIL,
    })
    expect(error?.code).toBe('P0001')
    expect(error?.message ?? '').toContain('Unknown artist.')
  })

  it('validates the email BEFORE resolving the artist, so a bad slug cannot mask it', async () => {
    // Both arguments are wrong at once. The message says which guard fired, and pinning it
    // is what stops the two tests above from silently collapsing into one.
    const { error } = await anonClient().rpc('subscribe', {
      p_slug: 'no-such-artist',
      p_email: 'not-an-email',
    })
    expect(error?.message ?? '').toContain('Enter a valid email address.')
  })
})

/**
 * THE PER-ARTIST FLOOD CAP (20260706150000): 15 new signups per artist per minute.
 *
 * It had NO test anywhere — the exact shape AGENTS.md names ("how the per-artist flood cap
 * vanished for a day"), and for a findable reason: on a shared seed artist the test is not
 * re-runnable. It has to fill a one-minute window to the brim, and a second run inside that
 * minute would start already capped, so the only honest version needs an artist nobody else
 * has touched. A throwaway with a random slug is that artist.
 *
 * Each test takes its OWN throwaway, because the first one deliberately leaves its artist
 * at the cap for the rest of the minute.
 */
describe('subscribe — the per-artist flood cap', () => {
  const flooded: ThrowawayArtist[] = []

  afterAll(async () => {
    // Dropping each artist cascades its subscribers away: exactly the rows these tests
    // created, and not one belonging to anybody else.
    for (const a of flooded) await deleteThrowawayArtist(svc, a)
  })

  async function freshArtist(label: string): Promise<ThrowawayArtist> {
    const a = await createThrowawayArtist(svc, label)
    flooded.push(a)
    return a
  }

  it('CRITICAL: the 16th distinct signup in a minute is refused, and is not stored', async () => {
    const artist = await freshArtist('Subscribe flood')
    const anon = anonClient()

    for (let i = 0; i < 15; i++) {
      const { error } = await anon.rpc('subscribe', { p_slug: artist.slug, p_email: `flood-${i}@example.test` })
      expect(error, `signup ${i + 1} of 15 was refused below the cap`).toBeNull()
    }

    const { error } = await anon.rpc('subscribe', { p_slug: artist.slug, p_email: 'flood-16@example.test' })
    expect(error?.code).toBe('P0001')
    expect(error?.message ?? '').toContain('Too many signups right now')

    // The return value is void, so the table is the only evidence either way: the 16th
    // address must not be in it, and the 15 that were accepted must be.
    const { data } = await svc.from('subscribers').select('email').eq('artist_id', artist.id)
    expect(data ?? []).toHaveLength(15)
    expect((data ?? []).map((r) => r.email)).not.toContain('flood-16@example.test')
  })

  it('a repeated address is a no-op and does NOT burn the window', async () => {
    // The cap counts ROWS created in the last minute, not calls, and the unique index makes
    // a repeat `on conflict do nothing`. So one fan double-clicking Subscribe twenty times
    // must not lock out the next nineteen people. If the dedup ever went away, these twenty
    // calls would write twenty rows, the last distinct signup would be refused, and the
    // count below would be 21 rather than 2.
    const artist = await freshArtist('Subscribe dedup')
    const anon = anonClient()
    const same = 'eager-fan@example.test'

    for (let i = 0; i < 20; i++) {
      const { error } = await anon.rpc('subscribe', { p_slug: artist.slug, p_email: same })
      expect(error, `repeat ${i + 1} was refused`).toBeNull()
    }

    const { error } = await anon.rpc('subscribe', { p_slug: artist.slug, p_email: 'someone-else@example.test' })
    expect(error, 'repeats burned the flood window').toBeNull()

    const { data } = await svc.from('subscribers').select('email').eq('artist_id', artist.id)
    expect((data ?? []).map((r) => r.email).sort()).toEqual([same, 'someone-else@example.test'].sort())
  })
})

describe('subscribers isolation', () => {
  // Guard rail: if the fixture is missing, every denial below is reading an empty table.
  it('the planted subscriber really is in the table (service role)', async () => {
    const { data } = await svc.from('subscribers').select('id').eq('email', PLANTED_EMAIL)
    expect(data).toHaveLength(1)
  })

  it('CRITICAL: anon cannot read subscribers', async () => {
    const { data } = await anonClient().from('subscribers').select('id').eq('email', PLANTED_EMAIL)
    expect(data).toEqual([])
  })

  it('CRITICAL: anon cannot insert directly, bypassing the door', async () => {
    // `subscribers` has a read policy and NO write policy. anon still holds the stock
    // table-level INSERT grant, so the ABSENCE of the policy is the whole control.
    const { error } = await anonClient()
      .from('subscribers')
      .insert({ artist_id: artistAId, email: PLANTED_EMAIL })
      .select()
    expectDeniedByMissingPolicy(error, 'anon inserting a subscriber')
  })

  it("CRITICAL: a manager of another artist cannot read this artist's list", async () => {
    const { data } = await asManagerB.from('subscribers').select('id').eq('email', PLANTED_EMAIL)
    expect(data).toEqual([])
  })

  it("the artist's own manager can read their subscribers", async () => {
    const { data } = await asManagerA
      .from('subscribers')
      .select('id, email')
      .eq('email', PLANTED_EMAIL)
    expect((data ?? []).length).toBeGreaterThan(0)
    expect(data![0].email).toBe(PLANTED_EMAIL)
  })

  it('admin can read submitted subscribers', async () => {
    const { data } = await asAdmin.from('subscribers').select('id, email').eq('email', PLANTED_EMAIL)
    expect((data ?? []).length).toBeGreaterThan(0)
    expect(data![0].email).toBe(PLANTED_EMAIL)
  })
})

describe('subscribers — nobody writes this table through a session', () => {
  // The read policy is the ONLY policy on `subscribers`. That is a deliberate omission,
  // and nothing pinned it: a later migration adding an innocuous-looking
  // `subscribers_owner_write` would hand every manager (and anything holding their
  // token) the ability to forge or quietly erase fan emails, with no test turning red.

  it("CRITICAL: even the artist's OWN manager cannot insert a fan email", async () => {
    const { error } = await asManagerA
      .from('subscribers')
      .insert({ artist_id: artistAId, email: 'forged-fan@example.test' })
      .select()
    expectDeniedByMissingPolicy(error, "the owning manager inserting a subscriber")

    const { data } = await svc.from('subscribers').select('id').eq('email', 'forged-fan@example.test')
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: the OWN manager cannot delete a fan email (silent no-op, so check state)", async () => {
    // No DELETE policy means RLS filters the row out of the statement entirely, so
    // PostgREST reports success over zero rows. `error === null` proves nothing here —
    // the only evidence is that the row survived.
    const { error } = await asManagerA.from('subscribers').delete().eq('id', plantedId)
    expect(error).toBeNull()

    const { data } = await svc.from('subscribers').select('id').eq('id', plantedId)
    expect(data, 'the owning manager deleted a fan email').toHaveLength(1)
  })

  it("CRITICAL: the OWN manager cannot rewrite a fan's address", async () => {
    await asManagerA
      .from('subscribers')
      .update({ email: 'rewritten@example.test' })
      .eq('id', plantedId)

    const { data } = await svc.from('subscribers').select('email').eq('id', plantedId).single()
    expect(data?.email).toBe(PLANTED_EMAIL)
  })
})
