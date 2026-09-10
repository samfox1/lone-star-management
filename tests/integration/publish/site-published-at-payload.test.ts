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
import { anonClient, serviceClient } from '@tests/helpers/supabase'

const svc = serviceClient()
const SLUG = `zz-h2-published-at-${randomUUID().slice(0, 8)}`
/** The PROFILE publish is older than the newest publish on purpose: a builder that
 *  returned the artist revision's stamp, or the door's, would still pass otherwise. */
const PROFILE_AT = '2026-01-02T03:04:05+00:00'
const NEWEST_AT = '2026-02-03T04:05:06+00:00'

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
  ])
  if (revErr) throw new Error(revErr.message)

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
  // Exactly the row this file created. Revisions cascade off the artist (FK on delete
  // cascade), so nothing else is touched.
  if (artistId) await svc.from('artists').delete().eq('id', artistId)
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
