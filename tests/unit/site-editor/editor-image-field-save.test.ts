// Saving an image into a single-slot image field.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * setImageField — the editor's single-occupancy image write (hero image / profile photo).
 * Routes by the field's manifest target: an artist URL column (store the object's public
 * URL) vs a media row by purpose (single occupancy through setProfilePhoto: read the slot,
 * insert the new row, then drop the rows read, by id, so a failed insert never empties it). A
 * null path CLEARS. Asserted against a recording fake client so the routing is locked
 * without a live round-trip; the auth + revalidate wrapper is setImageFieldAction.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { setImageField } from '@/lib/site-editor/save'

// cinematic declares BOTH an artist-column image field (hero_image → hero_image_url) and a
// media-purpose one (profile_photo), so one template exercises both branches.
const TEMPLATE = 'cinematic'

type Op = {
  table: string
  type?: 'select' | 'update' | 'insert' | 'delete'
  values?: Record<string, unknown>
  eq: Record<string, unknown>
  in?: Record<string, unknown>
}

/** A tiny recording stub of the Supabase query builder — enough for setImageField's
 *  update / delete / insert chains. Awaiting the chain resolves to `{ error: null }`; a read
 *  of the slot answers one row (`old-row`); an insert's `.select('id').single()` answers the
 *  new row's id. */
function fakeClient(): { client: SupabaseClient; ops: Op[] } {
  const ops: Op[] = []
  const build = (op: Op): any => {
    const b: any = {
      update: (values: Record<string, unknown>) => ((op.type = 'update'), (op.values = values), b),
      insert: (values: Record<string, unknown>) => ((op.type = 'insert'), (op.values = values), b),
      select: () => ((op.type ??= 'select'), b),
      single: () => Promise.resolve({ data: { id: 'new-row' }, error: null }),
      delete: () => ((op.type = 'delete'), b),
      eq: (col: string, val: unknown) => ((op.eq[col] = val), b),
      in: (col: string, val: unknown) => (((op.in ??= {})[col] = val), b),
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: op.type === 'select' ? [{ id: 'old-row' }] : null, error: null }).then(res),
    }
    return b
  }
  const client = {
    from: (table: string) => {
      const op: Op = { table, eq: {} }
      ops.push(op)
      return build(op)
    },
  } as unknown as SupabaseClient
  return { client, ops }
}

