/**
 * MUSIC doors after the Released/site DECOUPLING (20260710170000):
 *
 *  - The public site gates TRACKS on their own `tracks.visible` flag (like
 *    merch/videos), NOT on Released/Unreleased. Released is now a library-only
 *    organizing label — an Unreleased track with visible=true is public; a
 *    Released track with visible=false is not. `audio_path_for_play` follows the
 *    same visible gate.
 *  - The RELEASE doors (get_release / get_public_releases) are a separate surface
 *    and are unchanged: still Released-gated + visible, tracklist by release_id
 *    only (no album_name fallback).
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

  // ---- track fixtures: site visibility is now the per-track `visible` flag ----

  // An UNRELEASED-provenance track (manual, no platform link) that is on-site
  // (visible=true, the default) → proves Released no longer gates the site.
  id.shown = await makeTrack('Shown Unreleased', {}, {
    source: 'manual',
    audio_path: `${artistA}/shown.mp3`,
  })

  // A RELEASED-provenance track (has a stream link) taken OFF-site (visible=false)
  // → proves a Released track can be hidden.
  id.hidden = await makeTrack('Hidden Released', { stream_url: 'https://open.spotify.com/track/hid' }, {
    audio_path: `${artistA}/hidden.mp3`,
    visible: false,
  })

  // ---- release fixtures: the RELEASE doors are still Released-gated ----

  // A RELEASED release (has a spotify_id) with a track inside it.
  const pubAlbum = await makeRelease('Public Album', 'pub-album', { spotify_id: 'sp-album-1' })
  await makeTrack('Album Cut', {}, { release_id: pubAlbum })

  // An UNRELEASED release (manual, no spotify_id, links []).
  await makeRelease('Secret EP', 'secret-ep')

  // A loose track whose album_name matches the released release's TITLE but with
  // NO release_id — must NOT appear in the pub-album tracklist (membership is
  // release_id only).
  await makeTrack('Fallback Song', { stream_url: 'https://open.spotify.com/track/fb' }, { album_name: 'Public Album' })

  await publishContent(asA, 'release', artistA)
  await publishContent(asA, 'track', artistA)

  // A published snapshot with no matching live track row (legacy / orphan) shows,
  // because the visible join misses and coalesce(visible, true) keeps it.
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

describe('get_public_site — tracks gate on visible, not Released', () => {
  it('shows an UNRELEASED-provenance track when it is on-site (visible)', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Shown Unreleased')
  })

  it('hides a RELEASED-provenance track when it is off-site (visible=false)', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).not.toContain('Hidden Released')
  })

  it('shows a visible track that lives inside a release', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Album Cut')
  })

  it('shows a provenance-less legacy snapshot (no live row → coalesce visible)', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Legacy Snapshot')
  })
})

describe('audio_path_for_play — gates on visible', () => {
  it('serves audio for an on-site track', async () => {
    expect(await audioPath(id.shown)).toBe(`${artistA}/shown.mp3`)
  })

  it('returns null for an off-site (visible=false) track', async () => {
    expect(await audioPath(id.hidden)).toBeNull()
  })
})

describe('get_release — still Released-gated, album_name fallback gone', () => {
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

describe('get_public_releases — still Released-gated', () => {
  it('lists the released release only', async () => {
    const titles = (await publicReleases()).map((r) => r.title)
    expect(titles).toContain('Public Album')
    expect(titles).not.toContain('Secret EP')
  })
})
