/**
 * Style rows must ride the publish window (skeen brief, 2026-08-03).
 *
 * The brief reported that a style edit goes straight to the LIVE site with no Publish
 * in between. This test settles it against the real door: a working `site_styles` row
 * must NOT appear in `get_public_site` until `publishContent('site_styles')` runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent } from '@/lib/content'
import { saveEditorStyle } from '@/lib/site-editor/save'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const KEY = 'style_gate_probe'

async function publicStyles(): Promise<Record<string, string>> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { styles?: Record<string, string> } | null)?.styles ?? {}) as Record<string, string>
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('site_styles').delete().eq('artist_id', artistA).eq('region_key', KEY)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'site_styles')
})

describe('site_styles ride the publish window', () => {
  it('CRITICAL: a saved style is NOT live until styles are published', async () => {
    const saved = await saveEditorStyle(asA, artistA, KEY, 'font-momo uppercase')
    expect(saved.ok).toBe(true)

    // Working row exists, but the public door must not serve it yet.
    expect((await publicStyles())[KEY]).toBeUndefined()

    await publishContent(asA, 'site_styles', artistA)
    expect((await publicStyles())[KEY]).toBe('font-momo uppercase')

    // Deleting the working row (a cleared style) is likewise not live until published.
    const cleared = await saveEditorStyle(asA, artistA, KEY, '')
    expect(cleared.ok).toBe(true)
    expect((await publicStyles())[KEY]).toBe('font-momo uppercase') // still the published value

    await publishContent(asA, 'site_styles', artistA)
    expect((await publicStyles())[KEY]).toBeUndefined()
  })
})
