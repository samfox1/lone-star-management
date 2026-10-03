// An enquiry kind's description: what it may hold, and who may change it.
/**
 * In the real database, `enquiry_kinds.description` holds one trimmed line of at most 120
 * characters (or NULL), every artist starts with the three lines the dashboard always showed, and
 * only that artist's managers can change it.
 *
 * GATED: 20261002220000 is NOT pushed yet. Flip KIND_DESCRIPTION_PUSHED after `npm run db:push`
 * (step 4 of that migration's checklist) and run this file.
 *
 * Code:     supabase/migrations/20261002220000_enquiry_kind_description.sql (the column, the
 *           CHECK `ek_description_clean`, the backfill, the seed trigger); the write is
 *           saveEnquiryKind in src/lib/enquiries/kind-save.ts, behind saveEnquiryKindAction
 * Feature:  Settings › Email · click a kind's name, edit its name and description
 * Tier:     STRICT (AGENTS.md "Test depth"): a CHECK and tenant isolation. Every denial has a
 *           planted witness (rule 2), every refused write is checked by row STATE through the
 *           service client (rule 3), and every row lives on a throwaway artist (rule 6).
 * Covers:   • a new artist's booking/demo/other carry the three lines (seed trigger)
 *           • the CHECK takes NULL and 120 characters; refuses 121, '', blanks, edge whitespace
 *             and every line break, by name (23514 + ek_description_clean)
 *           • the artist's manager saves through saveEnquiryKind; it trims, '' is NULL, and a
 *             bad line is refused before the database
 *           • another artist's manager and anon change nothing, through the save or the table
 * Not here: the same rules first checked, and each broken once, on a throwaway local Postgres
 *           (2026-10-02, Postgres 18): dropping the length clause, the line-break clause (or
 *           narrowing it to CR/LF), the edge-whitespace clause, the backfill, the seed trigger's
 *           new column, or opening the write policy each turned a check red. The pure rules of
 *           the save (kindDetailsUpdate) are pinned DB-free in
 *           tests/unit/manager-tools/enquiries/enquiry-kinds.test.ts.
 * Fixtures: the HOSTED project (no fake): seeded managers A and B signed in, anon, the service
 *           client, and a throwaway artist made and deleted by this file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEnquiryKind } from '@/lib/enquiries/kind-save'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

/** 20261002220000_enquiry_kind_description.sql. */
const KIND_DESCRIPTION_PUSHED = true

/** What the dashboard showed before the column existed, and so what the backfill and the seed
 *  trigger must write: "nothing visibly changes after the push". */
const SEEDED_LINES: Record<string, string> = {
  booking: 'For shows, festivals and private events',
  demo: 'For music and demo submissions',
  other: 'For everything else',
}

/** Every mandatory line break the CHECK refuses. */
const BREAKS = ['\r', '\n', '\v', '\f', '\u0085', '\u2028', '\u2029']

