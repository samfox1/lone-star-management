// Primary and Secondary colours on the live database: one of each per artist, fixed names, the cap still counts them, strangers refused.
/**
 * 20260924130000_brand_color_slots.sql against the hosted project, plus lib/manager-tools/brand/brand-colors.ts
 * over it. The DB-free half (order, payload) is tests/unit/manager-tools/brand/brand-color-slots.test.ts.
 *
 * What only the real database can hold:
 *   • The CHECKs, written as the SERVICE ROLE so RLS is not what says no, each matched on
 *     the CONSTRAINT NAME (23514 alone could be any check; 23505 any unique).
 *   • One Primary and one Secondary per artist — and the upsert that relies on it: the
 *     second pick changes the row, never adds one.
 *   • The cap counts the built-ins, and does NOT count the row an upsert replaces: re-picking
 *     Primary on a full palette works, a 25th colour does not.
 *   • A stranger cannot give A's Primary a colour, or change it. The witness is planted and
 *     checked first; row STATE is read back with the service client (AGENTS.md rules 2, 3).
 *
 * Every artist here is a throwaway, created and dropped by this file (rule 6).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listBrandColors, renameBrandColor, setBrandColorNote, setSlotColor } from '@/lib/manager-tools/brand/brand-colors'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'

const svc = serviceClient()
let asA: SupabaseClient
let asB: SupabaseClient
let tenantA: ThrowawayArtist
let tenantB: ThrowawayArtist
let A: string
let B: string

type PgErr = { code?: string; message?: string } | null
/** Refused by THIS constraint: the right code and its name in the message. */
function expectRefusedBy(error: PgErr, code: '23514' | '23505', name: string) {
  expect(error, `expected ${name} to refuse, got no error`).not.toBeNull()
  expect(error?.code, `[${error?.code}] ${error?.message}`).toBe(code)
  expect(error?.message ?? '').toContain(name)
}

async function slotRows(artist: string) {
  const { data, error } = await svc.from('brand_colors').select('id, name, hex, note, slot').eq('artist_id', artist).not('slot', 'is', null)
  if (error) throw new Error(error.message)
  return (data ?? []) as { id: string; name: string; hex: string; note: string | null; slot: string }[]
}

async function countColors(artist: string) {
  const { count } = await svc.from('brand_colors').select('id', { count: 'exact', head: true }).eq('artist_id', artist)
  return count
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  tenantA = await createThrowawayArtist(svc, 'Brand color slots A', asA)
  tenantB = await createThrowawayArtist(svc, 'Brand color slots B', asB)
  A = tenantA.id
  B = tenantB.id
})

afterAll(async () => {
  try {
    await deleteThrowawayArtist(svc, tenantA)
  } finally {
    await deleteThrowawayArtist(svc, tenantB)
  }
})

