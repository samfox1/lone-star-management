/**
 * `published_at` on the public payload (SEO_GEO_PLAN B1, 20260826150000): the newest
 * revision for the artist, so a site's sitemap lastmod tracks publishes, not the clock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
let mediaId: string | null = null

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})
afterAll(async () => {
  if (mediaId) {
    await svc.from('media').delete().eq('id', mediaId)
    await svc.from('revisions').delete().eq('entity_id', mediaId)
    await publishContent(asA, 'media', artistA)
  }
})

async function publishedAt(): Promise<string | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as { published_at?: string | null } | null)?.published_at ?? null
}

describe('published_at on the wire', () => {
  it('CRITICAL: equals the newest revision, and moves when something is published', async () => {
    const before = await publishedAt()
    expect(before).toBeTruthy()

    const { data: row } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/gallery/published-at-test.jpg`, on_site: true })
      .select('id')
      .single()
    mediaId = row!.id as string
    // Draft: nothing published yet, so the stamp is unchanged.
    expect(await publishedAt()).toBe(before)

    await publishContent(asA, 'media', artistA)
    const after = await publishedAt()
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!))

    const { data: newest } = await svc
      .from('revisions')
      .select('published_at')
      .eq('artist_id', artistA)
      .order('published_at', { ascending: false })
      .limit(1)
      .single()
    expect(Date.parse(after!)).toBe(Date.parse(newest!.published_at as string))
  })

  it('CRITICAL: deleting content and publishing MOVES the stamp too (tombstones count, 20260826170000)', async () => {
    const before = await publishedAt()
    await asA.from('media').delete().eq('id', mediaId!)
    await publishContent(asA, 'media', artistA)
    const after = await publishedAt()
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!))
    mediaId = null // already gone; teardown has nothing to remove
  })
})
