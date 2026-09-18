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
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEditorStyle } from '@/lib/site-editor/save'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

describe('saveEditorStyle (live)', () => {
  const REGION = 'test_hero_wordmark'
  const ITEM_REGION = 'videos:00000000-0000-0000-0000-000000000001'
  // A component-slot per-item key carries UNDERSCORES after the colon — this was rejected,
  // so the per-item editor reported "save failed" on every polaroid slot.
  const SLOT_REGION = 'slot:polaroid_1_photo'
  let artistA: string
  let asA: SupabaseClient
  const svc = serviceClient()

  beforeAll(async () => {
    artistA = await artistIdBySlug(SEED.artistASlug)
    asA = await signInAs(SEED.managerA)
  })

  afterAll(async () => {
    await svc.from('site_styles').delete().eq('artist_id', artistA).in('region_key', [REGION, ITEM_REGION, SLOT_REGION])
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
    const artistB = await artistIdBySlug(SEED.artistBSlug)
    await saveEditorStyle(asA, artistB, REGION, 'HACKED')
    const { data: after } = await svc
      .from('site_styles')
      .select('class_names')
      .eq('artist_id', artistB)
      .eq('region_key', REGION)
      .maybeSingle()
    expect(after).toBeNull() // nothing written for tenant B
  })
})