describe('the slot rules, written as the service role (RLS is not what refuses)', () => {
  it('CRITICAL: only primary and secondary are slots', async () => {
    for (const slot of ['tertiary', 'Primary', ''])
      expectRefusedBy(
        (await svc.from('brand_colors').insert({ artist_id: A, slot, name: 'Primary', hex: '#000000' })).error,
        '23514',
        'brand_colors_slot_known',
      )
  })

  it('CRITICAL: a built-in’s name is fixed, and it has no note', async () => {
    expectRefusedBy(
      (await svc.from('brand_colors').insert({ artist_id: A, slot: 'primary', name: 'Brand red', hex: '#000000' })).error,
      '23514',
      'brand_colors_slot_fixed',
    )
    expectRefusedBy(
      (await svc.from('brand_colors').insert({ artist_id: A, slot: 'secondary', name: 'Primary', hex: '#000000' })).error,
      '23514',
      'brand_colors_slot_fixed',
    )
    expectRefusedBy(
      (await svc.from('brand_colors').insert({ artist_id: A, slot: 'primary', name: 'Primary', hex: '#000000', note: 'x' })).error,
      '23514',
      'brand_colors_slot_fixed',
    )
    // The witness that the rule is about the SLOT: an added colour may be called anything.
    const { data, error } = await svc.from('brand_colors').insert({ artist_id: A, name: 'Primary', hex: '#000000', note: 'x' }).select('id').single()
    expect(error).toBeNull()
    await svc.from('brand_colors').delete().eq('id', data!.id)
  })

  it('CRITICAL: one Primary per artist; Secondary and another artist’s Primary are separate', async () => {
    const first = await svc.from('brand_colors').insert({ artist_id: A, slot: 'primary', name: 'Primary', hex: '#111111' }).select('id').single()
    expect(first.error).toBeNull()
    try {
      expectRefusedBy(
        (await svc.from('brand_colors').insert({ artist_id: A, slot: 'primary', name: 'Primary', hex: '#222222' })).error,
        '23505',
        'brand_colors_slot_once',
      )
      const others = await svc
        .from('brand_colors')
        .insert([
          { artist_id: A, slot: 'secondary', name: 'Secondary', hex: '#333333' },
          { artist_id: B, slot: 'primary', name: 'Primary', hex: '#444444' },
        ])
        .select('id')
      expect(others.error).toBeNull()
      // Added colours all have slot NULL, and NULLs never collide.
      const added = await svc
        .from('brand_colors')
        .insert([
          { artist_id: A, name: 'Color 3', hex: '#555555' },
          { artist_id: A, name: 'Color 3', hex: '#555555' },
        ])
        .select('id')
      expect(added.error).toBeNull()
    } finally {
      await svc.from('brand_colors').delete().in('artist_id', [A, B])
    }
  })

  it('a built-in cannot be renamed or given a note — and the lib says so, the row unchanged', async () => {
    const res = await setSlotColor(asA, A, 'primary', '#0d0d0d')
    expect(res.ok, res.error).toBe(true)
    const id = res.color!.id
    try {
      expect((await renameBrandColor(asA, A, id, 'Brand red')).ok).toBe(false)
      expect((await setBrandColorNote(asA, A, id, 'our red')).ok).toBe(false)
      expect(await slotRows(A)).toEqual([{ id, name: 'Primary', hex: '#0d0d0d', note: null, slot: 'primary' }])
    } finally {
      await svc.from('brand_colors').delete().eq('artist_id', A)
    }
  })
})

describe('setSlotColor: the first pick makes the row, every later pick changes it', () => {
  it('CRITICAL: two picks of Primary are ONE row, holding the second colour, named Primary', async () => {
    try {
      const one = await setSlotColor(asA, A, 'primary', 'ABC')
      expect(one.ok, one.error).toBe(true)
      expect(one.color).toMatchObject({ name: 'Primary', hex: '#aabbcc', slot: 'primary' })
      const two = await setSlotColor(asA, A, 'primary', '#123456')
      expect(two.ok, two.error).toBe(true)
      expect(two.color?.id).toBe(one.color?.id)
      expect(await slotRows(A)).toEqual([{ id: one.color!.id, name: 'Primary', hex: '#123456', note: null, slot: 'primary' }])
    } finally {
      await svc.from('brand_colors').delete().eq('artist_id', A)
    }
  })

  it('two tabs picking Primary at once still make ONE row', async () => {
    try {
      const results = await Promise.all(['#111111', '#222222', '#333333'].map((hex) => setSlotColor(asA, A, 'primary', hex)))
      for (const r of results) expect(r.ok, r.error).toBe(true)
      expect(await slotRows(A)).toHaveLength(1)
    } finally {
      await svc.from('brand_colors').delete().eq('artist_id', A)
    }
  })

  it('CRITICAL: the palette reads Primary, then Secondary, then the added colours', async () => {
    try {
      expect((await svc.from('brand_colors').insert({ artist_id: A, name: 'Color 3', hex: '#000000', sort_order: 0 })).error).toBeNull()
      expect((await setSlotColor(asA, A, 'secondary', '#222222')).ok).toBe(true)
      expect((await setSlotColor(asA, A, 'primary', '#111111')).ok).toBe(true)
      expect((await listBrandColors(asA, A)).map((c) => [c.name, c.slot])).toEqual([
        ['Primary', 'primary'],
        ['Secondary', 'secondary'],
        ['Color 3', null],
      ])
    } finally {
      await svc.from('brand_colors').delete().eq('artist_id', A)
    }
  })
})

