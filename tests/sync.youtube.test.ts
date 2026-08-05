/**
 * PHASE 4 (Videos) — YouTube video sync (real DB). Same conflict policy: insert
 * new, refresh youtube-owned, never clobber a manual video; RLS-scoped.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncYouTubeVideos } from '@/lib/sync'
import type { YouTubeVideoInput } from '@/lib/youtube'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  await svc.from('videos').delete().eq('artist_id', artistA)
  await svc.from('videos').delete().eq('artist_id', artistB)
})

const yt = (id: string, title: string, is_short = false): YouTubeVideoInput => ({
  youtube_id: id,
  title,
  provider: 'youtube',
  embed_url: `https://www.youtube.com/embed/${id}`,
  is_short,
})

describe('syncYouTubeVideos', () => {
  it('inserts new, refreshes youtube-owned, never clobbers manual', async () => {
    await svc.from('videos').insert([
      { artist_id: artistA, title: 'My Edit', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/m', youtube_id: 'yt-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/a', youtube_id: 'yt-auto', source: 'youtube' },
    ])

    const result = await syncYouTubeVideos(asA, artistA, [
      yt('yt-manual', 'SHOULD NOT OVERWRITE'),
      yt('yt-auto', 'Fresh'),
      yt('yt-new', 'Brand New'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc.from('videos').select('title, source, youtube_id, on_site').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.youtube_id, r]))
    expect(byId['yt-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    expect(byId['yt-auto']).toMatchObject({ title: 'Fresh', source: 'youtube' })
    // on_site is `not null default true` and the public doors coalesce to true, so the
    // insertDefaults `on_site: false` is the only thing keeping an import off the site.
    expect(byId['yt-new']).toMatchObject({ title: 'Brand New', source: 'youtube', on_site: false })
  })

  it('SKIPS Shorts — they are not used on artist sites, so the sync never imports them', async () => {
    const result = await syncYouTubeVideos(asA, artistA, [yt('yt-vid', 'A Video', false), yt('yt-short', 'A Short', true)])
    // Only the non-Short is added; the Short is filtered before the sync sees it.
    expect(result).toMatchObject({ added: 1, failed: 0 })
    const { data } = await svc.from('videos').select('youtube_id, is_short').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.youtube_id, r.is_short]))
    expect(byId['yt-vid']).toBe(false)
    expect(byId['yt-short']).toBeUndefined() // never inserted
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    // Assert Postgres refuses — a bare .toThrow() would pass on any incidental throw.
    await expect(syncYouTubeVideos(asA, artistB, [yt('yt-evil', 'evil')])).rejects.toThrow(/row-level security/i)
    const { count } = await svc.from('videos').select('id', { count: 'exact', head: true }).eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
