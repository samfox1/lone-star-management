// The public payload carries the newest publish time, so a sitemap tracks publishes not the
//   clock.
/**
 * `published_at` on the public payload (SEO_GEO_PLAN B1, 20260826150000): the newest
 * revision for the artist, so a site's sitemap lastmod tracks publishes, not the clock.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). The media row was already deleted by
 * id, but `publishContent(asA, 'media', artistA)` is CATALOG-WIDE: against the shared seed
 * artist each of the three publishes here committed every pending photo that artist had —
 * including the teardown's, whose whole job was to undo this file's work. The stamp
 * assertions were leaning on the same shared state from the other side: `before` had to be
 * truthy, which was true only because somebody else had published to that artist at some
 * point. On an artist this file owns, `publishProfile` below is what makes it true, and it
 * is visible.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent, publishProfile } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
let mediaId: string | null = null

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Published-at live', asA)
  artistA = tenantA.id
  // The door returns NULL without a published `artist` revision, and a NULL payload makes
  // `published_at` null — which would fail loudly here rather than pass, but it is also
  // the first publish the stamp has to move on from, so it is explicit.
  await publishProfile(svc, artistA)
  const { data } = await anonClient().rpc('get_public_site', { p_slug: tenantA.slug })
  expect(data, 'get_public_site must answer for the throwaway artist').not.toBeNull()
})
afterAll(async () => {
  await deleteThrowawayArtist(svc, tenantA)
})

async function publishedAt(): Promise<string | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: tenantA.slug })
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
