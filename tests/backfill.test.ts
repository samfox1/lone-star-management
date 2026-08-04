/**
 * PHASE 0 — the versioning migration backfilled existing artists, so every
 * currently-live site still renders (no regression at cutover).
 */
import { describe, expect, it } from 'vitest'
import { anonClient } from './helpers/supabase'

describe('migration backfill kept live sites live', () => {
  it.each(['lone-pine', 'gulf-static', 'skeen'])(
    '%s still renders a published profile after the versioning migration',
    async (slug) => {
      const { data } = await anonClient().rpc('get_public_site', { p_slug: slug })
      expect(data).not.toBeNull()
      const artist = (data as { artist?: Record<string, unknown> }).artist
      // Every backfilled profile field is PRESENT. Deliberately a subset check, not an
      // exact key set: a snapshot carries whatever ARTIST_SNAPSHOT held when it was
      // published, so an artist republished since 20260804120000 also carries the
      // press-kit fields while one that hasn't does not. Both must still render, which
      // is the actual claim here. The exact public key set is pinned once, in
      // public-read.isolation.test.ts.
      for (const key of ['bio', 'hero_image_url', 'id', 'name', 'slug', 'spotify_artist_id', 'template']) {
        expect(Object.keys(artist!)).toContain(key)
      }
      expect(artist!.name).toBeTruthy()
      expect(artist!.slug).toBe(slug)
    },
  )
})
