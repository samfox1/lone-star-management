/**
 * Profile marks without a database: which items exist, reading the marks before and after the
 * migration is pushed, and the server action refusing bad input before it opens a session.
 *
 * Code:     src/lib/manager-tools/profiles/marks.ts (PROFILE_ITEMS, isProfileItem,
 *           readProfileMarks, setProfileMark), src/lib/manager-tools/profiles/bios.ts
 *           (OUTSIDE_BIOS, BIO_ITEMS), tools/seo/profiles/actions.ts (markProfileItemAction),
 *           and the newest `profile_marks_item_check` in supabase/migrations
 * Feature:  SEO tool · Profiles tab · "Mark as sent" and the outside bios' "updated" ticks
 * Tier:     STRICT (AGENTS.md "Test depth"): `item` arrives from the client and picks the row
 *           written; "not marked" must not be shown when the read actually failed; `edit`
 *           ends up in an href.
 * Covers:   • PROFILE_ITEMS = allmusic_bio + one bio_<key> per OUTSIDE_BIOS entry, and the same
 *             list as the table's CHECK (read from the migrations, so they cannot drift)
 *           • OUTSIDE_BIOS: unique keys, every edit link an https URL
 *           • isProfileItem accepts exactly PROFILE_ITEMS (every bio item included)
 *           • readProfileMarks: rows by item; `{}` while the table is missing (PGRST205, 42P01);
 *             any other error throws
 *           • setProfileMark: marking an item already marked RE-CONFIRMS it (an update the
 *             table's trigger stamps); a first mark inserts artist_id + item; a refused
 *             re-confirm (42501 included) is a failure, never a fall back to the insert; undo
 *             is filtered by artist AND item; a refused write is never `ok`; an unknown item
 *             never reaches the table
 *           • markProfileItemAction: an unknown item or a non-boolean flag never reaches the
 *             session; a good call writes artist_id + item only (the database stamps the rest)
 * Not here: RLS, grants, the CHECK and the stamping trigger in a real database
 *           (tests/integration/manager-tools/seo/profile-marks.test.ts).
 * Fixtures: the PGRST205 body is the hosted project's real answer for this table before the
 *           push (fetched 2026-09-30); items derived from PROFILE_ITEMS / OUTSIDE_BIOS, never
 *           hand-listed; the CHECK's list read from the migration files themselves.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BIO_ITEMS, OUTSIDE_BIOS } from '@/lib/manager-tools/profiles/bios'
import { PROFILE_ITEMS, isProfileItem, readProfileMarks, setProfileMark, type ProfileItem } from '@/lib/manager-tools/profiles/marks'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/** The session the action would open. Every chain it can reach is recorded. */
const upsert = vi.fn(async () => ({ error: null }))
/** The re-confirm: an update that matches no row here (nothing marked yet), so a mark inserts. */
const update = vi.fn(() => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }))
const fromCalls: string[] = []
/** Who is signed in, and whether they own the artist: the action's two gates before any write. */
let signedIn: { id: string } | null = { id: 'u1' }
let owned: { id: string } | null = { id: 'a1' }
const session = {
  auth: { getUser: async () => ({ data: { user: signedIn } }) },
  from: (table: string) => {
    fromCalls.push(table)
    if (table === 'artists') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: owned }) }) }) }
    return { upsert, update, delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }
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
  signedIn = { id: 'u1' }
  owned = { id: 'a1' }
  upsert.mockClear()
  update.mockClear()
})

/**
 * The list in the NEWEST `profile_marks_item_check` across every migration, in file order, with
 * `--` comments stripped first (so a commented-out example never counts). A later migration that
 * widens the CHECK again is picked up without editing this test.
 */
function checkListInMigrations(): string[] {
  const dir = join(process.cwd(), 'supabase/migrations')
  const def = /constraint\s+profile_marks_item_check\s+check\s*\(\s*item\s+in\s*\(([^)]*)\)\s*\)/gi
  let last: string | null = null
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--.*$/gm, '')
    for (const m of sql.matchAll(def)) last = m[1]
  }
  if (last === null) throw new Error('no profile_marks_item_check found in supabase/migrations')
  return last.split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1'))
}

