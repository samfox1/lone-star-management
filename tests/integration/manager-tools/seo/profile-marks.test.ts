/**
 * In the real database, an artist's profile marks ("Mark as sent" on the SEO tool's Profiles
 * tab) are readable and writable by that artist's managers only, carry a stamp the database
 * sets, and accept only the items the app knows.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ NOT RUN until the migration is pushed. Flip PROFILE_MARKS_PUSHED to true in the SAME     │
 * │ change as the push, then run this file (and `npm run audit:grants`).                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Code:     supabase/migrations/20261001150000_profile_marks.sql (the table, its three RLS
 *           policies, its grants, the CHECK, the cascade); src/lib/manager-tools/profiles/marks.ts
 * Feature:  SEO tool · Profiles tab · "Mark as sent"
 * Tier:     STRICT (AGENTS.md "Test depth"): RLS, grants and isolation. Every denial has a planted
 *           witness (rule 2), every refused write is checked by row STATE through the service
 *           client (rule 3), and every row lives on a throwaway artist (rule 6).
 * Covers:   • a manager marks, reads back, the stamp is theirs, marking twice keeps the first
 *             stamp; undo deletes the row
 *           • another artist's manager cannot read, add or remove a mark
 *           • anon has no grant at all (the wording says GRANT, not policy)
 *           • a manager cannot set done_at/done_by or update a mark (column grant, no UPDATE)
 *           • the CHECK refuses an unknown item; deleting the artist deletes its marks
 * Not here: the same rules first checked, and each broken once, on a throwaway local Postgres
 *           (2026-09-30). Note from that run: an insert with an explicit conflict target, which
 *           is what setProfileMark sends, ALSO applies the SELECT policy to the new row, so a
 *           denial through it does not prove the INSERT policy. The "cannot add" test below
 *           therefore sends a PLAIN insert, which reaches the INSERT policy alone.
 * Fixtures: the HOSTED project (no fake): seeded managers A and B signed in, anon, the service
 *           client, and throwaway artists made and deleted by this file.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFILE_ITEMS, readProfileMarks, setProfileMark } from '@/lib/manager-tools/profiles/marks'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const PROFILE_MARKS_PUSHED = false

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
  /** Plant the witness every denial is measured against, and prove it is there. */
  const plant = async (artistId: string) => {
    const { error } = await svc.from('profile_marks').insert({ artist_id: artistId, item: ITEM })
    if (error) throw new Error(error.message)
    expect(await marksOf(artistId)).toHaveLength(1)
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

  it('a manager marks and reads back; the stamp is theirs; marking twice keeps the first stamp', async () => {
    expect(await setProfileMark(mA, a.id, ITEM, true)).toEqual({ ok: true })
    const [row] = await marksOf(a.id)
    expect(row).toMatchObject({ item: ITEM, done_by: mAUserId })
    expect(await readProfileMarks(mA, a.id)).toEqual({ [ITEM]: row.done_at })

    expect(await setProfileMark(mA, a.id, ITEM, true)).toEqual({ ok: true })
    expect(await marksOf(a.id)).toEqual([row])
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

  it('a manager cannot set the stamp or edit a mark (insert is artist_id + item only; no UPDATE)', async () => {
    for (const forged of [{ done_by: randomUUID() }, { done_at: '2020-01-01T00:00:00Z' }]) {
      const { error } = await mA.from('profile_marks').insert({ artist_id: a.id, item: ITEM, ...forged })
      expectRlsDenied(error, `manager A writing ${Object.keys(forged)[0]}`)
      expect(error?.message).toMatch(NO_GRANT)
    }
    expect(await marksOf(a.id)).toEqual([])

    await plant(a.id)
    const before = await marksOf(a.id)
    const { error } = await mA.from('profile_marks').update({ done_at: '2020-01-01T00:00:00Z' }).eq('artist_id', a.id)
    expectRlsDenied(error, 'manager A updating a mark')
    expect(error?.message).toMatch(NO_GRANT)
    expect(await marksOf(a.id)).toEqual(before)
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
