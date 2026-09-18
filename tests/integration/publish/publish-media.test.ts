// Media is draft until published, and a deleted row is tombstoned on republish.
/**
 * PHASE 0 — media is draft → publish (and tombstones on delete + republish).
 * Media is read by the public site from published revisions, not the live table.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). The four rows were already deleted by
 * id — the right shape for rows, and it is not the problem. `publishContent(asA, 'media',
 * artistA)` is CATALOG-WIDE: run against the shared seed artist, each of the four publishes
 * here pushed every pending photo that artist had onto their live site, and the teardown
 * then published a FIFTH time trying to tombstone this file's own rows back off — each
 * attempt at tidiness committing more of somebody else's draft. On an owned artist the
 * publish has nothing to reach but this file's fixtures, and the teardown is one delete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent, publishProfile } from '@/lib/content'
import { getWorkingSitePayload } from '@/lib/site'
import { MEDIA_KINDS } from '@samfox1/site-bridge/payload'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const PATH = '%ARTIST%/profile/phase0-media-test.jpg'

type WireMediaRow = { path: string; collection?: string | null; label?: string | null; alt?: string | null; kind?: string | null }

async function publicMedia(): Promise<WireMediaRow[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: tenantA.slug })
  return (data as { media?: WireMediaRow[] } | null)?.media ?? []
}

async function publicMediaPaths(): Promise<string[]> {
  return (await publicMedia()).map((m) => m.path)
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Publish media', asA)
  artistA = tenantA.id
  // The door returns NULL for an artist with no published `artist` revision, and every
  // "not on the public site yet" assertion below is true of a NULL payload.
  await publishProfile(svc, artistA)
  const { data } = await anonClient().rpc('get_public_site', { p_slug: tenantA.slug })
  expect(data, 'get_public_site must answer for the throwaway artist').not.toBeNull()
})

afterAll(async () => {
  // Cascades the media rows and every revision published off them. Nothing to tombstone:
  // the site this file published to is going away with the artist.
  await deleteThrowawayArtist(svc, tenantA)
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

  it("CRITICAL: a photo's COLLECTION reaches the wire — the tag is useless to a site otherwise", async () => {
    // Three places must agree for a two-pool site (ftbk) to work: the column
    // (20260821120000), the snapshot list (lib/content.ts PUBLISHABLE.media), and the
    // door's cherry-pick (20260821130000). A miss in any one of them leaves the manager
    // sorting photos into a pool the site can't see, with nothing failing anywhere.
    const fullPath = `${artistA}/gallery/phase0-collection-test.jpg`
    const { error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: fullPath, on_site: true, collection: 'photos' })
      .select('id')
      .single()
    expect(error).toBeNull()

    await publishContent(asA, 'media', artistA)
    const wire = (await publicMedia()).find((m) => m.path === fullPath)
    expect(wire).toBeTruthy()
    expect(wire!.collection).toBe('photos')

    // …and an ordinary gallery row still says nothing, which is what "the first declared
    // collection" is encoded as. Asserted on THIS suite's own untagged row (above), so it
    // cannot pass by finding some other artist's photo.
    const untagged = (await publicMedia()).find((m) => m.path.endsWith('phase0-media-test.jpg'))
    if (untagged) expect(untagged.collection ?? null).toBeNull()
  })

  it("CRITICAL: a photo's ALT TEXT and KIND reach the wire AND the preview (SEO_GEO_PLAN B6b)", async () => {
    // Same three-way agreement as `collection`: column (20260826120000), snapshot list,
    // door cherry-pick. Plus a fourth: getWorkingSitePayload, which the editor preview
    // and custom-site draft read — `collection` was missing there and nothing failed.
    const fullPath = `${artistA}/gallery/phase0-alt-kind-test.jpg`
    const kind = MEDIA_KINDS[1] // 'artwork' — from the registry, not a literal
    const { error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: fullPath, on_site: true, collection: 'photos', alt: 'Skeen at Smartbar, 2024', kind })
      .select('id')
      .single()
    expect(error).toBeNull()

    await publishContent(asA, 'media', artistA)
    const wire = (await publicMedia()).find((m) => m.path === fullPath)
    expect(wire).toBeTruthy()
    expect(wire!.alt).toBe('Skeen at Smartbar, 2024')
    expect(wire!.kind).toBe(kind)

    const working = (await getWorkingSitePayload(asA, artistA))!.media.find((m) => m.path === fullPath)
    expect(working).toBeTruthy()
    // Every key the door emits, the preview emits with the same value.
    for (const key of Object.keys(wire!)) {
      expect((working as Record<string, unknown>)[key], key).toEqual((wire as Record<string, unknown>)[key])
    }
  })

  it("an image uploaded with NO kind ships as 'photo' — the preset (20260826130000)", async () => {
    // The first test's row was inserted without a kind and is published above; the
    // column default, not the site, is what assigns the preset.
    const wire = (await publicMedia()).find((m) => m.path.endsWith('phase0-alt-kind-test.jpg'))
    expect(wire).toBeTruthy()
    const { data } = await asA.from('media').insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/gallery/phase0-default-kind.jpg` }).select('id, kind').single()
    expect(data?.kind).toBe(MEDIA_KINDS[0])
  })

  it('rejects a kind outside the registry (CHECK 23514, not RLS: the manager owns the row)', async () => {
    const { error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/gallery/phase0-bad-kind.jpg`, kind: 'sculpture' })
      .select('id')
      .single()
    expect(error?.code).toBe('23514')
  })
})
