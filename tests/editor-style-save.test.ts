/**
 * cleanClassText (pure) + saveEditorStyle (live). The style write path resolves a
 * region key + cleans the typed class text, then upserts/clears a `site_styles`
 * row (blank clears → base classes). RLS scopes every write to the caller's tenant.
 * The live half runs against the seeded DB as the manager, restoring what it touches.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanClassText, saveEditorStyle } from '@/lib/site-editor/save'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

describe('cleanClassText', () => {
  it('accepts Tailwind utilities, arbitrary values, and variants', () => {
    expect(cleanClassText('font-momo uppercase')).toBe('font-momo uppercase')
    expect(cleanClassText('  text-[clamp(3rem,12vw,11rem)]  ')).toBe('text-[clamp(3rem,12vw,11rem)]')
    expect(cleanClassText('hover:text-flash-1 sm:text-2xl !font-black')).toBe('hover:text-flash-1 sm:text-2xl !font-black')
  })

  it('treats blank/whitespace as a valid clear ("" — fall back to base)', () => {
    expect(cleanClassText('')).toBe('')
    expect(cleanClassText('   ')).toBe('')
  })

  it('REJECTS (null) characters that could break out of a class attribute', () => {
    expect(cleanClassText('a"><script>')).toBeNull()
    expect(cleanClassText("x' onclick=y")).toBeNull()
    expect(cleanClassText('a{b}')).toBeNull()
    expect(cleanClassText('`x`')).toBeNull()
  })

  it('REJECTS (null) an over-long string', () => {
    expect(cleanClassText('x'.repeat(501))).toBeNull()
    expect(cleanClassText('x'.repeat(500))).toBe('x'.repeat(500))
  })
})

describe('saveEditorStyle (live)', () => {
  const REGION = 'test_hero_wordmark'
  const ITEM_REGION = 'videos:00000000-0000-0000-0000-000000000001'
  let artistA: string
  let asA: SupabaseClient
  const svc = serviceClient()

  beforeAll(async () => {
    artistA = await artistIdBySlug(SEED.artistASlug)
    asA = await signInAs(SEED.managerA)
  })

  afterAll(async () => {
    await svc.from('site_styles').delete().eq('artist_id', artistA).in('region_key', [REGION, ITEM_REGION])
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
