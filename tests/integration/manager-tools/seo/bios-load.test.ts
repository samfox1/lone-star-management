/**
 * In the real database, the Outside bios loader tells a fact a snapshot doesn't CARRY from one it
 * carries as empty, so a fact joining the profile snapshot never marks every ticked bio stale.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/bios-load.ts
 *           (`data->f::text`, factsOf), src/lib/manager-tools/seo/profiles/bio-state.ts (factChanges)
 * Feature:  SEO tool · Profiles tab · Outside bios, "may be out of date since"
 * Tier:     STRICT (AGENTS.md "Test depth"): it decides what the artist is told to go and redo, and
 *           only the hosted PostgREST can say what `data->f` answers for a missing key (null, the
 *           same as a JSON null: the bug) and what `data->f::text` answers (null vs the text 'null').
 * Covers:   • genre JOINS the snapshot with a value: not a change; a later edit of it is
 *           • city carried as JSON null, then set: a change (read as carried, not as missing)
 * Not here: every other factChanges rule (tests/unit/manager-tools/seo/bio-state.test.ts).
 * Fixtures: the HOSTED project: manager A signed in (the loader runs on the manager's session, as
 *           the page does) and a throwaway artist made and deleted by this file, with three
 *           artist revisions planted through the service client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOutsideBios } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/bios-load'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'

describe('loadOutsideBios: a missing fact is not an empty one', () => {
  const svc = serviceClient()
  let asA: SupabaseClient
  let artist: ThrowawayArtist

  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    artist = await createThrowawayArtist(svc, 'bios load', asA)
    // Oldest first: before genre and city joined the snapshot; the Publish where they joined
    // (genre with a value, city as JSON null); then real edits of both.
    const rev = (published_at: string, data: Record<string, unknown>) => ({ artist_id: artist.id, entity_type: 'artist', entity_id: artist.id, published_at, data })
    const { error } = await svc.from('revisions').insert([
      rev('2026-08-01T09:00:00Z', { name: 'Bios Load', bio: 'Old bio.', template: 'cinematic' }),
      rev('2026-09-01T09:00:00Z', { name: 'Bios Load', bio: 'Old bio.', template: 'cinematic', genre: 'House', location: null }),
      rev('2026-10-01T09:00:00Z', { name: 'Bios Load', bio: 'Old bio.', template: 'cinematic', genre: 'Techno', location: 'Chicago' }),
    ])
    if (error) throw new Error(error.message)
    // The witness: all three are there for the manager's session to read.
    const { data } = await svc.from('revisions').select('id').eq('artist_id', artist.id).eq('entity_type', 'artist')
    expect(data).toHaveLength(3)
  })

  afterAll(async () => {
    await deleteThrowawayArtist(svc, artist)
  })

  // A fact the snapshot did not carry is not an edit; only the real PostgREST can say carried-null from missing.
  it('CRITICAL: genre joining with a value is not a change; the later edits (city from empty too) are', async () => {
    const input = await loadOutsideBios(asA, { id: artist.id })
    expect(input.factsKnown).toBe(true)
    expect(input.changes.map((c) => [Date.parse(c.at), c.fields, c.first])).toEqual([
      [Date.parse('2026-10-01T09:00:00Z'), ['location', 'genre'], false],
      [Date.parse('2026-08-01T09:00:00Z'), ['name', 'bio'], true],
    ])
  })
})
