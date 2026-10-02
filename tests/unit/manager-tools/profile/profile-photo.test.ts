/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Setting, replacing and clearing the one profile photo writes one record, whichever door it
 * comes through.
 *
 * Code:     src/lib/profile-photo.ts; src/lib/site-editor/save.ts (setImageField's media branch)
 * Feature:  Profile page · Profile photo (PROFILE_TOOL_PLAN.md, Sam 2026-10-02): ONE `media` row
 *           with purpose profile_photo, by vacate-then-insert. The Profile page picks it from
 *           Images (the row SHARES the library photo's file); the Site & profile page and the
 *           editor upload one. All three write through `setProfilePhoto`.
 * Tier:     STRICT (AGENTS.md "Test depth"): it writes data the live site, the press kit and the
 *           outside profiles read.
 * Covers:   • set = vacate the slot, then insert ONE row (on the site), clear = the vacate alone
 *           • a file outside the artist's own folder is refused before anything is written
 *           • a failed vacate writes nothing more
 *           • a pick from Images reads the library row by id AND artist AND purpose, so another
 *             artist's photo, or a logo, can never become the profile photo
 *           • picking the photo that is already the profile photo writes nothing (no draft change)
 *           • the editor's write (setImageField) is the same write, op for op
 * Not here: the file a shared photo leaves behind on delete (tests/unit/media/storage-gc-shared-file.test.ts);
 *           the tile and picker (tests/components/manager-tools/profile/photo-picker.test.tsx).
 * Fixtures: Skeen's artist id and two of his real library file names; a recording stub of the
 *           query builder (every from() is one op with its filters).
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PROFILE_PHOTO, setProfilePhoto, setProfilePhotoFromImage } from '@/lib/profile-photo'
import { setImageField } from '@/lib/site-editor/save'

const ART = 'c6c2ea6e-4135-4ebb-afbe-8c9e21785f57'
const LIB = `${ART}/gallery/cd13861d-0819-406b-abc1-0dd28a5d7b3e.jpg`
const OTHER = `${ART}/gallery/73e6b920-9e83-413d-b646-44f766eedead.jpg`

type Op = { table: string; type?: 'select' | 'insert' | 'delete'; values?: Record<string, unknown>; eq: Record<string, unknown> }

/** `reads`: what each select answers, in order (a maybeSingle answers its first row or null). */
function fakeClient(opts: { reads?: { data: unknown[] | null; error?: { message: string } | null }[]; deleteError?: string } = {}) {
  const ops: Op[] = []
  const reads = [...(opts.reads ?? [])]
  const client = {
    from: (table: string) => {
      const op: Op = { table, eq: {} }
      ops.push(op)
      let read: { data: unknown; error: unknown } = { data: null, error: null }
      const b: any = {
        select: () => {
          op.type ??= 'select'
          if (op.type === 'select') {
            const r = reads.shift() ?? { data: [] }
            read = { data: r.data, error: r.error ?? null }
          }
          return b
        },
        delete: () => ((op.type = 'delete'), (read = { data: null, error: opts.deleteError ? { message: opts.deleteError } : null }), b),
        insert: (values: Record<string, unknown>) => ((op.type = 'insert'), (op.values = values), Promise.resolve({ error: null })),
        eq: (col: string, val: unknown) => ((op.eq[col] = val), b),
        maybeSingle: () => Promise.resolve({ data: Array.isArray(read.data) ? (read.data[0] ?? null) : read.data, error: read.error }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(read).then(res, rej),
      }
      return b
    },
  } as unknown as SupabaseClient
  return { client, ops }
}

const shape = (ops: Op[]) => ops.map((o) => [o.table, o.type])

describe('setProfilePhoto', () => {
  // One slot: whatever was there goes, then exactly one row names the new file.
  it('CRITICAL: vacates the slot, then inserts ONE row naming the file, on the site', async () => {
    const { client, ops } = fakeClient()
    expect(await setProfilePhoto(client, ART, LIB)).toEqual({ ok: true })
    expect(shape(ops)).toEqual([
      ['media', 'delete'],
      ['media', 'insert'],
    ])
    expect(ops[0].eq).toEqual({ artist_id: ART, purpose: PROFILE_PHOTO })
    expect(ops[1].values).toMatchObject({ artist_id: ART, purpose: 'profile_photo', storage_path: LIB, on_site: true })
  })

  // A clear leaves the slot empty and inserts nothing.
  it('clearing is the vacate alone', async () => {
    const { client, ops } = fakeClient()
    expect(await setProfilePhoto(client, ART, null)).toEqual({ ok: true })
    expect(shape(ops)).toEqual([['media', 'delete']])
    expect(ops[0].eq).toEqual({ artist_id: ART, purpose: PROFILE_PHOTO })
  })

  // The path comes from the browser on the upload doors: it must be this artist's own file.
  it('CRITICAL: a file outside the artist’s own folder is refused before anything is written', async () => {
    for (const bad of [`other-artist/gallery/x.jpg`, `${ART}/gallery/../../x.jpg`, `${ART}/x.jpg`]) {
      const { client, ops } = fakeClient()
      expect((await setProfilePhoto(client, ART, bad)).ok).toBe(false)
      expect(ops).toEqual([])
    }
  })

  // An insert after a refused delete could leave two photos claiming the slot.
  it('a failed vacate writes nothing more', async () => {
    const { client, ops } = fakeClient({ deleteError: 'denied' })
    expect(await setProfilePhoto(client, ART, LIB)).toEqual({ ok: false, error: 'denied' })
    expect(shape(ops)).toEqual([['media', 'delete']])
  })

  // "Make sure both write the same record": the editor's tile and the Profile page are one write.
  it('CRITICAL: the editor’s profile-photo write (setImageField) is the same write, op for op', async () => {
    const a = fakeClient()
    const b = fakeClient()
    await setProfilePhoto(a.client, ART, LIB)
    await setImageField(b.client, ART, null, 'portrait', LIB, { store: 'media', purpose: 'profile_photo' })
    const strip = (ops: Op[]) => ops.map((o) => ({ ...o, values: o.values && { ...o.values, sort_order: 0 } }))
    expect(strip(b.ops)).toEqual(strip(a.ops))
  })
})

describe('setProfilePhotoFromImage', () => {
  // The browser names a photo, never a path: the server reads the file from this artist's Images.
  it('CRITICAL: reads the library photo by id, artist AND purpose, then makes its file the profile photo', async () => {
    const { client, ops } = fakeClient({ reads: [{ data: [{ storage_path: LIB }] }, { data: [] }] })
    expect(await setProfilePhotoFromImage(client, ART, 'img-1')).toEqual({ ok: true })
    expect(ops[0]).toMatchObject({ table: 'media', type: 'select', eq: { id: 'img-1', artist_id: ART, purpose: 'gallery_image' } })
    expect(shape(ops).slice(-2)).toEqual([
      ['media', 'delete'],
      ['media', 'insert'],
    ])
    expect(ops[ops.length - 1].values).toMatchObject({ artist_id: ART, purpose: PROFILE_PHOTO, storage_path: LIB })
  })

  // Another artist's photo (RLS hides it, or the artist filter misses it) or a logo: no row.
  it('CRITICAL: an id that is not one of this artist’s Images writes nothing', async () => {
    const { client, ops } = fakeClient({ reads: [{ data: [] }] })
    expect(await setProfilePhotoFromImage(client, ART, 'someone-elses')).toEqual({ ok: false, error: 'That photo is not in Images.' })
    expect(ops.filter((o) => o.type !== 'select')).toEqual([])
  })

  // A read that failed is not "no photo": nothing is written and the reason comes back.
  it('a failed read writes nothing and says why', async () => {
    const { client, ops } = fakeClient({ reads: [{ data: null, error: { message: 'boom' } }] })
    expect(await setProfilePhotoFromImage(client, ART, 'img-1')).toEqual({ ok: false, error: 'boom' })
    expect(ops.filter((o) => o.type !== 'select')).toEqual([])
  })

  // Re-picking the photo that is already there would make a new row with the same file: a
  // change for the Publish bar to count that changes nothing.
  it('picking the photo that is already the profile photo writes nothing', async () => {
    const { client, ops } = fakeClient({ reads: [{ data: [{ storage_path: LIB }] }, { data: [{ storage_path: LIB }] }] })
    expect(await setProfilePhotoFromImage(client, ART, 'img-1')).toEqual({ ok: true })
    expect(ops.filter((o) => o.type !== 'select')).toEqual([])
    expect(ops[1]).toMatchObject({ table: 'media', type: 'select', eq: { artist_id: ART, purpose: PROFILE_PHOTO } })
  })

  // A new pick over an old one is a replace, through the same vacate-then-insert.
  it('a different photo replaces the one there', async () => {
    const { client, ops } = fakeClient({ reads: [{ data: [{ storage_path: LIB }] }, { data: [{ storage_path: OTHER }] }] })
    expect(await setProfilePhotoFromImage(client, ART, 'img-1')).toEqual({ ok: true })
    expect(ops[ops.length - 1].values).toMatchObject({ storage_path: LIB })
  })
})
