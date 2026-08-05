/**
 * Fonts are PUBLISH-GATED, proven against the real door.
 *
 * The whole pipeline in one round trip: an artist_fonts row is DRAFT work invisible to
 * get_public_site until publishContent('artist_font') snapshots it; after publish the
 * door's `fonts` array carries exactly the wire shape fontStyleCss consumes; removing
 * the row and republishing takes it back off the site (tombstone semantics).
 *
 * Runs as manager A against the live hosted project; every row this file creates is
 * deleted by id in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent } from '@/lib/content'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

const svc = serviceClient()
let artistA: string
let asA: SupabaseClient
let fontId: string | null = null

const FAMILY = 'pubtest-font-a'

async function doorFonts(): Promise<{ family: string; path: string; role: string | null }[]> {
  const { data } = await svc.rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { fonts?: { family: string; path: string; role: string | null }[] } | null)?.fonts ?? []).filter(
    (f) => f.family === FAMILY,
  )
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (fontId) await svc.from('artist_fonts').delete().eq('id', fontId)
  // Republish so no revision for this fixture survives the run.
  await publishContent(svc, 'artist_font', artistA)
  await svc
    .from('revisions')
    .delete()
    .eq('artist_id', artistA)
    .eq('entity_type', 'artist_font')
})

describe('fonts publish gate (live door)', () => {
  it('CRITICAL: an uploaded font is invisible to the door until published, then carried in wire shape', async () => {
    const { data: row, error } = await asA
      .from('artist_fonts')
      .insert({
        artist_id: artistA,
        label: 'Pubtest Font A',
        family: FAMILY,
        storage_path: `${artistA}/fonts/pubtest.woff2`,
        format: 'woff2',
        role: 'primary',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    fontId = row!.id as string

    // Draft: the door must NOT serve it yet.
    expect(await doorFonts()).toHaveLength(0)

    await publishContent(asA, 'artist_font', artistA)
    const published = await doorFonts()
    expect(published).toHaveLength(1)
    // The wire shape fontStyleCss consumes: `path`, not `storage_path`.
    expect(published[0]).toMatchObject({
      family: FAMILY,
      path: `${artistA}/fonts/pubtest.woff2`,
      role: 'primary',
    })

    // Removing the row and republishing takes it back off the site.
    await asA.from('artist_fonts').delete().eq('id', fontId)
    await publishContent(asA, 'artist_font', artistA)
    expect(await doorFonts()).toHaveLength(0)
  })
})
