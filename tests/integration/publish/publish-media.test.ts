// Media is draft until published, and a deleted row is tombstoned on republish.
/**
 * PHASE 0 — media is draft → publish (and tombstones on delete + republish).
 * Media is read by the public site from published revisions, not the live table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent } from '@/lib/content'
import { getWorkingSitePayload } from '@/lib/site'
import { MEDIA_KINDS } from '@samfox1/site-bridge/payload'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const PATH = '%ARTIST%/profile/phase0-media-test.jpg'
/** The media row this file created. Teardown removes ONLY it: the project is shared and
 *  live, so deleting every media row for the artist erases photos nothing here uploaded
 *  and leaves the media-dependent suites after it asserting over an empty gallery. */
let mediaId: string | null = null
/** The collection-tagged row the second test plants — deleted by id, same rule. */
let taggedId: string | null = null
/** The alt/kind row the third test plants — deleted by id, same rule. */
let namedId: string | null = null
let defaultId: string | null = null

type WireMediaRow = { path: string; collection?: string | null; label?: string | null; alt?: string | null; kind?: string | null }

async function publicMedia(): Promise<WireMediaRow[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as { media?: WireMediaRow[] } | null)?.media ?? []
}

async function publicMediaPaths(): Promise<string[]> {
  return (await publicMedia()).map((m) => m.path)
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  for (const id of [mediaId, taggedId, namedId, defaultId]) {
    if (!id) continue
    await svc.from('media').delete().eq('id', id)
    await svc.from('revisions').delete().eq('entity_id', id)
  }
  // The tagged row was published, so it lives in the media snapshot until the next
  // publish tombstones it — otherwise it lingers on the seed artist's public site.
  if (taggedId || namedId) await publishContent(asA, 'media', artistA)
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
    mediaId = row!.id as string

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
    const { data: row, error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: fullPath, on_site: true, collection: 'photos' })
      .select('id')
      .single()
    expect(error).toBeNull()
    taggedId = row!.id as string

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
    const { data: row, error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: fullPath, on_site: true, collection: 'photos', alt: 'Skeen at Smartbar, 2024', kind })
      .select('id')
      .single()
    expect(error).toBeNull()
    namedId = row!.id as string

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
    defaultId = (data?.id as string) ?? null
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