describe('PROFILE_ITEMS', () => {
  // The table's CHECK and the code's list are two copies of one rule. If the code gains an item
  // the CHECK lacks, every tick on it fails with 23514; if the CHECK gains one the code lacks,
  // its marks are silently dropped on read.
  it('is exactly the list in the table’s CHECK (newest migration), no duplicates', () => {
    const check = checkListInMigrations()
    expect(new Set(check).size, `duplicate in the CHECK: ${check.join(', ')}`).toBe(check.length)
    expect([...check].sort()).toEqual([...PROFILE_ITEMS].sort())
  })

  // Derived from the bios registry: a bio added there is a tick here with no second list.
  it('is allmusic_bio plus one bio_<key> per OUTSIDE_BIOS entry', () => {
    expect(PROFILE_ITEMS).toEqual(['allmusic_bio', ...OUTSIDE_BIOS.map((b) => `bio_${b.key}`)])
    expect(BIO_ITEMS).toHaveLength(OUTSIDE_BIOS.length)
  })
})

describe('OUTSIDE_BIOS', () => {
  // Two bios on one key would share one tick (and one row): ticking one ticks both.
  it('has unique keys, each a lowercase identifier', () => {
    const keys = OUTSIDE_BIOS.map((b) => b.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z_]*$/)
  })

  // `edit` is rendered as a link the manager follows: only an absolute https URL, never a
  // relative path or another scheme.
  it('every edit link is an absolute https URL', () => {
    for (const b of OUTSIDE_BIOS) {
      const u = new URL(b.edit)
      expect(u.protocol, b.key).toBe('https:')
      expect(u.href, b.key).toBe(b.edit)
    }
  })
})

describe('isProfileItem', () => {
  // The one gate on the item name: the CHECK in the migration says the same.
  it('accepts every PROFILE_ITEMS entry and nothing else', () => {
    for (const item of PROFILE_ITEMS) expect(isProfileItem(item)).toBe(true)
    const near = PROFILE_ITEMS.flatMap((i) => [i.toUpperCase(), ` ${i}`, `${i} `, i.slice(0, -1)])
    for (const bad of [...near, '', 'discogs', 'template', null, undefined, 1, {}, ['allmusic_bio']]) {
      expect(isProfileItem(bad), String(bad)).toBe(false)
    }
  })

  // Spelled out from the registry, so dropping the bios from PROFILE_ITEMS fails here too.
  it('accepts every outside bio’s item, and not the bare key or an unknown bio', () => {
    for (const item of BIO_ITEMS) expect(isProfileItem(item), item).toBe(true)
    for (const b of OUTSIDE_BIOS) expect(isProfileItem(b.key), b.key).toBe(false)
    for (const bad of ['bio_', 'bio_myspace', 'bio_Spotify']) expect(isProfileItem(bad), bad).toBe(false)
  })
})

