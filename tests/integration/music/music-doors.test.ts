// The public music doors gate on the on-site flag, not on Released, after the two were
//   decoupled.
/**
 * MUSIC doors after the Released/site DECOUPLING (20260710170000):
 *
 *  - The public site gates TRACKS on their own `tracks.on_site` flag (like
 *    merch/videos), NOT on Released/Unreleased. Released is now a library-only
 *    organizing label — an Unreleased track with on_site=true is public; a
 *    Released track with on_site=false is not. `audio_path_for_play` follows the
 *    same on_site gate.
 *  - The RELEASE doors (get_release / get_public_releases) are a separate surface:
 *    Released-gated AND on-site-gated — both must pass — tracklist by release_id
 *    only (no album_name fallback).
 *
 * The on-site gate on get_release is asserted here because it was silently lost
 * once already: 20260709120000 rewrote the function and dropped the join, so an
 * off-site release kept serving its smart-link page while correctly vanishing
 * from the discography list. This header claimed "+ visible" the whole time —
 * nothing tested it. Restored in 20260714130000; the assertion is the guard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

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

  // ---- track fixtures: site presence is now the per-track `on_site` flag ----

  // An UNRELEASED-provenance track (manual, no platform link) that is on-site
  // (on_site=true, the default) → proves Released no longer gates the site.
  id.shown = await makeTrack('Shown Unreleased', {}, {
    source: 'manual',
    audio_path: `${artistA}/shown.mp3`,
  })

  // A RELEASED-provenance track (has a stream link) taken OFF-site (on_site=false)
  // → proves a Released track can be hidden.
  id.hidden = await makeTrack('Hidden Released', { stream_url: 'https://open.spotify.com/track/hid' }, {
    audio_path: `${artistA}/hidden.mp3`,
    on_site: false,
  })

  // ---- release fixtures: the RELEASE doors are still Released-gated ----

  // A RELEASED release (has a spotify_id) with a track inside it.
  const pubAlbum = await makeRelease('Public Album', 'pub-album', { spotify_id: 'sp-album-1' })
  await makeTrack('Album Cut', {}, { release_id: pubAlbum })

  // An UNRELEASED release (manual, no spotify_id, links []).
  await makeRelease('Secret EP', 'secret-ep')

  // A RELEASED release the manager took OFF-site (on_site=false). Released and
  // on-site are independent gates: this one passes the provenance check but must
  // still vanish from BOTH release doors — the discography list AND its own
  // smart-link page. (20260709120000 dropped the page's gate; see below.)
  await makeRelease('Pulled Album', 'pulled-album', { spotify_id: 'sp-album-2', on_site: false })

  // A loose track whose album_name matches the released release's TITLE but with
  // NO release_id — must NOT appear in the pub-album tracklist (membership is
  // release_id only).
  await makeTrack('Fallback Song', { stream_url: 'https://open.spotify.com/track/fb' }, { album_name: 'Public Album' })

  // A RELEASED, on-site release + a track inside it, both published ON-SITE. The
  // toggle-after-publish test below flips them off with no republish.
  id.togRelease = await makeRelease('Toggle Album', 'toggle-album', { spotify_id: 'sp-album-3' })
  id.togTrack = await makeTrack('Toggle Cut', { stream_url: 'https://open.spotify.com/track/tog' }, {
    release_id: id.togRelease,
    audio_path: `${artistA}/toggle.mp3`,
  })

  await publishContent(asA, 'release', artistA)
  await publishContent(asA, 'track', artistA)

  // Created AFTER the publish, so it has no revision: a genuine DRAFT. Released
  // provenance and on-site, so only the draft-ness can keep it off the doors.
  await makeRelease('Draft Album', 'draft-album', { spotify_id: 'sp-album-4' })

  // A published snapshot with no matching live track row (legacy / orphan) shows,
  // because the on_site join misses and coalesce(on_site, true) keeps it.
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

describe('get_public_site — tracks gate on on_site, not Released', () => {
  it('shows an UNRELEASED-provenance track when it is on-site', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Shown Unreleased')
  })

  it('hides a RELEASED-provenance track when it is off-site (on_site=false)', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).not.toContain('Hidden Released')
  })

  it('shows an on-site track that lives inside a release', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Album Cut')
  })

  it('shows a provenance-less legacy snapshot (no live row → coalesce on_site)', async () => {
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Legacy Snapshot')
  })
})

describe('audio_path_for_play — gates on on_site', () => {
  it('serves audio for an on-site track', async () => {
    expect(await audioPath(id.shown)).toBe(`${artistA}/shown.mp3`)
  })

  it('returns null for an off-site (on_site=false) track', async () => {
    expect(await audioPath(id.hidden)).toBeNull()
  })
})

describe('get_release — Released-gated AND on-site-gated, album_name fallback gone', () => {
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

  it('returns null for a RELEASED release taken off-site (on_site=false)', async () => {
    expect(await releasePage('pulled-album')).toBeNull()
  })
})

describe('get_public_releases — still Released-gated', () => {
  it('lists the released release only', async () => {
    const titles = (await publicReleases()).map((r) => r.title)
    expect(titles).toContain('Public Album')
    expect(titles).not.toContain('Secret EP')
  })

  it('omits a released release taken off-site', async () => {
    expect((await publicReleases()).map((r) => r.title)).not.toContain('Pulled Album')
  })

  // The door reads published_revisions, so an unpublished release has no row to serve.
  // (Kept here when tests/public-releases.test.ts was removed — that file duplicated the
  // Released/on-site gates above and its afterAll wiped every artistA release.)
  it('omits a DRAFT release (created after the publish, so it has no revision)', async () => {
    expect((await publicReleases()).map((r) => r.title)).not.toContain('Draft Album')
    expect(await releasePage('draft-album')).toBeNull()
  })
})

/**
 * THE KEYSTONE: every door gates on the LIVE working row's `on_site`, not on the
 * published snapshot. So taking something off the site is INSTANT — no republish.
 *
 * Every other fixture in this file sets `on_site` BEFORE publishing, which means a
 * snapshot-reading door would pass those tests too. This one publishes on-site, then
 * flips the live rows with no republish, and requires all four doors to go dark — and
 * come back when it flips again. Without it, a refactor that read `data ->> 'on_site'`
 * from the revision would leave a "hidden" release publicly reachable until the manager
 * happened to publish again.
 */
