/**
 * Profile marks without a database: which items exist, reading the marks before and after the
 * migration is pushed, and the server action refusing bad input before it opens a session.
 *
 * Code:     src/lib/manager-tools/profiles/marks.ts (PROFILE_ITEMS, isProfileItem,
 *           readProfileMarks, setProfileMark), tools/seo/profiles/actions.ts
 *           (markProfileItemAction)
 * Feature:  SEO tool · Profiles tab · "Mark as sent"
 * Tier:     STRICT (AGENTS.md "Test depth"): `item` arrives from the client and picks the row
 *           written; "not marked" must not be shown when the read actually failed.
 * Covers:   • isProfileItem accepts exactly PROFILE_ITEMS
 *           • readProfileMarks: rows by item; `{}` while the table is missing (PGRST205, 42P01);
 *             any other error throws
 *           • setProfileMark: undo is filtered by artist AND item; a refused write is never
 *             `ok`; an unknown item never reaches the table
 *           • markProfileItemAction: an unknown item or a non-boolean flag never reaches the
 *             session; a good call writes artist_id + item only (the database stamps the rest)
 * Not here: RLS, grants, the CHECK and the cascade (tests/integration/manager-tools/seo/
 *           profile-marks.test.ts, gated until the migration is pushed).
 * Fixtures: the PGRST205 body is the hosted project's real answer for this table before the
 *           push (fetched 2026-09-30); items derived from PROFILE_ITEMS, never hand-listed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFILE_ITEMS, isProfileItem, readProfileMarks, setProfileMark, type ProfileItem } from '@/lib/manager-tools/profiles/marks'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/** The session the action would open. Every chain it can reach is recorded. */
const upsert = vi.fn(async () => ({ error: null }))
const fromCalls: string[] = []
const session = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  from: (table: string) => {
    fromCalls.push(table)
    if (table === 'artists') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1' } }) }) }) }
    return { upsert, delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }
  },
}
const createClient = vi.fn(async () => session)
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))

const loadAction = async () =>
  (await import('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/actions')).markProfileItemAction

/** A client whose one read (`from().select().eq()`) answers with `res`; `reads` records where it looked. */
const reads: unknown[][] = []
const reading = (res: { data: unknown; error: unknown }) =>
  ({
    from: (table: string) => ({ select: () => ({ eq: async (...eq: unknown[]) => (reads.push([table, ...eq]), res) }) }),
  }) as unknown as SupabaseClient

beforeEach(() => {
  fromCalls.length = 0
  reads.length = 0
})

describe('isProfileItem', () => {
  it('accepts every PROFILE_ITEMS entry and nothing else', () => {
    for (const item of PROFILE_ITEMS) expect(isProfileItem(item)).toBe(true)
    const near = PROFILE_ITEMS.flatMap((i) => [i.toUpperCase(), ` ${i}`, `${i} `, i.slice(0, -1)])
    for (const bad of [...near, '', 'discogs', 'template', null, undefined, 1, {}, ['allmusic_bio']]) {
      expect(isProfileItem(bad), String(bad)).toBe(false)
    }
  })
})

describe('readProfileMarks', () => {
  it('returns each known item’s done_at, and drops rows it does not know', async () => {
    const [item] = PROFILE_ITEMS
    const marks = await readProfileMarks(
      reading({ data: [{ item, done_at: '2026-09-30T12:00:00+00:00' }, { item: 'discogs', done_at: '2026-09-30T13:00:00+00:00' }], error: null }),
      'a1',
    )
    expect(marks).toEqual({ [item]: '2026-09-30T12:00:00+00:00' })
    // Unfiltered, RLS would hand back every artist this manager runs: another artist's mark
    // would show here as "sent".
    expect(reads).toEqual([['profile_marks', 'artist_id', 'a1']])
  })

  // Before the push the tab must still render, with nothing marked.
  it('returns {} while the table does not exist yet (PGRST205 and 42P01)', async () => {
    const pgrst205 = {
      code: 'PGRST205',
      details: null,
      hint: "Perhaps you meant the table 'public.profiles'",
      message: "Could not find the table 'public.profile_marks' in the schema cache",
    }
    const pg42p01 = { code: '42P01', message: 'relation "public.profile_marks" does not exist' }
    expect(await readProfileMarks(reading({ data: null, error: pgrst205 }), 'a1')).toEqual({})
    expect(await readProfileMarks(reading({ data: null, error: pg42p01 }), 'a1')).toEqual({})
  })

  // A failed read must not look like "not sent yet", or the manager sends the email twice.
  it('throws on any other error', async () => {
    const denied = { code: '42501', message: 'permission denied for table profile_marks' }
    await expect(readProfileMarks(reading({ data: null, error: denied }), 'a1')).rejects.toThrow(/permission denied/)
  })
})

