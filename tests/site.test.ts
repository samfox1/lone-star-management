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
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublishedSite, getWorkingSite } from '@/lib/site'
import { createTrack } from '@/lib/tracks'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

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
})
