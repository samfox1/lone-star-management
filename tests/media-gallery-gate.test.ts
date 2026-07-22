/**
 * get_public_site's GALLERY gate, and its snapshot back-compat across the
 * visible → on_site rename (20260714150000).
 *
 * `media` is the one publishable type that carries its on-site flag INSIDE the
 * published revision (PUBLISHABLE.media.snapshot) rather than being joined from
 * the live row — so the door gates gallery photos on the PUBLISHED selection.
 *
 * Revisions are immutable and are never rewritten, so snapshots published before
 * the rename still hold a `visible` key while new ones hold `on_site`. The door
 * coalesces both:
 *     coalesce((data->>'on_site')::boolean, (data->>'visible')::boolean, true)
 * These tests pin every arm of that expression — including real pre-rename rows,
 * which exist in production right now. The `visible` arm can only be dropped once
 * this file's "legacy key" cases are gone.
 *
 * The gate applies to gallery_image ONLY: hero_video / profile_photo are not
 * curated per-item and must never be filtered.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SEED, anonClient, artistIdBySlug, serviceClient } from './helpers/supabase'

let artistA: string
const svc = serviceClient()

/** Publish a media revision with a hand-built snapshot, so each test can pin an
 *  exact key shape (legacy `visible`, new `on_site`, both, or neither). */
async function publishMedia(data: Record<string, unknown>) {
  const entityId = crypto.randomUUID()
  const { error } = await svc.from('revisions').insert({
    artist_id: artistA,
    entity_type: 'media',
    entity_id: entityId,
    data: { id: entityId, ...data },
  })
  if (error) throw new Error(error.message)
}

async function galleryPaths(): Promise<string[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  const media = (data as { media?: { purpose: string; path: string }[] } | null)?.media ?? []
  return media.filter((m) => m.purpose === 'gallery_image').map((m) => m.path)
}

async function allMediaPaths(): Promise<string[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { media?: { path: string }[] } | null)?.media ?? []).map((m) => m.path)
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
})

afterEach(async () => {
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'media')
})

describe('get_public_site — gallery gate reads the published on-site flag', () => {
  it('shows a gallery photo published with on_site=true', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/new-on.jpg', on_site: true, sort_order: 1 })
    expect(await galleryPaths()).toContain('g/new-on.jpg')
  })

  it('hides a gallery photo published with on_site=false', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/new-off.jpg', on_site: false, sort_order: 1 })
    expect(await galleryPaths()).not.toContain('g/new-off.jpg')
  })
})

describe('get_public_site — gallery gate honours PRE-RENAME snapshots', () => {
  // These pin the coalesce fallback. Snapshots written before 20260714150000
  // carry `visible`; they are immutable, so the door must keep reading them.
  it('hides a legacy snapshot whose only flag is visible=false', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/old-off.jpg', visible: false, sort_order: 1 })
    expect(await galleryPaths()).not.toContain('g/old-off.jpg')
  })

  it('shows a legacy snapshot whose only flag is visible=true', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/old-on.jpg', visible: true, sort_order: 1 })
    expect(await galleryPaths()).toContain('g/old-on.jpg')
  })

  it('shows an ancient snapshot carrying NEITHER key (predates the flag)', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/ancient.jpg', sort_order: 1 })
    expect(await galleryPaths()).toContain('g/ancient.jpg')
  })

  it('prefers on_site when a snapshot somehow carries both keys', async () => {
    // coalesce reads on_site first, so the new key wins over a stale legacy one.
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/both.jpg', on_site: false, visible: true, sort_order: 1 })
    expect(await galleryPaths()).not.toContain('g/both.jpg')
  })
})

describe('get_public_site — gallery photos carry their orientation', () => {
  async function galleryMedia(): Promise<{ path: string; orientation: string | null }[]> {
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const media = (data as { media?: { purpose: string; path: string; orientation: string | null }[] } | null)?.media ?? []
    return media.filter((m) => m.purpose === 'gallery_image').map((m) => ({ path: m.path, orientation: m.orientation }))
  }

  it('emits each photo’s horizontal / vertical orientation on the payload', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/h.jpg', on_site: true, orientation: 'horizontal', sort_order: 1 })
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/v.jpg', on_site: true, orientation: 'vertical', sort_order: 2 })
    const media = await galleryMedia()
    expect(media.find((m) => m.path === 'g/h.jpg')?.orientation).toBe('horizontal')
    expect(media.find((m) => m.path === 'g/v.jpg')?.orientation).toBe('vertical')
  })

  it('emits null orientation for a legacy photo that never set one', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/legacy.jpg', on_site: true, sort_order: 1 })
    expect((await galleryMedia()).find((m) => m.path === 'g/legacy.jpg')?.orientation).toBeNull()
  })
})

describe('get_public_site — photos carry their component slot (site_role)', () => {
  async function mediaBySiteRole(): Promise<Record<string, string>> {
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const media = (data as { media?: { path: string; site_role: string | null }[] } | null)?.media ?? []
    return Object.fromEntries(media.filter((m) => m.site_role).map((m) => [m.site_role as string, m.path]))
  }

  it('emits the slot role a photo is placed in (a polaroid photo / handwriting)', async () => {
    // This is what lets skeen read a placed photo back onto the right polaroid card.
    await publishMedia({ purpose: 'gallery_image', storage_path: 'p/hand.png', on_site: true, site_role: 'polaroid_1_caption', sort_order: 1 })
    await publishMedia({ purpose: 'gallery_image', storage_path: 'p/shot.jpg', on_site: true, site_role: 'polaroid_1_photo', sort_order: 2 })
    const byRole = await mediaBySiteRole()
    expect(byRole['polaroid_1_caption']).toBe('p/hand.png')
    expect(byRole['polaroid_1_photo']).toBe('p/shot.jpg')
  })

  it('emits null site_role for an ordinary gallery photo', async () => {
    await publishMedia({ purpose: 'gallery_image', storage_path: 'g/plain.jpg', on_site: true, sort_order: 1 })
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const media = (data as { media?: { path: string; site_role: string | null }[] } | null)?.media ?? []
    expect(media.find((m) => m.path === 'g/plain.jpg')?.site_role).toBeNull()
  })
})

describe('get_public_site — the gate is gallery-only', () => {
  it('never filters non-gallery media, even with on_site=false', async () => {
    // hero_video / profile_photo are not per-item curated; the flag must be
    // ignored for them or a site loses its hero.
    await publishMedia({ purpose: 'profile_photo', storage_path: 'g/profile.jpg', on_site: false, sort_order: 1 })
    await publishMedia({ purpose: 'hero_video', storage_path: 'g/hero.mp4', on_site: false, sort_order: 2 })
    const paths = await allMediaPaths()
    expect(paths).toContain('g/profile.jpg')
    expect(paths).toContain('g/hero.mp4')
  })
})
