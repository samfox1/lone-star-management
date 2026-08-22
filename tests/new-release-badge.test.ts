/**
 * The NEW badge's data path (Sam, 2026-08-21: "songs should have a new tag that appears
 * if they were released in the last week").
 *
 * The badge itself is `isNewRelease` in the bridge, pinned DB-free. What needs the live
 * DB is the half that was actually MISSING: a song's own `release_date` was a column the
 * publisher never snapshotted, so a standalone single's date reached the site as null and
 * no badge could ever light for one. A dated SoundCloud single is exactly the case Sam is
 * asking about, so the wire is where this is proved.
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'
import { PUBLISHABLE, createContent, publishContent } from '@/lib/content'

const svc = serviceClient()
const MARK = 'new-badge-test-song'
let artistA: string
let asA: SupabaseClient
let trackId: string | null = null

afterAll(async () => {
  // Exactly the rows this file planted (AGENTS.md rule 6).
  if (trackId) {
    await svc.from('revisions').delete().eq('entity_id', trackId)
    await svc.from('tracks').delete().eq('id', trackId)
  }
})

describe('a song carries its own release date onto the wire', () => {
  it("CRITICAL: the track snapshot includes release_date", () => {
    // The publisher copies exactly these columns. Before this, `release_date` was an
    // editable FIELD that was never snapshotted — so it existed, and never arrived.
    expect(PUBLISHABLE.track.snapshot).toContain('release_date')
  })

  it('CRITICAL: a dated standalone song publishes with its date intact', async () => {
    artistA = await artistIdBySlug(SEED.artistASlug)
    asA = await signInAs(SEED.managerA)
    const t = await createContent(asA, 'track', artistA, {
      title: MARK,
      release_date: '2026-08-20',
    })
    trackId = t.id
    await publishContent(asA, 'track', artistA)

    const { data: rev } = await svc
      .from('revisions')
      .select('data')
      .eq('entity_id', trackId)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Read the SNAPSHOT, not the working row — the working row obviously has the date;
    // the question is whether publishing carried it.
    expect((rev?.data as Record<string, unknown>)?.release_date).toBe('2026-08-20')
  })
})
