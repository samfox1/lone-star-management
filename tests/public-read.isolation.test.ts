/**
 * PUBLIC READ PATH — security boundary (README CRITICAL items).
 *
 * The public site is unauthenticated, so it cannot use RLS. The ONE controlled
 * door is the SECURITY DEFINER function public.get_public_site(p_slug), callable
 * by anon/authenticated via rpc. It returns published snapshots (latest revision
 * per entity) with public-safe fields only:
 *   { artist: {id,slug,name,bio,hero_image_url}, tracks, tour_dates, merch, links }
 *
 * These tests verify, against the real database, that it:
 *  1. returns public-safe artist fields ONLY (no integration ids / timestamps),
 *  2. returns published snapshots only (working rows without a revision hidden),
 *  3. never leaks another tenant's published content,
 *  4. never exposes integrations / secret_ref,
 *  5. returns null (not an error) for an unknown slug, and works for anon.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SEED,
  anonClient,
  artistIdBySlug,
  publishRevision,
  serviceClient,
  signInAs,
} from './helpers/supabase'

let artistA: string // Lone Pine, managed by A
let artistB: string // Gulf Static, managed by B

let unpublishedTrackA: string // a working track with NO revision
let publishedTrackA: string // a working track that IS published

const revisionIds: string[] = []
let integrationB: string

// Stable markers so cleanup is robust even on partial setup.
const PUB_TRACK_TITLE = 'PUBREAD published track A'
const DRAFT_TRACK_TITLE = 'PUBREAD draft track A (no revision)'
const B_TRACK_TITLE = 'PUBREAD cross-tenant track B'
const B_SECRET_REF = 'vault://PUBREAD-secret-should-never-leak'
const TEST_PROVIDER = 'pubread-test' // test-only, avoids colliding with real providers

const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)

  // An UNPUBLISHED working track on A: exists in `tracks`, but has no revision.
  // It must NOT appear in the public read.
  const { data: draft, error: draftErr } = await svc
    .from('tracks')
    .insert({ artist_id: artistA, title: DRAFT_TRACK_TITLE })
    .select('id')
    .single()
  if (draftErr || !draft) throw draftErr ?? new Error('draft insert failed')
  unpublishedTrackA = draft.id

  // A PUBLISHED working track on A: exists in `tracks` AND has a revision.
  const { data: pub, error: pubErr } = await svc
    .from('tracks')
    .insert({ artist_id: artistA, title: PUB_TRACK_TITLE })
    .select('id')
    .single()
  if (pubErr || !pub) throw pubErr ?? new Error('pub insert failed')
  publishedTrackA = pub.id

  // Publish A's track (latest revision for this entity).
  revisionIds.push(
    await publishRevision({
      artistId: artistA,
      entityType: 'track',
      entityId: publishedTrackA,
      data: { id: publishedTrackA, title: PUB_TRACK_TITLE, sort_order: 0 },
    }),
  )
  // Publish a track for B too, so cross-tenant leakage has something to leak.
  revisionIds.push(
    await publishRevision({
      artistId: artistB,
      entityType: 'track',
      entityId: artistB, // any uuid; content not under test, just presence
      data: { title: B_TRACK_TITLE },
    }),
  )

  // Integrations secret for artist B — must never reach a manager of A or the
  // public path.
  const { data: integ, error: integErr } = await svc
    .from('integrations')
    .insert({
      artist_id: artistB,
      provider: TEST_PROVIDER,
      secret_ref: B_SECRET_REF,
      metadata: { store_domain: 'pubread-test.myshopify.com' },
    })
    .select('id')
    .single()
  if (integErr || !integ) throw integErr ?? new Error('integration insert failed')
  integrationB = integ.id
})

afterAll(async () => {
  // Clean up by stable identity. Each guarded so partial setup still tears down.
  if (revisionIds.length) await svc.from('revisions').delete().in('id', revisionIds)
  if (integrationB) await svc.from('integrations').delete().eq('id', integrationB)
  const trackIds = [unpublishedTrackA, publishedTrackA].filter(Boolean)
  if (trackIds.length) await svc.from('tracks').delete().in('id', trackIds)
  // Belt-and-suspenders sweep in case ids were never captured.
  await svc
    .from('tracks')
    .delete()
    .in('title', [PUB_TRACK_TITLE, DRAFT_TRACK_TITLE, B_TRACK_TITLE])
})

describe('get_public_site — public-safe shape', () => {
  it('CRITICAL: artist object exposes only the public-safe fields', async () => {
    const { data, error } = await anonClient().rpc('get_public_site', {
      p_slug: SEED.artistASlug,
    })
    expect(error).toBeNull()
    expect(data).not.toBeNull()

    const artist = (data as Record<string, unknown>).artist as Record<string, unknown>
    expect(artist).toBeTruthy()
    // spotify_artist_id and template are public (the id is in the artist's
    // public Spotify URL); the template drives which public design renders.
    // press_pitch/press_quotes are press-kit copy the manager writes FOR publication
    // (20260804120000) — public by intent, not by accident. Every name in this list is
    // a deliberate decision, so adding one means changing this line on purpose.
    expect(Object.keys(artist).sort()).toEqual(
      [
        'bio',
        'hero_image_url',
        'id',
        'name',
        'press_pitch',
        'press_quotes',
        // Paths into the PRIVATE `documents` bucket. A path is not access here: the
        // bucket has no anon policy, so it is neither readable nor enumerable without a
        // manager session. They ride the snapshot so a generated EPK is entirely
        // published content (20260804140000).
        'stage_plot_path',
        'tech_rider_path',
        'slug',
        'spotify_artist_id',
        'template',
      ].sort(),
    )
  })

  it('CRITICAL: private integration fields never leak', async () => {
    const { data } = await anonClient().rpc('get_public_site', {
      p_slug: SEED.artistASlug,
    })
    const blob = JSON.stringify(data)
    // bandsintown_name / shopify_domain are not needed publicly and stay private.
    expect(blob).not.toContain('bandsintown_name')
    expect(blob).not.toContain('shopify_domain')
  })
})

describe('get_public_site — published snapshots only', () => {
  it('CRITICAL: returns the published track but NOT the unpublished working row', async () => {
    const { data } = await anonClient().rpc('get_public_site', {
      p_slug: SEED.artistASlug,
    })
    const tracks = (data as Record<string, unknown>).tracks as Array<
      Record<string, unknown>
    >
    const titles = tracks.map((t) => t.title)
    expect(titles).toContain(PUB_TRACK_TITLE)
    expect(titles).not.toContain(DRAFT_TRACK_TITLE)
    // The unpublished working row's id must not surface anywhere.
    expect(JSON.stringify(data)).not.toContain(unpublishedTrackA)
  })
})

describe('get_public_site — no cross-tenant leak', () => {
  it("CRITICAL: lone-pine's payload contains none of gulf-static's content", async () => {
    const { data } = await anonClient().rpc('get_public_site', {
      p_slug: SEED.artistASlug,
    })
    const blob = JSON.stringify(data)
    expect(blob).not.toContain(B_TRACK_TITLE)
    expect(blob).not.toContain(artistB)
    expect((data as Record<string, { slug: string }>).artist.slug).toBe(
      SEED.artistASlug,
    )
  })
})

describe('integrations / secret_ref are unreachable', () => {
  it("CRITICAL: manager A's authed client cannot read B's integrations row", async () => {
    const asA = await signInAs(SEED.managerA)
    const { data } = await asA
      .from('integrations')
      .select('id, secret_ref')
      .eq('artist_id', artistB)
    expect(data).toEqual([])
  })

  it('CRITICAL: public read output never contains secret_ref or an integrations key', async () => {
    const a = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const b = await anonClient().rpc('get_public_site', { p_slug: SEED.artistBSlug })
    for (const { data } of [a, b]) {
      const blob = JSON.stringify(data)
      expect(blob).not.toContain('secret_ref')
      expect(blob).not.toContain(B_SECRET_REF)
      expect(data).not.toHaveProperty('integrations')
    }
  })
})

describe('get_public_site — slug handling & grants', () => {
  it('CRITICAL: unknown slug returns null, not an error', async () => {
    const { data, error } = await anonClient().rpc('get_public_site', {
      p_slug: 'no-such-artist-pubread-xyz',
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('anon (logged-out) can call get_public_site for a valid slug', async () => {
    const { data, error } = await anonClient().rpc('get_public_site', {
      p_slug: SEED.artistASlug,
    })
    expect(error).toBeNull()
    expect((data as Record<string, { slug: string }>).artist.slug).toBe(
      SEED.artistASlug,
    )
  })
})
