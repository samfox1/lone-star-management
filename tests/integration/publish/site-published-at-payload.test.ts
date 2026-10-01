// The draft payload carries a publish time too, which the bridge reads for its page metadata.
/**
 * H2 (REVIEW_2026-09-03) — the DRAFT payload must carry `published_at`.
 *
 * `getWorkingSitePayload` is what the editor posts to a custom site over `init-data`,
 * and the bridge's `lastModifiedFrom` reads `published_at` to build `dateModified` and
 * the sitemap's `lastmod`. The builder queried the newest revision and then dropped it
 * from the object it returned, so a connected site's preview fell back to tour dates and
 * disagreed with what `get_public_site` serves the live site — the exact drift the
 * builder's own comments exist to prevent.
 *
 * The fixture is a THROWAWAY artist created by this file, with hand-stamped
 * `published_at` values, so the assertion is an exact match rather than a race against
 * whatever else is publishing to a seeded artist on the shared live project. Teardown
 * deletes that one artist (revisions cascade), and nothing else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getWorkingSitePayload } from '@/lib/site'
import { type ThrowawayArtist, createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'
import { anonClient, serviceClient } from '@tests/helpers/supabase'

/**
 * `changed_at` (20261001130000): the same stamp PER KIND. The door's half is NOT RUN until
 * that migration is pushed: flip this to true in the SAME change as the push, then run this
 * file. The preview's half reads `revisions` directly and runs now.
 */
const CHANGED_AT_PUSHED = false

const svc = serviceClient()
const SLUG = `zz-h2-published-at-${randomUUID().slice(0, 8)}`
/** The PROFILE publish is older than the newest publish on purpose: a builder that
 *  returned the artist revision's stamp, or the door's, would still pass otherwise. */
const PROFILE_AT = '2026-01-02T03:04:05+00:00'
const NEWEST_AT = '2026-02-03T04:05:06+00:00'
/** For `changed_at`, all OLDER than NEWEST_AT so `published_at` above is unchanged:
 *  - the same link published once before (a per-kind MIN or first-row read reports it);
 *  - a look kind (the door sends every kind; the bridge picks which count);
 *  - a show published, then deleted: the TOMBSTONE is its kind's newest, and a read over the
 *    live snapshot (`published_revisions`, which drops tombstones) loses tour_date entirely. */
const LINK_OLDER_AT = '2026-01-10T00:00:00+00:00'
const STYLE_AT = '2026-01-20T00:00:00+00:00'
const TOUR_LIVE_AT = '2026-01-05T00:00:00+00:00'
const TOUR_DELETED_AT = '2026-01-25T00:00:00+00:00'
const CHANGED_AT: Record<string, string> = {
  artist: PROFILE_AT,
  link: NEWEST_AT,
  site_styles: STYLE_AT,
  tour_date: TOUR_DELETED_AT,
}
/** Compared as instants: the door's jsonb and PostgREST's column render the same moment, and
 *  the assertion is about WHICH revision each kind reports, not its spelling. Exact on keys. */
const instants = (m: Record<string, string> | null | undefined) =>
  m == null ? m : Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Date.parse(v)]))

/** A second throwaway with NO revisions at all: `changed_at` is `{}` there, never null. */
let bare: ThrowawayArtist | undefined

let artistId = ''
/** The stamp Postgres actually stored, read back — the format PostgREST renders is the
 *  one both sides must agree on, so the expectation comes from the DB, not from a
 *  hand-written literal. */
let newestStored = ''