describe('setImageField', () => {
  it('rejects a field that is not a declared image', async () => {
    const { client } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'hero_tagline', 'a1/hero/11111111-1111-4111-8111-111111111111.jpg')).toEqual({
      ok: false,
      error: 'Unknown image field.',
    })
  })

  it('hero image → stores the object PUBLIC URL on the artist column', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'hero_image', 'a1/hero/11111111-1111-4111-8111-111111111111.jpg')).toEqual({ ok: true })
    expect(ops).toHaveLength(1)
    expect(ops[0].table).toBe('artists')
    expect(ops[0].eq).toEqual({ id: 'a1' })
    expect(String((ops[0].values as any).hero_image_url)).toContain('/media/a1/hero/11111111-1111-4111-8111-111111111111.jpg')
  })

  it('clearing the hero image nulls the column', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'hero_image', null)).toEqual({ ok: true })
    expect((ops[0].values as any).hero_image_url).toBeNull()
  })

  it('profile photo → reads the slot, inserts the new row, then drops the rows read, by id', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'profile_photo', 'a1/profile/22222222-2222-4222-8222-222222222222.jpg')).toEqual({ ok: true })
    // Fill, then vacate what was there — single occupancy per purpose, never an empty slot
    // when the insert fails, and never another save's new row (review of d558c8e, 2026-10-02).
    expect(ops.map((o) => [o.table, o.type])).toEqual([
      ['media', 'select'],
      ['media', 'insert'],
      ['media', 'delete'],
    ])
    expect(ops[1].values).toMatchObject({ artist_id: 'a1', purpose: 'profile_photo', storage_path: 'a1/profile/22222222-2222-4222-8222-222222222222.jpg', on_site: true })
    expect(ops[2].eq).toEqual({ artist_id: 'a1', purpose: 'profile_photo' })
    expect(ops[2].in).toEqual({ id: ['old-row'] })
  })

  it('clearing the profile photo deletes the row and inserts nothing', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'profile_photo', null)).toEqual({ ok: true })
    expect(ops.map((o) => [o.table, o.type])).toEqual([
      ['media', 'select'],
      ['media', 'delete'],
    ])
  })

  it('CRITICAL: a CUSTOM site’s declared image field saves — its key is in no local manifest', async () => {
    // 2026-08-09 review. runtimeImageFields started rendering tiles for a custom site's
    // declared images, but this write still resolved the field through
    // manifestFor(template) — and a custom artist keeps whatever `template` column it
    // had, so a frame-declared key like `hero_portrait` is never in it. Every upload AND
    // every remove returned "Unknown image field."; only the TILE was pinned, not the
    // round trip. Text already had the branch (saveEditorField takes template=null and
    // routes to saveCustomField); images did not.
    const { client, ops } = fakeClient()
    const res = await setImageField(client, 'a1', null, 'hero_portrait', 'a1/profile/33333333-3333-4333-8333-333333333333.jpg', {
      store: 'media',
      purpose: 'profile_photo',
    })
    expect(res).toEqual({ ok: true })
    expect(ops.map((o) => [o.table, o.type])).toEqual([
      ['media', 'select'],
      ['media', 'insert'],
      ['media', 'delete'],
    ])
  })

  it('CRITICAL: a custom site cannot name a target outside the closed set', async () => {
    // The target arrives from the CLIENT for a custom site, because the server has no
    // manifest to look it up in. It is therefore validated, not trusted: the union is
    // exactly the two single-occupancy homes the wire models, so a request naming
    // anything else writes nowhere.
    const { client, ops } = fakeClient()
    const res = await setImageField(client, 'a1', null, 'hero_portrait', 'a1/profile/44444444-4444-4444-8444-444444444444.jpg', {
      store: 'artist',
      column: 'bio',
    } as never)
    expect(res.ok).toBe(false)
    expect(ops).toHaveLength(0)
  })

  it('a custom site with NO target given is refused rather than guessed', async () => {
    const { client, ops } = fakeClient()
    expect((await setImageField(client, 'a1', null, 'hero_portrait', null)).ok).toBe(false)
    expect(ops).toHaveLength(0)
  })

  it('CRITICAL: hero_video, a media field that is not the profile photo, writes nothing', async () => {
    // cinematic declares hero_video as type 'image' with a media target, and a manifest target
    // is used as-is. The media branch once wrote the PROFILE PHOTO for any media target, so a
    // direct setImageFieldAction(…, 'hero_video', path) replaced (or, with null, cleared) the
    // artist's profile photo. Only the profile_photo purpose may reach setProfilePhoto.
    for (const path of ['a1/profile/55555555-5555-4555-8555-555555555555.jpg', null]) {
      const { client, ops } = fakeClient()
      expect(await setImageField(client, 'a1', TEMPLATE, 'hero_video', path)).toEqual({ ok: false, error: 'That field is not an image.' })
      expect(ops, String(path)).toHaveLength(0)
    }
  })

  it('a BUILT-IN template ignores a client-supplied target', async () => {
    // Belt: the manifest is authoritative where one exists, so a crafted target cannot
    // redirect a built-in template's write.
    const { client, ops } = fakeClient()
    const res = await setImageField(client, 'a1', TEMPLATE, 'profile_photo', null, { store: 'artist', column: 'hero_image_url' })
    expect(res).toEqual({ ok: true })
    expect(ops.map((o) => [o.table, o.type])).toEqual([
      ['media', 'select'],
      ['media', 'delete'],
    ])
  })
})
