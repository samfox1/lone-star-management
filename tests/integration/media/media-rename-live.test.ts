// Renaming a file against the live project: the copy lands, and the old object survives.
/**
 * renameMedia against the live project: a real copy lands at {slug}.{ext} and the old
 * object survives for the snapshot that may still point at it (SEO_GEO_PLAN B6b).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renameMedia } from '@/lib/media-rename'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

describe('renameMedia (live)', () => {
  let artistA: string
  let asA: SupabaseClient
  const svc = serviceClient()
  let mediaId: string | null = null
  const paths: string[] = []
  const SLUG = `rename-test-${Math.random().toString(36).slice(2, 8)}`

  beforeAll(async () => {
    artistA = await artistIdBySlug(SEED.artistASlug)
    asA = await signInAs(SEED.managerA)
  })
  afterAll(async () => {
    if (mediaId) {
      await svc.from('media').delete().eq('id', mediaId)
      await svc.from('revisions').delete().eq('entity_id', mediaId)
    }
    if (paths.length) await svc.storage.from('media').remove(paths)
  })

  it('CRITICAL: the object is COPIED to {slug}.{ext}; the old object survives for the live snapshot', async () => {
    const uuid = crypto.randomUUID()
    const oldPath = `${artistA}/gallery/${uuid}.png`
    paths.push(oldPath)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const up = await asA.storage.from('media').upload(oldPath, png, { contentType: 'image/png' })
    expect(up.error).toBeNull()
    const { data: row, error } = await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: oldPath })
      .select('id')
      .single()
    expect(error).toBeNull()
    mediaId = row!.id as string

    const r = await renameMedia(asA, artistA, mediaId, SLUG)
    const newPath = `${artistA}/gallery/${SLUG}.png`
    paths.push(newPath)
    expect(r).toEqual({ storage_path: newPath })

    const { data: after } = await svc.from('media').select('storage_path, slug').eq('id', mediaId).single()
    expect(after).toEqual({ storage_path: newPath, slug: SLUG })
    // Both objects exist: the copy (what the row now names) and the original (what the
    // published snapshot may still name).
    const { data: listed } = await svc.storage.from('media').list(`${artistA}/gallery`, { limit: 1000, search: uuid })
    expect(listed?.some((o) => o.name === `${uuid}.png`)).toBe(true)
    const { data: copied } = await svc.storage.from('media').list(`${artistA}/gallery`, { limit: 1000, search: SLUG })
    expect(copied?.some((o) => o.name === `${SLUG}.png`)).toBe(true)
  })
})
