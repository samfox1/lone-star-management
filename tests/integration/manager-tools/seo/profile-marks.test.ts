/**
 * In the real database, an artist's profile marks ("Mark as sent" and the outside bios'
 * "updated" ticks on the SEO tool's Profiles tab) are readable and writable by that artist's
 * managers only, carry a stamp the database sets, and accept only the items the app knows.
 *
 * Both migrations are LIVE (20261001150000, and 20261001160000 since 2026-10-01).
 *
 * Code:     supabase/migrations/20261001150000_profile_marks.sql (the table, its RLS policies,
 *           its grants, the CHECK, the cascade); 20261001160000_profile_marks_bios.sql (the
 *           widened CHECK, the UPDATE policy + done_at grant, the profile_marks_stamp trigger);
 *           src/lib/manager-tools/profiles/marks.ts
 * Feature:  SEO tool · Profiles tab · "Mark as sent", the outside bios' "updated" ticks
 * Tier:     STRICT (AGENTS.md "Test depth"): RLS, grants and isolation. Every denial has a planted
 *           witness (rule 2), every refused write is checked by row STATE through the service
 *           client (rule 3), and every row lives on a throwaway artist (rule 6).
 * Covers:   • a manager marks and reads back, and the stamp is theirs; undo deletes the row
 *           • another artist's manager cannot read, add or remove a mark
 *           • anon has no grant at all (the wording says GRANT, not policy)
 *           • a manager cannot set done_at/done_by on insert (column grant: artist_id + item)
 *           • the CHECK refuses an unknown item; deleting the artist deletes its marks
 *           • (20261001160000) every item marks; ticking again moves done_at to now and done_by
 *             to the ticker; a forged done_at (past or future) is restamped, done_by/artist_id
 *             cannot be updated; another artist's manager and anon cannot re-confirm
 * Not here: the same rules first checked, and each broken once, on a throwaway local Postgres
 *           (2026-09-30; the re-confirm rules 2026-10-01: dropping the trigger, the UPDATE
 *           policy or the column-only grant each turned a check red). Note from the first run:
 *           an insert with an explicit conflict target, which is what setProfileMark sends,
 *           ALSO applies the SELECT policy to the new row, so a
 *           denial through it does not prove the INSERT policy. The "cannot add" test below
 *           therefore sends a PLAIN insert, which reaches the INSERT policy alone.
 * Fixtures: the HOSTED project (no fake): seeded managers A and B signed in, anon, the service
 *           client, and throwaway artists made and deleted by this file.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BIO_ITEMS } from '@/lib/manager-tools/profiles/bios'
import { PROFILE_ITEMS, readProfileMarks, setProfileMark } from '@/lib/manager-tools/profiles/marks'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const PROFILE_MARKS_PUSHED = true
/** 20261001160000_profile_marks_bios.sql: the bio items and re-confirm. */
const BIO_MARKS_PUSHED = true

const [ITEM] = PROFILE_ITEMS
const NO_GRANT = /permission denied for table profile_marks/
const NO_POLICY = /violates row-level security policy for table "profile_marks"/