describe.skipIf(!KIND_DESCRIPTION_PUSHED)('enquiry_kinds.description', () => {
  const svc = serviceClient()
  const anon = anonClient()
  let asA: SupabaseClient
  let asB: SupabaseClient
  /** Managed by A only. */
  let artist: ThrowawayArtist
  /** Its `demo` kind: the row every test below edits. */
  let kindId: string

  /** What is really stored, through the service client (RLS cannot hide a row from it). */
  const stored = async (id = kindId) => {
    const { data, error } = await svc.from('enquiry_kinds').select('label, description').eq('id', id).single()
    if (error) throw new Error(`stored: ${error.message}`)
    return data as { label: string; description: string | null }
  }
  /** Plant the witness every refusal is measured against, and prove it is there. */
  const plant = async (description: string | null) => {
    const { error } = await svc.from('enquiry_kinds').update({ label: 'Demo', description }).eq('id', kindId)
    if (error) throw new Error(`plant: ${error.message}`)
    expect(await stored()).toEqual({ label: 'Demo', description })
  }

  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    asB = await signInAs(SEED.managerB)
    artist = await createThrowawayArtist(svc, 'kind description', asA)
    const { data, error } = await svc.from('enquiry_kinds').select('id').eq('artist_id', artist.id).eq('slug', 'demo').single()
    if (error) throw new Error(`demo kind: ${error.message}`)
    kindId = (data as { id: string }).id
  })

  afterAll(async () => {
    if (artist) await deleteThrowawayArtist(svc, artist)
  })

  // The seed trigger writes the lines (made by the plain helper, which knows nothing of them).
  it('a new artist starts with the three lines the dashboard always showed', async () => {
    const { data, error } = await svc.from('enquiry_kinds').select('slug, description').eq('artist_id', artist.id)
    expect(error).toBeNull()
    expect(Object.fromEntries((data ?? []).map((k) => [k.slug, k.description]))).toEqual(SEEDED_LINES)
  })

  describe('the CHECK (as the service role: no RLS, so the CHECK is the only thing refusing)', () => {
    it('takes NULL and exactly 120 characters, multibyte ones counted as one', async () => {
      for (const d of [null, 'x'.repeat(120), 'é'.repeat(120), 'For  shows, with two spaces inside']) {
        const { error } = await svc.from('enquiry_kinds').update({ description: d }).eq('id', kindId)
        expect(error, JSON.stringify(d)).toBeNull()
        expect((await stored()).description).toBe(d)
      }
    })

    it('refuses 121 characters, an empty or blank line, edge whitespace and every line break', async () => {
      await plant('WITNESS')
      const bad = ['x'.repeat(121), '', '   ', ' For x', 'For x ', '\tFor x', ...BREAKS.map((br) => `For${br}x`)]
      for (const d of bad) {
        const { error } = await svc.from('enquiry_kinds').update({ description: d }).eq('id', kindId)
        expect(error?.code, JSON.stringify(d)).toBe('23514')
        expect(error?.message).toContain('ek_description_clean')
      }
      expect((await stored()).description).toBe('WITNESS')
    })
  })

  describe('the save (saveEnquiryKind, the action’s write)', () => {
    // The positive control every denial below is measured against.
    it('the artist’s manager saves the name and description; trimmed, and an empty line is NULL', async () => {
      await plant('WITNESS')
      expect(await saveEnquiryKind(asA, artist.id, kindId, { label: ' Demos ', description: '  For tapes and links  ' })).toEqual({
        saved: { label: 'Demos', description: 'For tapes and links' },
      })
      expect(await stored()).toEqual({ label: 'Demos', description: 'For tapes and links' })

      expect((await saveEnquiryKind(asA, artist.id, kindId, { description: '' })).error).toBeUndefined()
      expect(await stored()).toEqual({ label: 'Demos', description: null })
    })

    it('refuses a bad line before the database, and stores nothing', async () => {
      await plant('WITNESS')
      expect((await saveEnquiryKind(asA, artist.id, kindId, { description: 'For\nx' })).error).toMatch(/one line/)
      expect((await saveEnquiryKind(asA, artist.id, kindId, { description: 'x'.repeat(121) })).error).toMatch(/120/)
      expect(await stored()).toEqual({ label: 'Demo', description: 'WITNESS' })
    })

    it('another artist’s manager changes nothing, through the save or the table', async () => {
      await plant('WITNESS')
      // Through the app's write: a zero-row match is an error, not a save.
      expect((await saveEnquiryKind(asB, artist.id, kindId, { label: 'Hijacked', description: 'B was here' })).error).toBeTruthy()
      // Straight at the table: row-filtered, so no error and zero rows. Only the state can tell.
      await asB.from('enquiry_kinds').update({ description: 'B was here' }).eq('id', kindId)
      expect(await stored()).toEqual({ label: 'Demo', description: 'WITNESS' })
    })

    it('anon changes nothing', async () => {
      await plant('WITNESS')
      await anon.from('enquiry_kinds').update({ description: 'anon was here' }).eq('id', kindId)
      expect((await saveEnquiryKind(anon, artist.id, kindId, { description: 'anon was here' })).error).toBeTruthy()
      expect(await stored()).toEqual({ label: 'Demo', description: 'WITNESS' })
    })
  })
})
