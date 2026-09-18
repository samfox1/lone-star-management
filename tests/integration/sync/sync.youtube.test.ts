// YouTube video sync against the real database.
/**
 * PHASE 4 (Videos) — YouTube video sync (real DB). Same conflict policy: insert
 * new, refresh youtube-owned, never clobber a manual video; RLS-scoped.
 *
 * WHY THE ARTISTS ARE THROWAWAYS (AGENTS.md rule 6). This file used to run on the shared
 * seed artists and wipe their `videos` after every test — a teardown that destroys rows the
 * file never created, on the live hosted project. It also left the tenancy test below
 * asserting "artist B holds 0 rows" as proof that a cross-tenant write was refused, which
 * the teardown itself guaranteed. Both artists are created here and dropped here, so the
 * blanket wipe IS "exactly what I created", the absolute counts are true about a genuinely
 * empty table, and B now carries a PLANTED row so the refusal has something to refuse.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncYouTubeVideos } from '@/lib/sync'
import type { YouTubeVideoInput } from '@/lib/youtube'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const asB = await signInAs(SEED.managerB)
  artistA = (await createThrowawayArtist(svc, 'YouTube sync A', asA)).id
  artistB = (await createThrowawayArtist(svc, 'YouTube sync B', asB)).id
})

afterAll(async () => {
  // One statement, and the cascade takes every child row either artist ever held.
  await deleteThrowawayArtist(svc, artistA)
  await deleteThrowawayArtist(svc, artistB)
})

afterEach(async () => {
  // Safe as a blanket wipe ONLY because both artists were created by this file.
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
    // A PLANTED WITNESS (AGENTS.md rule 2). This used to assert that B held ZERO rows
    // afterwards — a fact the teardown established before the sync was ever attempted, so
    // it read as protection while passing whether or not RLS refused anything. With a row
    // already there, "B's data is untouched" is a claim about a table that HAS content,
    // and a write that landed would show up as a second row.
    const { error: plantErr } = await svc.from('videos').insert({ artist_id: artistB, title: "B's own video", provider: 'youtube', embed_url: 'https://www.youtube.com/embed/bOwn', source: 'manual' })
    expect(plantErr, 'the witness must exist before the denial means anything').toBeNull()

    await expect(syncYouTubeVideos(asA, artistB, [yt('yt-evil', 'evil')])).rejects.toThrow(/row-level security/i)

    const { data: after } = await svc.from('videos').select('title').eq('artist_id', artistB)
    expect(after).toHaveLength(1) // the witness, and nothing the sync tried to add
    expect(after![0].title).toBe("B's own video")
  })
})
