// Writing or clearing the style row for a region, against the real database.
/**
 * saveEditorStyle (live). The style write path resolves a region key + cleans the typed
 * class text, then upserts/clears a `site_styles` row (blank clears → base classes). RLS
 * scopes every write to the caller's tenant. Runs against the seeded DB as the manager,
 * restoring what it touches.
 *
 * The PURE half — `cleanClassText`, the XSS refusal — moved to
 * `tests/unit/site-editor/clean-class-text.test.ts`. It bit here too, but
 * `tests/integration/**` is excluded from `vitest.mutation.config.ts`, so from here it
 * could never be seen by Stryker; the refusal would have read as an unwatched survivor
 * for as long as it sat in this file.
 *
 * TENANCY, AND WHY THE ARTISTS ARE THROWAWAYS. This file used to run on the shared seed
 * artists and tear down with `delete().eq('artist_id', artistA).in('region_key', […])`.
 * Two of those keys are invented here, but `slot:polaroid_1_photo` is the REAL shape a
 * component slot uses — it is in this file precisely because a real one once failed —
 * so on the LIVE hosted project the teardown could delete a styling the artist actually
 * set, and the test's own pre-delete would have overwritten it first. Nothing scoped the
 * tenant-B row the denial test may create either, so a broken denial left its evidence
 * in the database indefinitely.
 *
 * Both artists are created and dropped by this file now: teardown is the artist row and
 * cascades every site_styles row, whatever key it carries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEditorStyle } from '@/lib/site-editor/save'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

describe('saveEditorStyle (live)', () => {
  const REGION = 'test_hero_wordmark'
  const ITEM_REGION = 'videos:00000000-0000-0000-0000-000000000001'
  // A component-slot per-item key carries UNDERSCORES after the colon — this was rejected,
  // so the per-item editor reported "save failed" on every polaroid slot.
  const SLOT_REGION = 'slot:polaroid_1_photo'
  let a: ThrowawayArtist
  let b: ThrowawayArtist
  let artistA: string
  let artistB: string
  let asA: SupabaseClient
  const svc = serviceClient()

  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    const asB = await signInAs(SEED.managerB)
    a = await createThrowawayArtist(svc, 'editor style A', asA)
    b = await createThrowawayArtist(svc, 'editor style B', asB)
    artistA = a.id
    artistB = b.id
  })

  afterAll(async () => {
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, b)
  })

  it('rejects an unknown region key shape', async () => {
    expect(await saveEditorStyle(asA, artistA, 'bad key!', 'font-momo')).toEqual({ ok: false, error: 'Unknown region.' })
  })

  it('rejects class text with disallowed characters', async () => {
    const res = await saveEditorStyle(asA, artistA, REGION, 'a"><b>')
    expect(res.ok).toBe(false)
  })

  it('upserts a class override for a section region and clears it when blank', async () => {
    await svc.from('site_styles').delete().eq('artist_id', artistA).eq('region_key', REGION)

    expect((await saveEditorStyle(asA, artistA, REGION, 'font-momo uppercase')).ok).toBe(true)
    const { data: set } = await svc
      .from('site_styles')
      .select('class_names')
      .eq('artist_id', artistA)
      .eq('region_key', REGION)
      .maybeSingle<{ class_names: string }>()
    expect(set?.class_names).toBe('font-momo uppercase')

    expect((await saveEditorStyle(asA, artistA, REGION, '   ')).ok).toBe(true)
    const { data: cleared } = await svc
      .from('site_styles')
      .select('class_names')
      .eq('artist_id', artistA)
      .eq('region_key', REGION)
      .maybeSingle()
    expect(cleared).toBeNull()
  })

  it('accepts a per-item region key (<slot>:<uuid>)', async () => {
    expect((await saveEditorStyle(asA, artistA, ITEM_REGION, 'rounded border-4')).ok).toBe(true)
    const { data } = await svc
      .from('site_styles')
      .select('class_names')
      .eq('artist_id', artistA)
      .eq('region_key', ITEM_REGION)
      .maybeSingle<{ class_names: string }>()
    expect(data?.class_names).toBe('rounded border-4')
  })

  it('accepts a component-slot key (underscores after the colon) + arbitrary px classes', async () => {
    // Regression: `slot:polaroid_1_photo` used to fail isRegionKey → "save failed" in the
    // per-item editor. Arbitrary-value widths/radii (border-[3px]) must also clean through.
    expect((await saveEditorStyle(asA, artistA, SLOT_REGION, 'scale-110 border-[3px] rounded-[6px]')).ok).toBe(true)
    const { data } = await svc
      .from('site_styles')
      .select('class_names')
      .eq('artist_id', artistA)
      .eq('region_key', SLOT_REGION)
      .maybeSingle<{ class_names: string }>()
    expect(data?.class_names).toBe('scale-110 border-[3px] rounded-[6px]')
  })

  it("CRITICAL: RLS blocks writing another tenant's style", async () => {
    await saveEditorStyle(asA, artistB, REGION, 'HACKED')
    const { data: after } = await svc
      .from('site_styles')
      .select('class_names')
      .eq('artist_id', artistB)
      .eq('region_key', REGION)
      .maybeSingle()
    expect(after).toBeNull() // nothing INSERTED for tenant B

    // …and the UPDATE half of the upsert, with a PLANTED witness (AGENTS.md rule 2).
    // Absence alone only proves the insert was refused; the row B really has is the one
    // worth defacing, and a denied update returns error:null with zero rows matched, so
    // the row's STATE is the only honest evidence (rule 3).
    const { error: plantErr } = await svc
      .from('site_styles')
      .insert({ artist_id: artistB, region_key: REGION, class_names: 'font-bteal' })
    expect(plantErr, 'the witness must exist before the denial means anything').toBeNull()

    await saveEditorStyle(asA, artistB, REGION, 'HACKED')
    const { data: still } = await svc
      .from('site_styles')
      .select('class_names')
      .eq('artist_id', artistB)
      .eq('region_key', REGION)
      .single<{ class_names: string }>()
    expect(still!.class_names).toBe('font-bteal')

    // The clear path cannot delete it either — saveEditorStyle treats blank as "remove".
    await saveEditorStyle(asA, artistB, REGION, '   ')
    const { count } = await svc
      .from('site_styles')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
      .eq('region_key', REGION)
    expect(count).toBe(1)
  })
})