describe('on_site toggled AFTER publish — the doors read the LIVE row', () => {
  it('CRITICAL: flipping on_site off darkens all four doors with no republish, and back on restores them', async () => {
    const setOnSite = async (on: boolean) => {
      await svc.from('releases').update({ on_site: on }).eq('id', id.togRelease)
      await svc.from('tracks').update({ on_site: on }).eq('id', id.togTrack)
    }

    // Published on-site: all four doors serve it.
    expect((await releasePage('toggle-album'))?.title).toBe('Toggle Album')
    expect((await publicReleases()).map((r) => r.title)).toContain('Toggle Album')
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Toggle Cut')
    expect(await audioPath(id.togTrack)).toBe(`${artistA}/toggle.mp3`)

    // Off-site, NO republish.
    await setOnSite(false)
    expect(await releasePage('toggle-album')).toBeNull()
    expect((await publicReleases()).map((r) => r.title)).not.toContain('Toggle Album')
    expect((await publicSiteTracks()).map((t) => t.title)).not.toContain('Toggle Cut')
    expect(await audioPath(id.togTrack)).toBeNull()

    // Back on-site, still no republish — the old snapshot is served again.
    await setOnSite(true)
    expect((await releasePage('toggle-album'))?.title).toBe('Toggle Album')
    expect((await publicReleases()).map((r) => r.title)).toContain('Toggle Album')
    expect((await publicSiteTracks()).map((t) => t.title)).toContain('Toggle Cut')
    expect(await audioPath(id.togTrack)).toBe(`${artistA}/toggle.mp3`)
  })
})
