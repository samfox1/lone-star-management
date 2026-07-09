/**
 * PHASE 5 (EPK) — get_public_releases(slug): the artist's PUBLISHED releases as a
 * list (for the EPK discography). Drafts excluded; RLS-irrelevant (it's a public
 * SECURITY DEFINER door returning only published, public-safe data).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('releases').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'release')
})

async function publicReleases(): Promise<{ title: string; slug: string }[]> {
  const { data } = await anonClient().rpc('get_public_releases', { p_slug: SEED.artistASlug })
  return (data as { title: string; slug: string }[] | null) ?? []
}

describe('get_public_releases', () => {
  it('lists published releases, excludes drafts', async () => {
    // A DSP link = platform presence: the door lists RELEASED releases only, and
    // a manual release with no links is Unreleased (dashboard-only). See lib/music.ts.
    const LINKS = [{ label: 'Spotify', url: 'https://open.spotify.com/album/one' }]
    await createContent(asA, 'release', artistA, { title: 'Published One', slug: 'pub-one', links: LINKS })
    await publishContent(asA, 'release', artistA)
    // a draft created AFTER publish (no revision yet)
    await createContent(asA, 'release', artistA, { title: 'Draft Two', slug: 'draft-two', links: LINKS })

    const titles = (await publicReleases()).map((r) => r.title)
    expect(titles).toContain('Published One')
    expect(titles).not.toContain('Draft Two')
  })
})
