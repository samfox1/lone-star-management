/**
 * MILESTONE 4 — public site + preview data, test-first.
 *
 * The public site renders PUBLISHED data (latest revisions, via get_public_site).
 * The manager-only preview renders WORKING rows (the same shape, but unpublished
 * edits included). This proves the core distinction:
 *   - getWorkingSite shows a draft track immediately,
 *   - getPublishedSite (public) does NOT, until it is published,
 *   - and a non-owner can't get another tenant's working site at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ArtistSite } from '@/components/artist-site'
import { getPublishedSite, getWorkingSite } from '@/lib/site'
import { createTrack } from '@/lib/tracks'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const createdTrackIds: string[] = []
const DRAFT_TITLE = 'M4 draft-only track'
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)

  // A draft track (default on_site=true). It's hidden from the PUBLIC site only
  // because it's unpublished (no revision) — the site now gates tracks on the
  // `on_site` flag, not on Released (see 20260710170000).
  const track = await createTrack(asA, artistA, { title: DRAFT_TITLE, stream_url: 'https://open.spotify.com/track/m4' })
  createdTrackIds.push(track.id)
})

afterAll(async () => {
  if (createdTrackIds.length) await svc.from('tracks').delete().in('id', createdTrackIds)
  await svc.from('tracks').delete().eq('title', DRAFT_TITLE)
})

describe('getWorkingSite (preview)', () => {
  it("returns the artist profile and its working tracks for the owner", async () => {
    const site = await getWorkingSite(asA, artistA)
    expect(site).not.toBeNull()
    expect(site!.artist.slug).toBe(SEED.artistASlug)
    expect(site!.tracks.map((t) => t.title)).toContain(DRAFT_TITLE)
  })

  it('CRITICAL: shows an unpublished draft that the public site does NOT', async () => {
    const working = await getWorkingSite(asA, artistA)
    expect(working!.tracks.map((t) => t.title)).toContain(DRAFT_TITLE)

    const published = await getPublishedSite(anonClient(), SEED.artistASlug)
    const publishedTitles = (published?.tracks ?? []).map((t) => t.title)
    expect(publishedTitles).not.toContain(DRAFT_TITLE)
  })

  it("CRITICAL: a manager cannot get another tenant's working site", async () => {
    const site = await getWorkingSite(asA, artistB)
    expect(site).toBeNull()
  })
})

describe('getPublishedSite (public)', () => {
  it('returns null for an unknown slug', async () => {
    const site = await getPublishedSite(anonClient(), 'no-such-slug-m4')
    expect(site).toBeNull()
  })

  it('CRITICAL: a BROKEN door throws — it must never read as "no such artist"', async () => {
    // null and thrown mean opposite things to /[slug]: null renders notFound(). If an rpc
    // error swallowed to null, an unapplied migration, a revoked grant or a statement
    // timeout would serve every fan a 404 for a live artist, indistinguishable from a
    // deleted one and silent in the logs.
    //
    // A REAL PostgREST failure, not a stub: a client pointed at a schema the API does not
    // expose gets the same "this function is not reachable" response as a missing door.
    const broken = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false }, db: { schema: 'no_such_schema' } },
    ) as unknown as SupabaseClient

    await expect(getPublishedSite(broken, SEED.artistASlug)).rejects.toThrow(/schema/i)
  })
})

/**
 * A revision is a FROZEN snapshot of the row as it looked on the day it was published.
 * Columns added since (featured_artists, album_name, source/spotify_id, released) are
 * simply absent from an older one, and nothing republishes an artist on deploy — the old
 * shape is what the public door serves until the manager next hits Publish.
 */
describe('legacy revisions — a snapshot published before a column existed', () => {
  const LEGACY_TITLE = 'M4 legacy-shape track'
  const legacyId = '00000000-0000-4000-8000-00000000a17e'

  beforeAll(async () => {
    await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', legacyId)
    // Written with the service client BECAUSE it is deliberately malformed by today's
    // rules: publishContent could not produce this shape any more. No `tracks` row backs
    // it, which is itself the realistic case (published, later deleted from the library).
    await svc.from('revisions').insert({
      artist_id: artistA,
      entity_type: 'track',
      entity_id: legacyId,
      data: { id: legacyId, title: LEGACY_TITLE, sort_order: 9000, cover_url: null, stream_url: null },
    })
  })

  afterAll(async () => {
    await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', legacyId)
  })

  it('CRITICAL: the old shape reaches the door and still renders', async () => {
    const site = await getPublishedSite(anonClient(), SEED.artistASlug)
    const track = site!.tracks.find((t) => t.id === legacyId)

    // The door serves `data` wholesale, so the keys really are missing downstream.
    expect(track).toBeDefined()
    expect(track).not.toHaveProperty('featured_artists')
    expect(track).not.toHaveProperty('album_name')

    // The template reads `track.featured_artists ?? []`. Without that fallback this is a
    // TypeError inside a server component — the whole public site 500s, for every fan,
    // because of one old row.
    const html = renderToStaticMarkup(createElement(ArtistSite, { data: site! }))
    expect(html).toContain(LEGACY_TITLE)
  })
})