describe('the 24-colour cap counts Primary and Secondary', () => {
  it('CRITICAL: 22 added + Primary + Secondary is full — and re-picking Primary still works', async () => {
    const t = await createThrowawayArtist(svc, 'Brand color slots cap', asA)
    try {
      const rows = Array.from({ length: 22 }, (_, i) => ({ artist_id: t.id, name: `Color ${i + 3}`, hex: '#000000', sort_order: i }))
      expect((await svc.from('brand_colors').insert(rows)).error).toBeNull()
      const p = await setSlotColor(asA, t.id, 'primary', '#111111')
      const s = await setSlotColor(asA, t.id, 'secondary', '#222222')
      expect([p.ok, s.ok], `${p.error} ${s.error}`).toEqual([true, true])
      expect(await countColors(t.id)).toBe(24)

      // The 25th is refused, even from the service role.
      expectRefusedBy(
        (await svc.from('brand_colors').insert({ artist_id: t.id, name: 'Color 25', hex: '#000000' })).error,
        '23514',
        'brand color cap reached',
      )
      // Re-picking a built-in at the cap is a CHANGE, not a 25th colour (the trigger does
      // not count the row the upsert replaces). Before 20260924130000 this was refused.
      const again = await setSlotColor(asA, t.id, 'primary', '#999999')
      expect(again.ok, again.error).toBe(true)
      expect(again.color?.id).toBe(p.color?.id)
      expect(await countColors(t.id)).toBe(24)
      const { data } = await svc.from('brand_colors').select('hex').eq('id', p.color!.id).single()
      expect(data?.hex).toBe('#999999')
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: at 24 with no Primary yet, Primary is refused — the built-ins count toward the cap', async () => {
    const t = await createThrowawayArtist(svc, 'Brand color slots cap 2', asA)
    try {
      const rows = Array.from({ length: 24 }, (_, i) => ({ artist_id: t.id, name: `Color ${i + 1}`, hex: '#000000', sort_order: i }))
      expect((await svc.from('brand_colors').insert(rows)).error).toBeNull()
      const res = await setSlotColor(asA, t.id, 'primary', '#111111')
      expect(res).toEqual({ ok: false, error: 'You can keep up to 24 colors. Remove one first.' })
      expect(await slotRows(t.id)).toEqual([])
      expect(await countColors(t.id)).toBe(24)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('strangers are refused (planted witness, row state checked)', () => {
  let witness: string
  beforeAll(async () => {
    const { data, error } = await svc
      .from('brand_colors')
      .insert({ artist_id: A, slot: 'primary', name: 'Primary', hex: '#123456' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`plant witness: ${error?.message}`)
    witness = data.id as string
  })
  afterAll(async () => {
    await svc.from('brand_colors').delete().eq('artist_id', A)
  })

  it('the witness exists (so every denial below is about access, not absence)', async () => {
    expect(await slotRows(A)).toEqual([{ id: witness, name: 'Primary', hex: '#123456', note: null, slot: 'primary' }])
  })

  it("CRITICAL: B cannot change A's Primary — the upsert is refused and the colour stays", async () => {
    const res = await setSlotColor(asB, A, 'primary', '#ffffff')
    expect(res.ok).toBe(false)
    const { error } = await asB
      .from('brand_colors')
      .upsert({ artist_id: A, slot: 'primary', name: 'Primary', hex: '#ffffff' }, { onConflict: 'artist_id,slot' })
    expectRlsDenied(error, "B upsert A's primary")
    expect(await slotRows(A)).toEqual([{ id: witness, name: 'Primary', hex: '#123456', note: null, slot: 'primary' }])
  })

  it("CRITICAL: B cannot give A a Secondary", async () => {
    const res = await setSlotColor(asB, A, 'secondary', '#ffffff')
    expect(res.ok).toBe(false)
    expect((await slotRows(A)).map((r) => r.slot)).toEqual(['primary'])
  })

  it("B's own Primary is B's: it neither reads nor touches A's", async () => {
    try {
      const res = await setSlotColor(asB, B, 'primary', '#abcdef')
      expect(res.ok, res.error).toBe(true)
      expect(res.color?.id).not.toBe(witness)
      expect((await listBrandColors(asB, B)).map((c) => c.hex)).toEqual(['#abcdef'])
      expect(await listBrandColors(asB, A)).toEqual([])
      expect(await slotRows(A)).toEqual([{ id: witness, name: 'Primary', hex: '#123456', note: null, slot: 'primary' }])
    } finally {
      await svc.from('brand_colors').delete().eq('artist_id', B)
    }
  })
})
