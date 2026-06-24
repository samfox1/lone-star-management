/**
 * PHASE 0 — media is draft → publish (and tombstones on delete + republish).
 * Media is read by the public site from published revisions, not the live table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const PATH = '%ARTIST%/profile/phase0-media-test.jpg'

async function publicMediaPaths(): Promise<string[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { media?: { path: string }[] } | null)?.media ?? []).map((m) => m.path)
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('media').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'media')
})

describe('media is draft until published', () => {
  const path = PATH.replace('%ARTIST%', '')

  it('CRITICAL: uploaded media is not on the public site until publish; tombstones on delete', async () => {
    const fullPath = `${artistA}/profile/phase0-media-test.jpg`
    const { data: row, error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'profile_photo', storage_path: fullPath })
      .select('id')
      .single()
    expect(error).toBeNull()

    // Draft: not referenced by the public site yet.
    expect(await publicMediaPaths()).not.toContain(fullPath)

    // Publish → live.
    await publishContent(asA, 'media', artistA)
    expect(await publicMediaPaths()).toContain(fullPath)

    // Delete the working row + republish → tombstoned, gone from public.
    await asA.from('media').delete().eq('id', row!.id)
    await publishContent(asA, 'media', artistA)
    expect(await publicMediaPaths()).not.toContain(fullPath)

    void path
  })
})
