/**
 * MUSIC RESTRUCTURE — the three public doors expose RELEASED music only
 * (20260709120000_public_music_released_only). Released/Unreleased is derived
 * from snapshot provenance, mirroring lib/music.ts: a release is Unreleased iff
 * it has no platform presence (manual + no spotify_id + empty links); a track
 * inherits its release's bucket, and a loose track is Unreleased iff it carries
 * no platform linkage. Also locks in: the album_name string-match fallback in
 * get_release is GONE (tracklist membership is release_id only), and snapshots
 * missing provenance keys (published before this change) classify as Released.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

// Track ids captured in beforeAll, for the audio-door assertions.
const id: Record<string, string> = {}

async function audioPath(trackId: string): Promise<string | null> {
  const { data } = await anonClient().rpc('audio_path_for_play', {
    p_slug: SEED.artistASlug,
    p_track_id: trackId,
  })
  return (data as string | null) ?? null
}

type Row = { id: string }

/** createContent + return the new row id (matched by unique title). */
async function makeTrack(title: string, extra: Record<string, unknown> = {}, patch: Record<string, unknown> = {}) {
  await createContent(asA, 'track', artistA, { title, ...extra })
  const { data } = await svc.from('tracks').select('id').eq('artist_id', artistA).eq('title', title).single<Row>()
  if (Object.keys(patch).length) await svc.from('tracks').update(patch).eq('id', data!.id)
  return data!.id
}

async function makeRelease(title: string, slug: string, patch: Record<string, unknown> = {}) {
  await createContent(asA, 'release', artistA, { title, slug, links: [] })
  const { data } = await svc.from('releases').select('id').eq('artist_id', artistA).eq('slug', slug).single<Row>()
  if (Object.keys(patch).length) await svc.from('releases').update(patch).eq('id', data!.id)
  return data!.id
}

async function publicSiteTracks(): Promise<{ title: string }[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data?.tracks as { title: string }[] | null) ?? []
}

async function releasePage(slug: string): Promise<{ title: string; tracks: { title: string }[] } | null> {
  const { data } = await anonClient().rpc('get_release', { p_artist_slug: SEED.artistASlug, p_release_slug: slug })
  return data as { title: string; tracks: { title: string }[] } | null
}

async function publicReleases(): Promise<{ title: string }[]> {
  const { data } = await anonClient().rpc('get_public_releases', { p_slug: SEED.artistASlug })
  return (data as { title: string }[] | null) ?? []
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)

  // A RELEASED release (has a spotify_id) with one manual track inside it.
  const pubAlbum = await makeRelease('Public Album', 'pub-album', { spotify_id: 'sp-album-1' })
  await makeTrack('Album Cut', {}, { release_id: pubAlbum })

  // An UNRELEASED release (manual, no spotify_id, links []) with one track inside it.
  const secretEp = await makeRelease('Secret EP', 'secret-ep')
  await makeTrack('Secret Song', {}, { release_id: secretEp })

  // A platform-linked song assigned to that UNRELEASED release. Widen-only (#4):
  // its own linkage keeps it Released — it must NOT vanish just because the album
  // it sits in is Unreleased.
  await makeTrack('Linked In Secret EP', { stream_url: 'https://open.spotify.com/track/lise' }, { release_id: secretEp })

  // A loose UPLOADED track: manual, hosted audio, no platform linkage → Unreleased.
  id.demo = await makeTrack('Bedroom Demo', {}, { source: 'manual', audio_path: `${artistA}/demo.mp3` })

  // A loose track with a stream link → on a platform → Released.
  await makeTrack('On Platforms', { stream_url: 'https://open.spotify.com/track/xyz' })

  // A hand-added song with hosted audio and NO links, marked released by the
  // manager (the add-song toggle) → public despite zero platform presence.
  id.mbr = await makeTrack('Manual But Released', {}, {
    source: 'manual',
    audio_path: `${artistA}/mbr.mp3`,
    released: true,
  })

  // A RELEASED but HIDDEN release (visible=false) with an audio track inside it:
  // taken off-site, so neither its tracklist nor its audio may leak (#12).
  const hiddenAlbum = await makeRelease('Hidden Album', 'hidden-album', {
    spotify_id: 'sp-hidden-1',
    visible: false,
  })
  id.hiddenCut = await makeTrack('Hidden Cut', {}, {
    release_id: hiddenAlbum,
    source: 'manual',
    audio_path: `${artistA}/hidden.mp3`,
  })

  // Released loose track whose album_name matches the released release's TITLE but
  // with NO release_id — under the old string-match fallback it would have appeared
  // in the pub-album tracklist; now membership is release_id only.
  await makeTrack('Fallback Song', { stream_url: 'https://open.spotify.com/track/fb' }, { album_name: 'Public Album' })

  await publishContent(asA, 'release', artistA)
  await publishContent(asA, 'track', artistA)

  // Backward compat: a snapshot published BEFORE provenance fields existed (no
  // source/ids keys at all) must classify as Released — already-published tracks
  // stay public. Synthesized directly in the publish log like a real old row.
  await svc.from('revisions').insert({
    artist_id: artistA,
    entity_type: 'track',
    entity_id: crypto.randomUUID(),
    data: { id: crypto.randomUUID(), title: 'Legacy Snapshot', sort_order: 99 },
  })
})

