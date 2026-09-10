// The two release doors join differently on purpose, and this pins where they diverge.
/**
 * The two RELEASE doors join `releases` DIFFERENTLY, on purpose, and nothing pinned it:
 *
 *   get_public_releases (the LIST)  — INNER JOIN public.releases
 *   get_release         (the PAGE)  — LEFT JOIN + coalesce(r.on_site, true)
 *
 * So deleting a working release row before its tombstone is published removes it from
 * the discography while its smart-link page keeps serving the last published snapshot.
 * That reads like an inconsistency a cleanup would "fix" — in either direction — and
 * both directions have already gone wrong here:
 *
 *   - 20260714130000 documents WHY the page is a LEFT JOIN: an INNER JOIN silently
 *     unpublishes live content the instant a working row disappears, ahead of the
 *     publish flow that is supposed to decide that.
 *   - 20260714150000 documents why the LIST keeps its INNER JOIN: it is pre-existing
 *     and fail-CLOSED, so a rename migration left it alone rather than widening a
 *     public door as a side effect.
 *
 * Both choices are safe in their own direction, which is exactly why neither survives
 * a "make these consistent" refactor unless something fails. This file is that
 * something. It is the inverse of the 2026-07-09 regression (a gate lost in a rewrite):
 * here the risk is a gate GAINED, or a snapshot lost, by tidying.
 *
 * The tombstone case is the control: with a real `_deleted` revision BOTH doors go
 * dark, so the page door is authoritative-until-tombstoned, not simply stuck open.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEED, anonClient, artistIdBySlug, serviceClient } from '@tests/helpers/supabase'

const svc = serviceClient()
const anon = anonClient()

let artistA: string
/** Ids this file created. Nothing else is ever deleted. */
const releaseId = crypto.randomUUID()
const SLUG = `asym-${releaseId.slice(0, 8)}`

/** The published snapshot: Released provenance (spotify_id) so both doors accept it. */
const snapshot = () => ({
  id: releaseId,
  title: 'Asymmetry Album',
  slug: SLUG,
  source: 'spotify',
  spotify_id: 'sp-asym',
  links: [],
  sort_order: 0,
})

async function listDoor(): Promise<string[]> {
  const { data } = await anon.rpc('get_public_releases', { p_slug: SEED.artistASlug })
  return ((data as { slug: string }[] | null) ?? []).map((r) => r.slug)
}

async function pageDoor(): Promise<{ title: string } | null> {
  const { data } = await anon.rpc('get_release', { p_artist_slug: SEED.artistASlug, p_release_slug: SLUG })
  return (data as { title: string } | null) ?? null
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  // Service role, and one release only: publishContent would snapshot every release
  // this artist has, which on the shared project means other suites' working rows.
  const rel = await svc
    .from('releases')
    .insert({ id: releaseId, artist_id: artistA, title: 'Asymmetry Album', slug: SLUG, source: 'spotify', spotify_id: 'sp-asym', on_site: true })
  if (rel.error) throw new Error(rel.error.message)
  const rev = await svc
    .from('revisions')
    .insert({ artist_id: artistA, entity_type: 'release', entity_id: releaseId, data: snapshot() })
  if (rev.error) throw new Error(rev.error.message)
})

afterAll(async () => {
  await svc.from('revisions').delete().eq('entity_id', releaseId)
  await svc.from('releases').delete().eq('id', releaseId)
})

describe('published release with its working row intact', () => {
  it('is served by BOTH doors', async () => {
    expect(await listDoor()).toContain(SLUG)
    expect((await pageDoor())?.title).toBe('Asymmetry Album')
  })
})

describe('CRITICAL: working row deleted, snapshot NOT tombstoned — the doors diverge', () => {
  it('drops out of the LIST (inner join) but the PAGE still serves the snapshot (left join)', async () => {
    const { error } = await svc.from('releases').delete().eq('id', releaseId)
    expect(error).toBeNull()

    // LIST: fail-closed. The join finds no working row, so the release is gone from
    // the discography. Widening this to a LEFT JOIN would republish, to the public,
    // every release whose row was ever deleted without a tombstone.
    expect(await listDoor()).not.toContain(SLUG)

    // PAGE: the published snapshot stays authoritative until a real publish
    // tombstones it. Narrowing this to an INNER JOIN would unpublish live content
    // the moment a row is deleted — ahead of the publish flow, and invisibly.
    expect((await pageDoor())?.title).toBe('Asymmetry Album')
  })

  it('and the tombstone closes the page door too (so it is not merely stuck open)', async () => {
    const { error } = await svc
      .from('revisions')
      .insert({ artist_id: artistA, entity_type: 'release', entity_id: releaseId, data: { ...snapshot(), _deleted: true } })
    expect(error).toBeNull()
    expect(await pageDoor()).toBeNull()
    expect(await listDoor()).not.toContain(SLUG)
  })
})
