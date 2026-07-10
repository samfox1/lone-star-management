/**
 * saveEditorField — the visual editor's draft write path. Resolves a field to its
 * manifest target and writes it: an artist column or a site_content key (blank
 * clears). RLS scopes every write to the caller's tenant. Runs against the live DB
 * as the seeded manager, restoring what it touches.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEditorField } from '@/lib/site-editor/save'
import { manifestFor } from '@/lib/site-editor/manifest'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
let template: string
let originalBio: string | null
const svc = serviceClient()

/** A site_content field of the artist's template, avoiding tracks_heading (used by
 *  preview-parity) so concurrent files don't collide. */
function siteContentField() {
  const f = manifestFor(template)!.fields.find((x) => x.target.store === 'site_content' && x.key !== 'tracks_heading')!
  return { fieldKey: f.key, contentKey: (f.target as { key: string }).key }
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  const { data } = await svc.from('artists').select('template, bio').eq('id', artistA).single<{ template: string; bio: string | null }>()
  template = data!.template
  originalBio = data!.bio
})

afterAll(async () => {
  await svc.from('artists').update({ bio: originalBio }).eq('id', artistA)
  await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', siteContentField().contentKey)
})

describe('saveEditorField', () => {
  it('rejects an unknown field', async () => {
    expect(await saveEditorField(asA, artistA, template, 'nope_key', 'x')).toEqual({
      ok: false,
      error: 'Unknown field.',
    })
  })

  it('writes an artist column (bio)', async () => {
    expect((await saveEditorField(asA, artistA, template, 'artist_bio', 'Editor-written bio')).ok).toBe(true)
    const { data } = await svc.from('artists').select('bio').eq('id', artistA).single<{ bio: string }>()
    expect(data!.bio).toBe('Editor-written bio')
  })

  it('upserts a site_content override and clears it when blank', async () => {
    const { fieldKey, contentKey } = siteContentField()
    await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', contentKey)

    expect((await saveEditorField(asA, artistA, template, fieldKey, 'Custom heading')).ok).toBe(true)
    const { data: set } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', contentKey)
      .maybeSingle<{ value: string }>()
    expect(set?.value).toBe('Custom heading')

    expect((await saveEditorField(asA, artistA, template, fieldKey, '   ')).ok).toBe(true)
    const { data: cleared } = await svc
      .from('site_content')
      .select('value')
      .eq('artist_id', artistA)
      .eq('key', contentKey)
      .maybeSingle()
    expect(cleared).toBeNull()
  })

  it("CRITICAL: RLS blocks writing another tenant's field", async () => {
    const artistB = await artistIdBySlug(SEED.artistBSlug)
    const { data: b } = await svc.from('artists').select('template, bio').eq('id', artistB).single<{ template: string; bio: string | null }>()
    await saveEditorField(asA, artistB, b!.template, 'artist_bio', 'HACKED')
    const { data: after } = await svc.from('artists').select('bio').eq('id', artistB).single<{ bio: string | null }>()
    expect(after!.bio).toBe(b!.bio) // untouched
  })
})
