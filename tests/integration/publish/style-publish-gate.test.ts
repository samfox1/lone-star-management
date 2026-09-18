// A style edit is draft until published; it does not go straight to the live site.
/**
 * Style rows must ride the publish window (skeen brief, 2026-08-03).
 *
 * The brief reported that a style edit goes straight to the LIVE site with no Publish
 * in between. This test settles it against the real door: a working `site_styles` row
 * must NOT appear in `get_public_site` until `publishContent('site_styles')` runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent, publishProfile } from '@/lib/content'
import { saveEditorStyle } from '@/lib/site-editor/save'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

/**
 * WHY THE ARTIST IS A THROWAWAY (2026-09-18). Two writes here are not this file's to
 * make on a shared artist. `publishContent(…, 'site_styles')` commits every style draft
 * the artist has pending — a manager mid-edit finds their work published by a test run —
 * and the teardown deleted EVERY `site_styles` revision the artist owns, which is the
 * styling publish history the version picker reads. Neither can be narrowed to "rows
 * this test created", because the publish is by definition catalog-wide.
 */
let artist: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const KEY = 'style_gate_probe'

async function publicStyles(): Promise<Record<string, string>> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
  return ((data as { styles?: Record<string, string> } | null)?.styles ?? {}) as Record<string, string>
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = await createThrowawayArtist(svc, 'Style publish gate', asA)
  artistA = artist.id
  // `get_public_site` answers NULL until an `artist` revision exists, and `publicStyles`
  // reads `{}` out of null — which would make the two "not live yet" assertions below
  // pass on a site that does not exist. The profile publish is what makes the door real.
  await publishProfile(asA, artistA)
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artist)
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