describe('setProfileMark', () => {
  /** A client whose mark (upsert) and undo (delete().eq().eq()) both answer `error`. */
  const writing = (error: unknown) => {
    const calls: { table: string; op: string; args: unknown[] }[] = []
    const client = {
      from: (table: string) => ({
        upsert: async (...args: unknown[]) => (calls.push({ table, op: 'upsert', args }), { error }),
        delete: () => ({
          eq: (...a1: unknown[]) => ({
            eq: async (...a2: unknown[]) => (calls.push({ table, op: 'delete', args: [a1, a2] }), { error }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    return { client, calls }
  }

  // An undo that lost a filter would clear the item on every artist this manager runs.
  it('undo deletes only this artist’s row for this item', async () => {
    const [item] = PROFILE_ITEMS
    const { client, calls } = writing(null)
    expect(await setProfileMark(client, 'a1', item, false)).toEqual({ ok: true })
    expect(calls).toEqual([{ table: 'profile_marks', op: 'delete', args: [['artist_id', 'a1'], ['item', item]] }])
  })

  // "Sent" shown for a mark that was never stored is how the email goes out twice, or never.
  it('a refused write is a failure with a reason, never a success', async () => {
    const [item] = PROFILE_ITEMS
    const denied = { code: '42501', message: 'new row violates row-level security policy for table "profile_marks"' }
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.profile_marks' in the schema cache" }
    for (const done of [true, false]) {
      const refused = await setProfileMark(writing(denied).client, 'a1', item, done)
      expect(refused.ok).toBe(false)
      expect(refused.error).toBeTruthy()
      expect(refused.error).not.toMatch(/not switched on/)
      const off = await setProfileMark(writing(missing).client, 'a1', item, done)
      expect(off).toEqual({ ok: false, error: expect.stringMatching(/not switched on/) })
    }
  })

  it('refuses an unknown item without touching the table', async () => {
    const { client, calls } = writing(null)
    const res = await setProfileMark(client, 'a1', 'discogs' as ProfileItem, true)
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(calls).toEqual([])
  })
})

describe('markProfileItemAction', () => {
  // The witness for the refusals below: a good call DOES open the session and write.
  it('writes artist_id + item only for a known item, and nothing else', async () => {
    const act = await loadAction()
    const [item] = PROFILE_ITEMS
    expect(await act('a1', item, true)).toEqual({ ok: true })
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(fromCalls).toEqual(['artists', 'profile_marks'])
    expect(upsert).toHaveBeenCalledWith({ artist_id: 'a1', item }, { onConflict: 'artist_id,item', ignoreDuplicates: true })
  })

  it('refuses an unknown item before opening a session', async () => {
    const act = await loadAction()
    for (const bad of ['discogs', '', 'ALLMUSIC_BIO', 'allmusic_bio ']) {
      expect(await act('a1', bad, true)).toEqual({ ok: false, error: 'Unknown item.' })
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(fromCalls).toEqual([])
  })

  it('refuses a flag that is not a boolean before opening a session', async () => {
    const act = await loadAction()
    const [item] = PROFILE_ITEMS
    for (const bad of ['false', 0, 1, null, undefined]) {
      expect(await act('a1', item, bad as unknown as boolean)).toEqual({ ok: false, error: 'Bad request.' })
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(fromCalls).toEqual([])
  })
})