afterAll(async () => {
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('releases').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).in('entity_type', ['track', 'release'])
})

describe('get_public_site — tracks are Released-only', () => {
  it('shows released music: platform-linked loose tracks and tracks inside a released release', async () => {
    const titles = (await publicSiteTracks()).map((t) => t.title)
    expect(titles).toContain('Album Cut') // inherits the released release's bucket
    expect(titles).toContain('On Platforms')
    expect(titles).toContain('Fallback Song')
    expect(titles).toContain('Manual But Released') // the manual released flag
  })

  it('hides unreleased music: uploaded-only loose tracks and tracks inside an unreleased release', async () => {
    const titles = (await publicSiteTracks()).map((t) => t.title)
    expect(titles).not.toContain('Bedroom Demo')
    expect(titles).not.toContain('Secret Song') // inherits the unreleased release's bucket
  })

  it('keeps a platform-linked song visible even inside an unreleased release (widen-only, #4)', async () => {
    const titles = (await publicSiteTracks()).map((t) => t.title)
    expect(titles).toContain('Linked In Secret EP')
  })

  it('treats provenance-less legacy snapshots as Released (nothing already public vanishes)', async () => {
    const titles = (await publicSiteTracks()).map((t) => t.title)
    expect(titles).toContain('Legacy Snapshot')
  })
})

describe('get_release — Unreleased excluded, album_name fallback gone', () => {
  it('serves a released release with its release_id tracklist', async () => {
    const page = await releasePage('pub-album')
    expect(page?.title).toBe('Public Album')
    expect(page?.tracks.map((t) => t.title)).toContain('Album Cut')
  })

  it('does NOT pull in tracks by album_name string match', async () => {
    const page = await releasePage('pub-album')
    expect(page?.tracks.map((t) => t.title)).not.toContain('Fallback Song')
  })

  it('returns null for an unreleased release', async () => {
    expect(await releasePage('secret-ep')).toBeNull()
  })
})

describe('get_public_releases — Unreleased excluded', () => {
  it('lists the released release only', async () => {
    const titles = (await publicReleases()).map((r) => r.title)
    expect(titles).toContain('Public Album')
    expect(titles).not.toContain('Secret EP')
  })
})

describe('audio_path_for_play — Released-only (#1)', () => {
  it('serves audio for a released track', async () => {
    expect(await audioPath(id.mbr)).toBe(`${artistA}/mbr.mp3`)
  })

  it('returns null for an unreleased / uploaded-only track', async () => {
    expect(await audioPath(id.demo)).toBeNull()
  })
})

describe('release visibility — hidden Released release does not leak (#12)', () => {
  it('hides its tracks from get_public_site even though it is Released', async () => {
    const titles = (await publicSiteTracks()).map((t) => t.title)
    expect(titles).not.toContain('Hidden Cut')
  })

  it('does not list the hidden release', async () => {
    expect((await publicReleases()).map((r) => r.title)).not.toContain('Hidden Album')
  })

  it('returns null audio for a track inside the hidden release', async () => {
    expect(await audioPath(id.hiddenCut)).toBeNull()
  })
})