describe('readProfileMarks', () => {
  // Only items the code knows reach the page; an unknown row is ignored, never shown.
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
  /**
   * A client whose re-confirm (update().eq().eq().select()), first mark (upsert) and undo
   * (delete().eq().eq()) all answer `error`; the re-confirm finds `updated` rows when it succeeds.
   * Every call is recorded with its arguments, in order.
   */
  const writing = (error: unknown, updated: unknown[] = [], updateError: unknown = error) => {
    const calls: { table: string; op: string; args: unknown[] }[] = []
    const client = {
      from: (table: string) => ({
        update: (payload: unknown) => ({
          eq: (...a1: unknown[]) => ({
            eq: (...a2: unknown[]) => ({
              select: async (cols: unknown) => (
                calls.push({ table, op: 'update', args: [payload, a1, a2, cols] }),
                updateError ? { data: null, error: updateError } : { data: updated, error: null }
              ),
            }),
          }),
        }),
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
  const INSERT_ONLY = ['profile_marks', 'upsert']
  /** The re-confirm every mark tries first: done_at only, which the table's trigger restamps. */
  const reconfirm = (item: string) => ({
    table: 'profile_marks',
    op: 'update',
    args: [{ done_at: 'now' }, ['artist_id', 'a1'], ['item', item], 'item'],
  })
  const firstMark = (item: string) => ({
    table: 'profile_marks',
    op: 'upsert',
    args: [{ artist_id: 'a1', item }, { onConflict: 'artist_id,item', ignoreDuplicates: true }],
  })

  // Ticking "updated" again must move the date: one update of THIS artist's row for THIS item,
  // sending done_at alone (the only column managers may update), and no insert after it.
  it('re-confirms an item already marked: one update, filtered by artist and item, no insert', async () => {
    for (const item of [PROFILE_ITEMS[0], ...BIO_ITEMS]) {
      const { client, calls } = writing(null, [{ item }])
      expect(await setProfileMark(client, 'a1', item, true)).toEqual({ ok: true })
      expect(calls, item).toEqual([reconfirm(item)])
    }
  })

  // Nothing to re-confirm: insert artist_id + item only (the database stamps the rest), and
  // ON CONFLICT DO NOTHING, so a double click racing the first insert is not an error.
  it('first mark: the update matches no row, so it inserts artist_id + item', async () => {
    const [item] = BIO_ITEMS
    const { client, calls } = writing(null, [])
    expect(await setProfileMark(client, 'a1', item, true)).toEqual({ ok: true })
    expect(calls).toEqual([reconfirm(item), firstMark(item)])
  })

  // 20261001160000 is live: a re-confirm refused for lack of the UPDATE grant (42501) is a
  // failure, never a silent insert that reports "done" while the stamp stays put.
  it('a re-confirm refused with 42501 fails, and inserts nothing', async () => {
    const [item] = PROFILE_ITEMS
    const noGrant = { code: '42501', message: 'permission denied for table profile_marks' }
    const { client, calls } = writing(null, [], noGrant)
    expect((await setProfileMark(client, 'a1', item, true)).ok).toBe(false)
    expect(calls).toEqual([reconfirm(item)])
  })

  // Any other failure of the re-confirm is a failure: inserting after it could report "done"
  // for a stamp that did not move.
  it('a re-confirm that fails for another reason fails, and inserts nothing', async () => {
    const [item] = BIO_ITEMS
    const broken = { code: '23514', message: 'new row for relation "profile_marks" violates check constraint' }
    const { client, calls } = writing(null, [], broken)
    const res = await setProfileMark(client, 'a1', item, true)
    expect(res).toEqual({ ok: false, error: 'Could not save the mark.' })
    expect(calls.map((c) => [c.table, c.op])).not.toContainEqual(INSERT_ONLY)
  })

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

  // setProfileMark checks the item itself, so no caller can write a row the CHECK would refuse.
  it('refuses an unknown item without touching the table', async () => {
    const { client, calls } = writing(null)
    const res = await setProfileMark(client, 'a1', 'discogs' as ProfileItem, true)
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(calls).toEqual([])
  })
})

describe('markProfileItemAction', () => {
  // The witness for the refusals below: a good call DOES open the session and write, for every
  // item the table accepts (the bios included): re-confirm first, then the first-mark insert of
  // artist_id + item only.
  it('writes for every known item: done_at alone on re-confirm, artist_id + item on insert', async () => {
    const act = await loadAction()
    for (const item of PROFILE_ITEMS) {
      fromCalls.length = 0
      upsert.mockClear()
      update.mockClear()
      expect(await act('a1', item, true), item).toEqual({ ok: true })
      expect(fromCalls).toEqual(['artists', 'profile_marks', 'profile_marks'])
      expect(update).toHaveBeenCalledWith({ done_at: 'now' })
      expect(upsert).toHaveBeenCalledWith({ artist_id: 'a1', item }, { onConflict: 'artist_id,item', ignoreDuplicates: true })
    }
    expect(createClient).toHaveBeenCalledTimes(PROFILE_ITEMS.length)
  })

  // The action's first gate: a bad item never opens a session or reaches a table.
  it('refuses an unknown item before opening a session', async () => {
    const act = await loadAction()
    for (const bad of ['discogs', '', 'ALLMUSIC_BIO', 'allmusic_bio ', 'spotify', 'bio_myspace']) {
      expect(await act('a1', bad, true)).toEqual({ ok: false, error: 'Unknown item.' })
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(fromCalls).toEqual([])
  })

  // A flag from the client is checked as a real boolean, never coerced ("false" is not false).
  it('refuses a flag that is not a boolean before opening a session', async () => {
    const act = await loadAction()
    const [item] = PROFILE_ITEMS
    for (const bad of ['false', 0, 1, null, undefined]) {
      expect(await act('a1', item, bad as unknown as boolean)).toEqual({ ok: false, error: 'Bad request.' })
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(fromCalls).toEqual([])
  })

  // Signed out: refused before any mark is read or written (RLS would also refuse, but then a
  // cross-artist undo would report ok: the check is what keeps the answer honest).
  it('refuses when nobody is signed in, without touching profile_marks', async () => {
    signedIn = null
    const act = await loadAction()
    expect(await act('a1', PROFILE_ITEMS[0], true)).toEqual({ ok: false, error: 'Not signed in.' })
    expect(fromCalls).not.toContain('profile_marks')
    expect(upsert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  // Not this manager's artist (the owned read comes back empty): refused, nothing written.
  it('refuses an artist the caller does not own, without touching profile_marks', async () => {
    owned = null
    const act = await loadAction()
    expect(await act('a1', PROFILE_ITEMS[0], false)).toEqual({ ok: false, error: 'Artist not found.' })
    expect(fromCalls).not.toContain('profile_marks')
  })
})