beforeAll(async () => {
  const { data, error } = await svc
    .from('artists')
    .insert({ slug: SLUG, name: 'H2 published_at fixture' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  artistId = data.id as string

  // A published profile is what makes get_public_site return anything at all; the link
  // revision is the NEWEST thing published, which is what `published_at` must report.
  const linkId = randomUUID()
  const tourId = randomUUID()
  const { error: revErr } = await svc.from('revisions').insert([
    {
      artist_id: artistId,
      entity_type: 'artist',
      entity_id: artistId,
      data: { name: 'H2 published_at fixture' },
      published_at: PROFILE_AT,
    },
    {
      artist_id: artistId,
      entity_type: 'link',
      entity_id: linkId,
      data: { id: linkId, label: 'H2', url: 'https://example.com', sort_order: 0, role: null },
      published_at: NEWEST_AT,
    },
    {
      artist_id: artistId,
      entity_type: 'link',
      entity_id: linkId,
      data: { id: linkId, label: 'H2 before', url: 'https://example.com', sort_order: 0, role: null },
      published_at: LINK_OLDER_AT,
    },
    {
      artist_id: artistId,
      entity_type: 'site_styles',
      entity_id: randomUUID(),
      data: { region_key: 'hero', class_names: 'size-xl' },
      published_at: STYLE_AT,
    },
    {
      artist_id: artistId,
      entity_type: 'tour_date',
      entity_id: tourId,
      data: { id: tourId, date: '2026-06-01', venue: 'H2 Hall', on_site: true },
      published_at: TOUR_LIVE_AT,
    },
    { artist_id: artistId, entity_type: 'tour_date', entity_id: tourId, data: { _deleted: true }, published_at: TOUR_DELETED_AT },
  ])
  if (revErr) throw new Error(revErr.message)

  // Planted witness (AGENTS.md rule 2): the rows that make the changed_at tests bite are
  // really there. The tombstone is tour_date's NEWEST revision, and the link has an older one.
  const { data: planted, error: plantErr } = await svc
    .from('revisions')
    .select('entity_type, data, published_at')
    .eq('artist_id', artistId)
    .order('published_at', { ascending: false })
  if (plantErr) throw new Error(plantErr.message)
  const tour = planted.filter((r) => r.entity_type === 'tour_date')
  expect(tour).toHaveLength(2)
  expect((tour[0].data as { _deleted?: boolean })._deleted).toBe(true)
  expect(planted.filter((r) => r.entity_type === 'link')).toHaveLength(2)

  bare = await createThrowawayArtist(svc, 'changed_at bare')
  const { count, error: countErr } = await svc
    .from('revisions')
    .select('id', { count: 'exact', head: true })
    .eq('artist_id', bare.id)
  if (countErr) throw new Error(countErr.message)
  expect(count).toBe(0)

  const { data: newest, error: readErr } = await svc
    .from('revisions')
    .select('published_at')
    .eq('artist_id', artistId)
    .order('published_at', { ascending: false })
    .limit(1)
    .single()
  if (readErr) throw new Error(readErr.message)
  newestStored = newest.published_at as string
  expect(Date.parse(newestStored)).toBe(Date.parse(NEWEST_AT))
})

afterAll(async () => {
  // Exactly the rows this file created: the two artists. Revisions cascade off an artist
  // (FK on delete cascade), so nothing else is touched.
  if (artistId) await svc.from('artists').delete().eq('id', artistId)
  await deleteThrowawayArtist(svc, bare)
})

describe('getWorkingSitePayload published_at', () => {
  it('CRITICAL: carries the newest revision stamp, not undefined', async () => {
    const payload = await getWorkingSitePayload(svc, artistId)
    expect(payload).not.toBeNull()
    // `toBe` on the stored string, so a stamp that merely parses to the right instant in
    // a different shape is still caught: the wire value is what a site reads verbatim.
    expect(payload!.published_at).toBe(newestStored)
  })

  it('CRITICAL: agrees with get_public_site, so preview and live compute one lastmod', async () => {
    const payload = await getWorkingSitePayload(svc, artistId)
    const { data, error } = await anonClient().rpc('get_public_site', { p_slug: SLUG })
    if (error) throw new Error(error.message)
    const door = (data as { published_at?: string | null } | null)?.published_at ?? null

    expect(door).not.toBeNull()
    expect(Date.parse(payload!.published_at as string)).toBe(Date.parse(door as string))
  })
})

describe('getWorkingSitePayload changed_at (the preview mirror of 20261001130000)', () => {
  it('CRITICAL: each kind reports its newest revision, look kinds and tombstones included', async () => {
    const payload = await getWorkingSitePayload(svc, artistId)
    expect(instants(payload!.changed_at)).toEqual(instants(CHANGED_AT))
  })

  it('is {} (not null, not absent) for an artist with no revisions', async () => {
    const payload = await getWorkingSitePayload(svc, bare!.id)
    expect(payload).not.toBeNull()
    expect(payload!.changed_at).toEqual({})
  })
})

describe.skipIf(!CHANGED_AT_PUSHED)('get_public_site changed_at (20261001130000)', () => {
  const door = async () => {
    const { data, error } = await anonClient().rpc('get_public_site', { p_slug: SLUG })
    if (error) throw new Error(error.message)
    return data as { changed_at?: Record<string, string> | null; published_at?: string | null } | null
  }

  it('CRITICAL: each kind reports its newest revision, look kinds and tombstones included', async () => {
    const site = await door()
    expect(site).not.toBeNull()
    expect(instants(site!.changed_at)).toEqual(instants(CHANGED_AT))
    // `published_at` is untouched: still the newest of anything.
    expect(Date.parse(site!.published_at as string)).toBe(Date.parse(NEWEST_AT))
  })

  it('CRITICAL: agrees with the preview, so preview and live date each page alike', async () => {
    const [site, payload] = await Promise.all([door(), getWorkingSitePayload(svc, artistId)])
    expect(instants(site!.changed_at)).toEqual(instants(payload!.changed_at))
  })
})
