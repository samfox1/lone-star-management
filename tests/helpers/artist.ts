/**
 * Throwaway artists — the only teardown AGENTS.md rule 6 actually permits for a suite
 * that needs an EMPTY table.
 *
 * THE PROBLEM THIS SOLVES. A great many suites here opened with
 * `afterEach(() => svc.from('tracks').delete().eq('artist_id', artistA))`, where artistA
 * was the shared seed artist `lone-pine`. Two things went wrong at once:
 *
 *   1. It deletes rows the test never created — on the LIVE hosted project, where other
 *      suites and a human's own test data live on the same seed artist.
 *   2. It makes later denials VACUOUS. `sync.bandsintown.test.ts` emptied both seed
 *      artists' `tour_dates` after every test; `sync.apple.test.ts` then asserted
 *      "artist B has 0 tracks" as proof that a cross-tenant sync was refused. That
 *      assertion was guaranteed true by the teardown, not by RLS. Grant anon a write
 *      policy tomorrow and it still passes.
 *
 * WHY NOT `deleteAddedSince`. For a suite that only ADDS rows, snapshot-then-delete-the
 * -difference (see `@tests/helpers/rls`) is the right tool, and most of the converted
 * files use it. It does not work for the sync suites, because their assertions are
 * ABSOLUTE — `expect(data).toHaveLength(1)`, `expect(count).toBe(2)` — and those are only
 * true on a table that starts empty. Scoping the teardown without also scoping the
 * assertions would just move the lie. The seed artist currently reads empty ONLY because
 * these teardowns keep emptying it, which is the circularity in a sentence.
 *
 * WHAT THIS DOES INSTEAD. The suite creates an artist nobody else has ever heard of. Now
 * "delete everything for this artist" IS "delete exactly what I created", the table
 * genuinely starts empty, the absolute counts mean what they say, and the seed artists
 * are left alone. Deleting the artist row cascades to every child table, so teardown is
 * one statement that cannot miss a table someone adds later.
 *
 * The pattern was already in use in `tests/integration/analytics/*` (type-timeline,
 * source-types, first-day, event-door); this is that code, hoisted so the next suite
 * does not hand-roll a fourth copy.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** A test-owned artist. `slug` matters to the public doors, which resolve by slug. */
export type ThrowawayArtist = { id: string; slug: string }

/**
 * Create an artist that belongs to this test file alone.
 *
 * `label` only names it in the dashboard if a human goes looking; the slug is random, so
 * two files (or two reruns of one file inside the same hour) never collide — which is
 * what lets a rate-limit or per-artist-cap test run twice in a row.
 *
 * Pass `managerOf` to make a signed-in user its manager, which is what RLS reads. Leave
 * it out for suites that only ever act as service_role.
 */
export async function createThrowawayArtist(
  svc: SupabaseClient,
  label: string,
  managerOf?: SupabaseClient,
): Promise<ThrowawayArtist> {
  const slug = `tw-${crypto.randomUUID().slice(0, 12)}`
  const { data, error } = await svc
    .from('artists')
    .insert({ slug, name: `${label} throwaway` })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createThrowawayArtist(${label}): ${error?.message ?? 'no row'}`)
  const id = data.id as string

  if (managerOf) {
    const user = (await managerOf.auth.getUser()).data.user
    if (!user) throw new Error(`createThrowawayArtist(${label}): the manager client is not signed in`)
    const { error: e2 } = await svc.from('artist_managers').insert({ artist_id: id, user_id: user.id })
    if (e2) throw new Error(`createThrowawayArtist(${label}) manager link: ${e2.message}`)
  }

  return { id, slug }
}

/**
 * Drop a throwaway artist and, by cascade, every row any test hung off it.
 *
 * Tolerates `undefined` so an afterAll that runs after a failed beforeAll deletes
 * NOTHING rather than throwing — or, worse, falling through to a broader delete.
 */
export async function deleteThrowawayArtist(
  svc: SupabaseClient,
  artist: ThrowawayArtist | string | undefined,
): Promise<void> {
  const id = typeof artist === 'string' ? artist : artist?.id
  if (!id) return
  await svc.from('artists').delete().eq('id', id)
}