describe.skipIf(!PROFILE_MARKS_PUSHED)('profile_marks', () => {
  const svc = serviceClient()
  const anon = anonClient()
  let mA: SupabaseClient
  let mB: SupabaseClient
  let mAUserId: string
  let a: ThrowawayArtist

  /** What is really stored, through the service client (RLS cannot hide a row from it). */
  const marksOf = async (artistId: string) => {
    const { data, error } = await svc.from('profile_marks').select('item, done_at, done_by').eq('artist_id', artistId)
    if (error) throw new Error(error.message)
    return data
  }
  /**
   * Plant the witness every denial is measured against, and prove it is there. `doneAt` plants
   * an old stamp (an INSERT as the service role: the stamping trigger fires on UPDATE only).
   */
  const plant = async (artistId: string, item: string = ITEM, doneAt?: string) => {
    const { error } = await svc
      .from('profile_marks')
      .insert({ artist_id: artistId, item, ...(doneAt ? { done_at: doneAt } : {}) })
    if (error) throw new Error(error.message)
    const rows = await marksOf(artistId)
    expect(rows).toHaveLength(1)
    if (doneAt) expect(Date.parse(rows[0].done_at)).toBe(Date.parse(doneAt))
  }

  beforeAll(async () => {
    mA = await signInAs(SEED.managerA)
    mB = await signInAs(SEED.managerB)
    mAUserId = (await mA.auth.getUser()).data.user!.id
    a = await createThrowawayArtist(svc, 'profile marks A', mA)
  })

  afterAll(async () => {
    await deleteThrowawayArtist(svc, a)
  })

  // Only this file's throwaway artist: each test sets its own premise.
  beforeEach(async () => {
    const { error } = await svc.from('profile_marks').delete().eq('artist_id', a.id)
    if (error) throw new Error(error.message)
  })

  it('a manager marks and reads back; the stamp is theirs', async () => {
    expect(await setProfileMark(mA, a.id, ITEM, true)).toEqual({ ok: true })
    const [row] = await marksOf(a.id)
    expect(row).toMatchObject({ item: ITEM, done_by: mAUserId })
    expect(await readProfileMarks(mA, a.id)).toEqual({ [ITEM]: row.done_at })
  })

  it('undo deletes the mark', async () => {
    await plant(a.id)
    expect(await setProfileMark(mA, a.id, ITEM, false)).toEqual({ ok: true })
    expect(await marksOf(a.id)).toEqual([])
  })

  describe('another artist’s manager', () => {
    it('cannot read the marks', async () => {
      await plant(a.id)
      const { data, error } = await mB.from('profile_marks').select('item').eq('artist_id', a.id)
      expect(error).toBeNull()
      expect(data).toEqual([])
      expect(await readProfileMarks(mB, a.id)).toEqual({})
    })

    // The positive control is the first test: manager A's own insert succeeds.
    it('cannot add one (a plain insert, so the INSERT policy is what refuses)', async () => {
      const { error } = await mB.from('profile_marks').insert({ artist_id: a.id, item: ITEM })
      expectRlsDenied(error, 'manager B marking artist A')
      expect(error?.message).toMatch(NO_POLICY)
      expect(await marksOf(a.id)).toEqual([])
      // And through the app's own write.
      expect((await setProfileMark(mB, a.id, ITEM, true)).ok).toBe(false)
      expect(await marksOf(a.id)).toEqual([])
    })

    // A denied DELETE is row-filtered: no error, zero rows. Only the row state can tell.
    it('cannot remove one', async () => {
      await plant(a.id)
      await mB.from('profile_marks').delete().eq('artist_id', a.id)
      await setProfileMark(mB, a.id, ITEM, false)
      expect(await marksOf(a.id)).toHaveLength(1)
    })
  })

  // NO_GRANT, not just 42501: with the revoke cut down to `from public`, anon's insert is still
  // 42501 (from RLS) and its select returns an empty list. Only the wording tells them apart.
  it('anon has no grant: cannot read or add', async () => {
    await plant(a.id)
    const read = await anon.from('profile_marks').select('item').eq('artist_id', a.id)
    expectRlsDenied(read.error, 'anon reading profile_marks')
    expect(read.error?.message).toMatch(NO_GRANT)

    await svc.from('profile_marks').delete().eq('artist_id', a.id)
    const add = await anon.from('profile_marks').insert({ artist_id: a.id, item: ITEM })
    expectRlsDenied(add.error, 'anon marking')
    expect(add.error?.message).toMatch(NO_GRANT)
    expect(await marksOf(a.id)).toEqual([])
  })

  it('a manager cannot set the stamp on insert (artist_id + item only)', async () => {
    for (const forged of [{ done_by: randomUUID() }, { done_at: '2020-01-01T00:00:00Z' }]) {
      const { error } = await mA.from('profile_marks').insert({ artist_id: a.id, item: ITEM, ...forged })
      expectRlsDenied(error, `manager A writing ${Object.keys(forged)[0]}`)
      expect(error?.message).toMatch(NO_GRANT)
    }
    expect(await marksOf(a.id)).toEqual([])
  })

  describe.skipIf(!BIO_MARKS_PUSHED)('bios and re-confirm (20261001160000)', () => {
    const [BIO] = BIO_ITEMS
    /** Far enough back that "moved to now" cannot be clock noise. */
    const OLD = '2021-06-01T00:00:00+00:00'
    /** done_at is the database's now(): within ten minutes of this machine's clock. */
    const expectRecent = (iso: string, what: string) => {
      const t = Date.parse(iso)
      expect(Math.abs(t - Date.now()), `${what}: done_at ${iso} is not now`).toBeLessThan(10 * 60_000)
    }

    // The widened CHECK, through the app's own write (the positive control for the CHECK test).
    it('a manager can mark every item', async () => {
      for (const item of PROFILE_ITEMS) expect(await setProfileMark(mA, a.id, item, true), item).toEqual({ ok: true })
      const rows = await marksOf(a.id)
      expect(rows.map((r) => r.item).sort()).toEqual([...PROFILE_ITEMS].sort())
      for (const r of rows) expect(r.done_by, r.item).toBe(mAUserId)
    })

    it('ticking again moves done_at to now and done_by to whoever ticked', async () => {
      await plant(a.id, BIO, OLD)
      expect(await setProfileMark(mA, a.id, BIO, true)).toEqual({ ok: true })
      const rows = await marksOf(a.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ item: BIO, done_by: mAUserId })
      expectRecent(rows[0].done_at, 're-confirm')
      expect(await readProfileMarks(mA, a.id)).toEqual({ [BIO]: rows[0].done_at })
    })

    // The trigger, not the grant, keeps the date honest: done_at IS updatable, so a direct
    // update with a chosen date reaches the row (done_by changing proves it did) and is restamped.
    // Both directions: a "never earlier than now" trigger would pass the past and fail the future.
    it('a forged done_at in a direct update is restamped to now, past or future', async () => {
      for (const forged of ['2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
        await svc.from('profile_marks').delete().eq('artist_id', a.id)
        await plant(a.id, BIO, OLD)
        const { error } = await mA.from('profile_marks').update({ done_at: forged }).eq('artist_id', a.id).eq('item', BIO)
        expect(error, forged).toBeNull()
        const [row] = await marksOf(a.id)
        expect(row.done_by, forged).toBe(mAUserId)
        expectRecent(row.done_at, `forged ${forged}`)
      }
    })

    // UPDATE is granted on done_at alone: the name on a mark and the artist it belongs to stay put.
    it('a manager cannot update done_by, artist_id or item', async () => {
      await plant(a.id, BIO, OLD)
      const before = await marksOf(a.id)
      for (const forged of [{ done_by: randomUUID() }, { artist_id: randomUUID() }, { item: ITEM }]) {
        const { error } = await mA.from('profile_marks').update(forged).eq('artist_id', a.id).eq('item', BIO)
        expectRlsDenied(error, `manager A updating ${Object.keys(forged)[0]}`)
        expect(error?.message).toMatch(NO_GRANT)
      }
      expect(await marksOf(a.id)).toEqual(before)
    })

    // A denied UPDATE is row-filtered (no error): only the row state, unchanged, proves it.
    // LIMIT: a filtered update reads the row, so the SELECT policy filters it too, and this
    // cannot tell a broken UPDATE policy (`using (true)`) from a good one. Only an UNFILTERED
    // update reaches the UPDATE policy alone, and here that would also restamp manager B's real
    // marks on the seed artist (rule 6), so that probe ran on the local Postgres only
    // (2026-10-01: a `using (true)` policy let it rewrite the other artist's row).
    it('another artist’s manager cannot re-confirm', async () => {
      await plant(a.id, BIO, OLD)
      const before = await marksOf(a.id)
      await mB.from('profile_marks').update({ done_at: 'now' }).eq('artist_id', a.id).eq('item', BIO)
      expect(await marksOf(a.id)).toEqual(before)
      expect((await setProfileMark(mB, a.id, BIO, true)).ok).toBe(false)
      expect(await marksOf(a.id)).toEqual(before)
    })

    it('anon has no UPDATE grant', async () => {
      await plant(a.id, BIO, OLD)
      const before = await marksOf(a.id)
      const { error } = await anon.from('profile_marks').update({ done_at: 'now' }).eq('artist_id', a.id).eq('item', BIO)
      expectRlsDenied(error, 'anon re-confirming')
      expect(error?.message).toMatch(NO_GRANT)
      expect(await marksOf(a.id)).toEqual(before)
    })
  })

  // Through the service role, which bypasses RLS and holds every grant: only the CHECK is left.
  it('the CHECK refuses an unknown item', async () => {
    const { error } = await svc.from('profile_marks').insert({ artist_id: a.id, item: 'discogs' })
    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('profile_marks_item_check')
    expect(await marksOf(a.id)).toEqual([])
  })

  // deleteThrowawayArtist clears nothing here and relies on the cascade.
  it('deleting the artist deletes its marks', async () => {
    const c = await createThrowawayArtist(svc, 'profile marks cascade')
    try {
      await plant(c.id)
    } finally {
      await deleteThrowawayArtist(svc, c)
    }
    expect(await marksOf(c.id)).toEqual([])
  })
})
