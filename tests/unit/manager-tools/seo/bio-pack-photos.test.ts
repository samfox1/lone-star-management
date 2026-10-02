/**
 * The Apple Music & Amazon bio email offers the profile photo first, so it is the one attached by
 * default, and a file shared with a library photo only once.
 *
 * Code:     src/lib/manager-tools/seo/profiles/bio-pack.ts (packPhotoRows), read by
 *           tools/seo/profiles/load.ts
 * Feature:  SEO tool · Profiles tab · the AllMusic bio email's photo (PROFILE_TOOL_PLAN.md: "the
 *           AllMusic bio email attaches it by default")
 * Tier:     LIGHT (AGENTS.md "Test depth"): one main path. It picks the default; the manager can
 *           pick another.
 * Covers:   the profile photo first wherever it sorts; a file the profile photo SHARES with its
 *           library photo (lib/profile-photo.ts) offered once; on-site photos before the rest;
 *           artwork and files a mail app can't attach left out.
 * Not here: the email itself (bio-pack.test.ts); the picker on screen.
 * Fixtures: rows in the shape load.ts reads (purpose, storage_path, on_site, kind).
 */
import { describe, expect, it } from 'vitest'
import { packPhotoRows } from '@/lib/manager-tools/seo/profiles/bio-pack'

const row = (purpose: string, storage_path: string, on_site: boolean | null = false, kind: string | null = 'photo') => ({ purpose, storage_path, on_site, kind })

describe('packPhotoRows', () => {
  // The order is the default: the profile photo, then the site's photos, then the rest, each file once.
  it('the profile photo first, its library twin once, then on-site photos, then the rest', () => {
    const rows = [
      row('gallery_image', 'a/gallery/off.jpg'),
      row('gallery_image', 'a/gallery/me.jpg', true),
      row('gallery_image', 'a/gallery/on.jpg', true),
      row('gallery_image', 'a/gallery/cover.jpg', true, 'artwork'),
      row('gallery_image', 'a/gallery/clip.gif', true),
      row('profile_photo', 'a/gallery/me.jpg', true, null),
    ]
    expect(packPhotoRows(rows).map((r) => [r.purpose, r.storage_path])).toEqual([
      ['profile_photo', 'a/gallery/me.jpg'],
      ['gallery_image', 'a/gallery/on.jpg'],
      ['gallery_image', 'a/gallery/off.jpg'],
    ])
  })
})
