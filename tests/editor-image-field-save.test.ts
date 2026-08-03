/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * setImageField — the editor's single-occupancy image write (hero image / profile photo).
 * Routes by the field's manifest target: an artist URL column (store the object's public
 * URL) vs a media row by purpose (single occupancy: drop the old row, insert the new). A
 * null path CLEARS. Asserted against a recording fake client so the routing is locked
 * without a live round-trip; the auth + revalidate wrapper is setImageFieldAction.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { setImageField } from '@/lib/site-editor/save'

// cinematic declares BOTH an artist-column image field (hero_image → hero_image_url) and a
// media-purpose one (profile_photo), so one template exercises both branches.
const TEMPLATE = 'cinematic'

type Op = { table: string; type?: 'update' | 'insert' | 'delete'; values?: Record<string, unknown>; eq: Record<string, unknown> }

/** A tiny recording stub of the Supabase query builder — enough for setImageField's
 *  update / delete / insert chains. Awaiting the chain resolves to `{ error: null }`. */
function fakeClient(): { client: SupabaseClient; ops: Op[] } {
  const ops: Op[] = []
  const build = (op: Op): any => {
    const b: any = {
      update: (values: Record<string, unknown>) => ((op.type = 'update'), (op.values = values), b),
      insert: (values: Record<string, unknown>) => ((op.type = 'insert'), (op.values = values), Promise.resolve({ error: null })),
      delete: () => ((op.type = 'delete'), b),
      eq: (col: string, val: unknown) => ((op.eq[col] = val), b),
      then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
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
    expect(await setImageField(client, 'a1', TEMPLATE, 'hero_tagline', 'a1/hero/x.jpg')).toEqual({
      ok: false,
      error: 'Unknown image field.',
    })
  })

  it('hero image → stores the object PUBLIC URL on the artist column', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'hero_image', 'a1/hero/x.jpg')).toEqual({ ok: true })
    expect(ops).toHaveLength(1)
    expect(ops[0].table).toBe('artists')
    expect(ops[0].eq).toEqual({ id: 'a1' })
    expect(String((ops[0].values as any).hero_image_url)).toContain('/media/a1/hero/x.jpg')
  })

  it('clearing the hero image nulls the column', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'hero_image', null)).toEqual({ ok: true })
    expect((ops[0].values as any).hero_image_url).toBeNull()
  })

  it('profile photo → drops any existing row of that purpose, then inserts the new one', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'profile_photo', 'a1/profile/y.jpg')).toEqual({ ok: true })
    // Vacate then fill — single occupancy per purpose.
    expect(ops.map((o) => [o.table, o.type])).toEqual([
      ['media', 'delete'],
      ['media', 'insert'],
    ])
    expect(ops[0].eq).toEqual({ artist_id: 'a1', purpose: 'profile_photo' })
    expect(ops[1].values).toMatchObject({ artist_id: 'a1', purpose: 'profile_photo', storage_path: 'a1/profile/y.jpg', on_site: true })
  })

  it('clearing the profile photo deletes the row and inserts nothing', async () => {
    const { client, ops } = fakeClient()
    expect(await setImageField(client, 'a1', TEMPLATE, 'profile_photo', null)).toEqual({ ok: true })
    expect(ops.map((o) => [o.table, o.type])).toEqual([['media', 'delete']])
  })
})
