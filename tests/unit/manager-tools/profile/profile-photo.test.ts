/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Setting, replacing and clearing the one profile photo writes one record, whichever door it
 * comes through, and a write that fails half way never leaves the slot empty.
 *
 * Code:     src/lib/profile-photo.ts; src/lib/site-editor/save.ts (setImageField's media branch)
 * Feature:  Profile page · Profile photo (PROFILE_TOOL_PLAN.md, Sam 2026-10-02): ONE `media` row
 *           with purpose profile_photo: read the slot, insert, then delete the rows read, by id. The Profile page picks
 *           it from Images (the row SHARES the library photo's file); the Site & profile page and
 *           the editor upload into Images and pick that. All of them write through `setProfilePhoto`.
 * Tier:     STRICT (AGENTS.md "Test depth"): it writes data the live site, the press kit and the
 *           outside profiles read, and a lost row can take the live photo with it on Publish.
 * Covers:   • set = read the slot, insert ONE row (on the site), then delete the rows read BY ID;
 *             clear = the delete alone
 *           • a failed insert leaves the old photo in place (nothing deleted)
 *           • a failed delete takes the new row back out (old photo stays) and says so; if that
 *             fails too, two rows stay and it still says so (readers take the first by sort order)
 *           • two overlapping saves never empty the slot (by id, not by purpose)
 *           • two rows left by old pages become one on the next replace
 *           • a file outside the artist's own folder is refused before anything is written
 *           • a pick from Images reads the library row by id AND artist AND purpose, so another
 *             artist's photo, or a logo, can never become the profile photo
 *           • picking the photo that is already the profile photo writes nothing (no draft change)
 *           • the editor's write (setImageField) is the same write, op for op
 * Not here: the file a shared photo leaves behind on delete (tests/unit/media/storage-gc-shared-file.test.ts);
 *           the tile and picker (tests/components/manager-tools/profile/photo-picker.test.tsx);
 *           the upload doors (tests/components/manager-tools/profile/profile-photo-uploader.test.tsx).
 * Fixtures: Skeen's artist id and two of his real library file names; an in-memory `media` table
 *           behind a query-builder stub, so every assertion reads the rows LEFT, not a return value.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFILE_PHOTO, setProfilePhoto, setProfilePhotoFromImage } from '@/lib/profile-photo'
import { setImageField } from '@/lib/site-editor/save'

const ART = 'c6c2ea6e-4135-4ebb-afbe-8c9e21785f57'
const LIB = `${ART}/gallery/cd13861d-0819-406b-abc1-0dd28a5d7b3e.jpg`
const OTHER = `${ART}/gallery/73e6b920-9e83-413d-b646-44f766eedead.jpg`

type Row = { id: string; artist_id: string; purpose: string; storage_path: string; on_site?: boolean; sort_order?: number }
type Op = {
  table: string
  type?: 'select' | 'insert' | 'delete'
  values?: Record<string, unknown>
  eq: Record<string, unknown>
  neq: Record<string, unknown>
  in: Record<string, unknown[]>
}

const library = (id: string, path: string, artist = ART): Row => ({ id, artist_id: artist, purpose: 'gallery_image', storage_path: path })
const profile = (id: string, path: string): Row => ({ id, artist_id: ART, purpose: PROFILE_PHOTO, storage_path: path })

/**
 * An in-memory `media` table. `fail` makes that kind of statement answer an error and change
 * nothing, the way PostgREST does; `failDeletes` fails only the first N deletes.
 */
function fakeClient(opts: { rows?: Row[]; fail?: { select?: string; insert?: string }; failDeletes?: number } = {}) {
  const rows: Row[] = (opts.rows ?? []).map((r) => ({ ...r }))
  const ops: Op[] = []
  let made = 0
  let deletesLeftToFail = opts.failDeletes ?? 0
  const client = {
    from: (table: string) => {
      const op: Op = { table, eq: {}, neq: {}, in: {} }
      ops.push(op)
      const hit = (r: Row) =>
        Object.entries(op.eq).every(([k, v]) => (r as any)[k] === v) &&
        Object.entries(op.neq).every(([k, v]) => (r as any)[k] !== v) &&
        Object.entries(op.in).every(([k, v]) => v.includes((r as any)[k]))
      let done: { data: any; error: { message: string } | null } | null = null
      const run = () => {
        if (done) return done
        if (op.type === 'insert') {
          if (opts.fail?.insert) return (done = { data: null, error: { message: opts.fail.insert } })
          const row = { id: `new-${++made}`, ...(op.values as object) } as Row
          rows.push(row)
          return (done = { data: [{ id: row.id }], error: null })
        }
        if (op.type === 'delete') {
          if (deletesLeftToFail > 0) {
            deletesLeftToFail--
            return (done = { data: null, error: { message: 'delete refused' } })
          }
          for (let i = rows.length - 1; i >= 0; i--) if (hit(rows[i])) rows.splice(i, 1)
          return (done = { data: null, error: null })
        }
        if (opts.fail?.select) return (done = { data: null, error: { message: opts.fail.select } })
        return (done = { data: rows.filter(hit).map((r) => ({ ...r })), error: null })
      }
      const b: any = {
        select: () => ((op.type ??= 'select'), b),
        insert: (values: Record<string, unknown>) => ((op.type = 'insert'), (op.values = values), b),
        delete: () => ((op.type = 'delete'), b),
        eq: (col: string, val: unknown) => ((op.eq[col] = val), b),
        neq: (col: string, val: unknown) => ((op.neq[col] = val), b),
        in: (col: string, vals: unknown[]) => ((op.in[col] = vals), b),
        single: () => {
          const r = run()
          const first = Array.isArray(r.data) ? r.data[0] : r.data
          if (r.error) return Promise.resolve({ data: null, error: r.error })
          return Promise.resolve(first ? { data: first, error: null } : { data: null, error: { message: 'no rows' } })
        },
        maybeSingle: () => {
          const r = run()
          return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return b
    },
  } as unknown as SupabaseClient
  const profiles = () => rows.filter((r) => r.purpose === PROFILE_PHOTO).map((r) => r.storage_path)
  return { client, ops, rows, profiles }
}

const shape = (ops: Op[]) => ops.map((o) => [o.table, o.type])

describe('setProfilePhoto', () => {
  // One slot: read what it holds, land the new row FIRST, then delete exactly the rows read.
  it('CRITICAL: inserts ONE row naming the file (on the site) first, then deletes the rows the slot held, by id', async () => {
    const f = fakeClient({ rows: [profile('old', OTHER), library('img-1', LIB)] })
    expect(await setProfilePhoto(f.client, ART, LIB)).toEqual({ ok: true })
    expect(shape(f.ops)).toEqual([
      ['media', 'select'],
      ['media', 'insert'],
      ['media', 'delete'],
    ])
    expect(f.ops[0].eq).toEqual({ artist_id: ART, purpose: PROFILE_PHOTO })
    expect(f.ops[1].values).toMatchObject({ artist_id: ART, purpose: 'profile_photo', storage_path: LIB, on_site: true })
    expect(f.ops[2].eq).toEqual({ artist_id: ART, purpose: PROFILE_PHOTO })
    expect(f.ops[2].in).toEqual({ id: ['old'] })
    // The rows left: one profile photo, the new file; the library photo untouched.
    expect(f.profiles()).toEqual([LIB])
    expect(f.rows.find((r) => r.id === 'img-1')).toBeTruthy()
  })

  // The bug this guards (review of d558c8e): delete first, then a failed insert left the slot
  // empty; the upload then removed the new file and a Publish took the live photo off the site.
  it('CRITICAL: a failed insert leaves the old photo in place and deletes nothing', async () => {
    const f = fakeClient({ rows: [profile('old', OTHER)], fail: { insert: 'insert refused' } })
    expect(await setProfilePhoto(f.client, ART, LIB)).toEqual({ ok: false, error: 'insert refused' })
    expect(f.ops.some((o) => o.type === 'delete')).toBe(false)
    expect(f.profiles()).toEqual([OTHER])
  })

  // The delete fails after a good insert: the new row is taken back out, so the old photo stays
  // exactly as it was and the error is true.
  it('CRITICAL: a failed delete removes the new row again: the old photo stays and the error is said', async () => {
    const f = fakeClient({ rows: [profile('old', OTHER)], failDeletes: 1 })
    const res = await setProfilePhoto(f.client, ART, LIB)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/could not be replaced.*delete refused/i)
    expect(f.rows.map((r) => r.id)).toEqual(['old'])
  })

  // Worst case, the undo fails too: two rows, never none. Every reader takes the first by sort
  // order (the old one), so the caller is told the change did not take; the next save clears both.
  it('CRITICAL: a failed delete AND a failed undo leave two rows and say the old photo is still there', async () => {
    const f = fakeClient({ rows: [profile('old', OTHER)], failDeletes: 2 })
    const res = await setProfilePhoto(f.client, ART, LIB)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/old profile photo is still there/i)
    expect(f.profiles().sort()).toEqual([LIB, OTHER].sort())
    expect(await setProfilePhoto(f.client, ART, LIB)).toEqual({ ok: true })
    expect(f.profiles()).toEqual([LIB])
  })

  // Two overlapping saves each delete only the rows they read, so neither deletes the other's new
  // row: two rows at worst, never an empty slot.
  it('CRITICAL: two overlapping saves never empty the slot', async () => {
    const f = fakeClient({ rows: [profile('old', OTHER)] })
    await Promise.all([setProfilePhoto(f.client, ART, LIB), setProfilePhoto(f.client, ART, `${ART}/gallery/aaaaaaaa-0000-4000-8000-000000000000.jpg`)])
    expect(f.profiles().length).toBeGreaterThan(0)
    expect(f.profiles()).not.toContain(OTHER)
  })

  // Old pages could leave two rows in the slot: the next replace leaves exactly one.
  it('a replace over two old rows leaves exactly one', async () => {
    const f = fakeClient({ rows: [profile('a', OTHER), profile('b', OTHER)] })
    expect(await setProfilePhoto(f.client, ART, LIB)).toEqual({ ok: true })
    expect(f.profiles()).toEqual([LIB])
  })

  // A clear leaves the slot empty and inserts nothing; the library photo stays.
  it('clearing is the delete alone', async () => {
    const f = fakeClient({ rows: [profile('old', LIB), library('img-1', LIB)] })
    expect(await setProfilePhoto(f.client, ART, null)).toEqual({ ok: true })
    expect(f.ops.some((o) => o.type === 'insert')).toBe(false)
    expect(f.ops.find((o) => o.type === 'delete')?.eq).toEqual({ artist_id: ART, purpose: PROFILE_PHOTO })
    expect(f.profiles()).toEqual([])
    expect(f.rows.map((r) => r.id)).toEqual(['img-1'])
  })

  // The path comes from the browser on the upload doors: it must be this artist's own file.
  it('CRITICAL: a file outside the artist’s own folder is refused before anything is written', async () => {
    for (const bad of [`other-artist/gallery/x.jpg`, `${ART}/gallery/../../x.jpg`, `${ART}/x.jpg`]) {
      const f = fakeClient({ rows: [profile('old', OTHER)] })
      expect((await setProfilePhoto(f.client, ART, bad)).ok).toBe(false)
      expect(f.ops).toEqual([])
      expect(f.profiles()).toEqual([OTHER])
    }
  })

  // "Make sure both write the same record": the editor's tile and the Profile page are one write.
  it('CRITICAL: the editor’s profile-photo write (setImageField) is the same write, op for op', async () => {
    const a = fakeClient({ rows: [profile('old', OTHER)] })
    const b = fakeClient({ rows: [profile('old', OTHER)] })
    await setProfilePhoto(a.client, ART, LIB)
    await setImageField(b.client, ART, null, 'portrait', LIB, { store: 'media', purpose: 'profile_photo' })
    const strip = (ops: Op[]) => ops.map((o) => ({ ...o, values: o.values && { ...o.values, sort_order: 0 } }))
    expect(strip(b.ops)).toEqual(strip(a.ops))
    expect(b.profiles()).toEqual([LIB])
  })
})

describe('setProfilePhotoFromImage', () => {
  // The browser names a photo, never a path: the server reads the file from this artist's Images.
  it('CRITICAL: reads the library photo by id, artist AND purpose, then makes its file the profile photo', async () => {
    const f = fakeClient({ rows: [library('img-1', LIB)] })
    expect(await setProfilePhotoFromImage(f.client, ART, 'img-1')).toEqual({ ok: true })
    expect(f.ops[0]).toMatchObject({ table: 'media', type: 'select', eq: { id: 'img-1', artist_id: ART, purpose: 'gallery_image' } })
    expect(f.profiles()).toEqual([LIB])
  })

  // Another artist's photo (RLS hides it, or the artist filter misses it) or a logo: no row.
  it('CRITICAL: an id that is not one of this artist’s Images writes nothing', async () => {
    const theirs = library('someone-elses', `other-artist/gallery/x.jpg`, 'other-artist')
    const logo = { ...library('logo-1', `${ART}/brand/logo.png`), purpose: 'logo_primary' }
    for (const id of ['someone-elses', 'logo-1']) {
      const f = fakeClient({ rows: [theirs, logo, profile('old', OTHER)] })
      expect(await setProfilePhotoFromImage(f.client, ART, id)).toEqual({ ok: false, error: 'That photo is not in Images.' })
      expect(f.ops.filter((o) => o.type !== 'select')).toEqual([])
      expect(f.profiles()).toEqual([OTHER])
    }
  })

  // A read that failed is not "no photo": nothing is written and the reason comes back.
  it('a failed read writes nothing and says why', async () => {
    const f = fakeClient({ rows: [library('img-1', LIB), profile('old', OTHER)], fail: { select: 'boom' } })
    expect(await setProfilePhotoFromImage(f.client, ART, 'img-1')).toEqual({ ok: false, error: 'boom' })
    expect(f.ops.filter((o) => o.type !== 'select')).toEqual([])
    expect(f.profiles()).toEqual([OTHER])
  })

  // Re-picking the photo that is already there would make a new row with the same file: a
  // change for the Publish bar to count that changes nothing.
  it('picking the photo that is already the profile photo writes nothing', async () => {
    const f = fakeClient({ rows: [library('img-1', LIB), profile('old', LIB)] })
    expect(await setProfilePhotoFromImage(f.client, ART, 'img-1')).toEqual({ ok: true })
    expect(f.ops.filter((o) => o.type !== 'select')).toEqual([])
    expect(f.ops[1]).toMatchObject({ table: 'media', type: 'select', eq: { artist_id: ART, purpose: PROFILE_PHOTO } })
    expect(f.rows.find((r) => r.purpose === PROFILE_PHOTO)?.id).toBe('old')
  })

  // A new pick over an old one is a replace, through the same insert-then-delete.
  it('a different photo replaces the one there', async () => {
    const f = fakeClient({ rows: [library('img-1', LIB), profile('old', OTHER)] })
    expect(await setProfilePhotoFromImage(f.client, ART, 'img-1')).toEqual({ ok: true })
    expect(f.profiles()).toEqual([LIB])
  })
})
