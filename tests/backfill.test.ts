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
      // All seven public-safe profile fields are present and the name is populated.
      expect(Object.keys(artist!).sort()).toEqual(
        ['bio', 'hero_image_url', 'id', 'name', 'slug', 'spotify_artist_id', 'template'].sort(),
      )
      expect(artist!.name).toBeTruthy()
      expect(artist!.slug).toBe(slug)
    },
  )
})
