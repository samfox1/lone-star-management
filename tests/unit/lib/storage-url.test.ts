// The one home for `{origin}/storage/v1/object/public/{bucket}/{path}` — mediaUrl here,
// publicVideoSrc (lib/video-render) and fontUrl (lib/fonts) all route through it now
// instead of building the identical string independently (CODE_AUDIT.md item A).
//
// WHY `origin` falls back to `''`, not just to the env var: `mediaThumbUrl`'s sibling
// `mediaRenderPath` documented the bug this pins — a helper that read
// `NEXT_PUBLIC_SUPABASE_URL` directly returned a literal `undefined/storage/…` URL in
// CI's mutation job, which runs the DB-free slice with NO env at all (cover-url.ts:49-54
// tells the same story for `coverThumbUrl`). Falling back to `''` keeps that failure mode
// a plain, path-shaped string instead of the word "undefined" baked into a URL.
import { describe, expect, it, vi } from 'vitest'
import { mediaUrl, publicObjectUrl } from '@/lib/storage-url'

describe('publicObjectUrl', () => {
  it('builds {origin}/storage/v1/object/public/{bucket}/{path} from an explicit origin', () => {
    expect(publicObjectUrl('videos', 'artist-1/videos/clip.mp4', 'https://proj.supabase.co')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/videos/artist-1/videos/clip.mp4',
    )
  })

  it('strips a trailing slash off the origin, so the path never doubles up', () => {
    expect(publicObjectUrl('media', 'a.png', 'https://proj.supabase.co/')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/media/a.png',
    )
  })

  it('falls back to NEXT_PUBLIC_SUPABASE_URL when no origin is given', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://env-project.supabase.co')
    expect(publicObjectUrl('media', 'a.png')).toBe('https://env-project.supabase.co/storage/v1/object/public/media/a.png')
    vi.unstubAllEnvs()
  })

  it('CRITICAL: with NEXT_PUBLIC_SUPABASE_URL unset and no origin, the base is empty — never the string "undefined"', () => {
    // This is the exact condition CI's mutation job runs under: the DB-free slice has no
    // env at all. A helper that reads `process.env.NEXT_PUBLIC_SUPABASE_URL` without a
    // fallback interpolates `undefined` into the template literal and returns
    // "undefined/storage/v1/object/public/media/a.png" — a URL that looks plausible in a
    // snapshot but resolves nowhere. Proving the base is `''` here, not the literal word
    // "undefined", is what would have caught that regression before it shipped.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined)
    expect(publicObjectUrl('media', 'a.png')).toBe('/storage/v1/object/public/media/a.png')
    expect(publicObjectUrl('media', 'a.png')).not.toContain('undefined')
    vi.unstubAllEnvs()
  })
})

describe('mediaUrl', () => {
  it('is publicObjectUrl scoped to the media bucket, on the env origin', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://env-project.supabase.co')
    expect(mediaUrl('artist-1/photo.jpg')).toBe('https://env-project.supabase.co/storage/v1/object/public/media/artist-1/photo.jpg')
    vi.unstubAllEnvs()
  })

  it('CRITICAL: with the env unset, mediaUrl is still a path-shaped string, never "undefined/…"', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined)
    expect(mediaUrl('artist-1/photo.jpg')).toBe('/storage/v1/object/public/media/artist-1/photo.jpg')
    vi.unstubAllEnvs()
  })
})
