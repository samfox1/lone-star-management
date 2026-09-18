// A font stays draft until published, proven against the real public door.
/**
 * Fonts are PUBLISH-GATED, proven against the real door.
 *
 * The whole pipeline in one round trip: an artist_fonts row is DRAFT work invisible to
 * get_public_site until publishContent('artist_font') snapshots it; after publish the
 * door's `fonts` array carries exactly the wire shape fontStyleCss consumes, and
 * `font_slots` carries slot→family for the slots that font fills; removing the row and
 * republishing takes it back off the site (tombstone semantics).
 *
 * The load-bearing one is the LAST test: a slot can never reach the payload without the
 * font it names, because slots ride the FONT's snapshot rather than publishing as their
 * own entity type (20260805180000). That property is why there is no second publish step
 * to get wrong.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). The header used to claim "every row
 * this file creates is deleted by id in afterAll", and the font rows were. The teardown's
 * last statement was not: `delete().eq('artist_id', A).eq('entity_type', 'artist_font')`
 * erased the artist's ENTIRE font publish history, every revision, including the ones that
 * were serving their live site's typefaces. `publishContent('artist_font')` is catalog-wide
 * besides, so each of the six publishes below committed whatever fonts that artist had
 * uploaded but not yet published. Neither is scopable to "rows this file made" — the rows
 * are precisely the ones it did not make. An owned artist needs no such cleanup: it starts
 * with no fonts, and it ends by ceasing to exist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent, publishProfile } from '@/lib/content'
import { setFontSlot } from '@/lib/fonts'
import { getWorkingSitePayload } from '@/lib/site'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

const svc = serviceClient()
let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
let fontId: string | null = null

const FAMILY = 'pubtest-font-a'

type Door = {
  fonts?: { family: string; path: string; label: string; format: string }[]
  font_slots?: Record<string, string>
}

async function door(): Promise<Door> {
  const { data } = await svc.rpc('get_public_site', { p_slug: tenantA.slug })
  return (data ?? {}) as Door
}

/** Kept filtering by family even on an owned artist: the parity test below plants a second
 *  face, and `toHaveLength(1)` has to mean "this one", not "however many are around". */
async function doorFonts(): Promise<NonNullable<Door['fonts']>> {
  return ((await door()).fonts ?? []).filter((f) => f.family === FAMILY)
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Fonts publish', asA)
  artistA = tenantA.id
  // `door()` coerces a NULL payload to `{}`, whose `fonts` is undefined and whose
  // `font_slots?.primary` is undefined — i.e. every draft-side assertion below passes for
  // free on an artist that has never published a profile. Publish one, and prove it.
  await publishProfile(svc, artistA)
  const { data } = await svc.rpc('get_public_site', { p_slug: tenantA.slug })
  expect(data, 'get_public_site must answer for the throwaway artist').not.toBeNull()
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, tenantA)
})

describe('fonts publish gate (live door)', () => {
  it('CRITICAL: an uploaded font is invisible to the door until published, then carried in wire shape', async () => {
    const { data: row, error } = await asA
      .from('artist_fonts')
      .insert({
        artist_id: artistA,
        label: 'Pubtest Font A',
        family: FAMILY,
        storage_path: `${artistA}/fonts/pubtest.woff2`,
        format: 'woff2',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    fontId = row!.id as string
    // TWO slots on ONE font: the shape the old `role` column could not represent.
    expect((await setFontSlot(asA, artistA, 'primary', fontId)).ok).toBe(true)
    expect((await setFontSlot(asA, artistA, 'custom_2', fontId)).ok).toBe(true)

    // Draft: the door must NOT serve it yet.
    expect(await doorFonts()).toHaveLength(0)
    expect((await door()).font_slots?.primary).not.toBe(FAMILY)

    await publishContent(asA, 'artist_font', artistA)
    const published = await doorFonts()
    expect(published).toHaveLength(1)
    // The wire shape fontStyleCss consumes: `path`, not `storage_path`.
    expect(published[0]).toMatchObject({ family: FAMILY, path: `${artistA}/fonts/pubtest.woff2` })
    // CONTRACT: `role` is gone from the font. Which slots a font fills is a fact about
    // the SITE and lives in the map — which is what lets one font fill several.
    expect(published[0]).not.toHaveProperty('role')

    const slots = (await door()).font_slots ?? {}
    expect(slots.primary).toBe(FAMILY)
    expect(slots.custom_2).toBe(FAMILY)

    // Emptying a slot and republishing drops the key. An ABSENT key is how the payload
    // says "no font for that slot"; a key with a null would make every consumer check.
    expect((await setFontSlot(asA, artistA, 'custom_2', null)).ok).toBe(true)
    await publishContent(asA, 'artist_font', artistA)
    const after = (await door()).font_slots ?? {}
    expect(after.primary).toBe(FAMILY)
    expect(after.custom_2).toBeUndefined()

    // Removing the row and republishing takes it back off the site — and takes its slot
    // with it, because the slot only ever existed inside the font's own snapshot.
    await asA.from('artist_fonts').delete().eq('id', fontId)
    await publishContent(asA, 'artist_font', artistA)
    expect(await doorFonts()).toHaveLength(0)
    expect(Object.values((await door()).font_slots ?? {})).not.toContain(FAMILY)
    fontId = null
  })

  it('CRITICAL: the working (preview) payload carries the same fonts and slots as the door', async () => {
    // The editor and the custom-site bridge read getWorkingSitePayload, the public page
    // reads the door, and they are DIFFERENT code (TypeScript mapping vs SQL). Drift here
    // is a preview that shows the manager one typeface and the site another — with both
    // halves passing their own tests.
    const { data: row } = await asA
      .from('artist_fonts')
      .insert({
        artist_id: artistA,
        label: 'Parity Face',
        family: 'pubtest-parity',
        storage_path: `${artistA}/fonts/parity.woff2`,
        format: 'woff2',
      })
      .select('id')
      .single()
    const id = row!.id as string
    expect((await setFontSlot(asA, artistA, 'secondary', id)).ok).toBe(true)
    await publishContent(asA, 'artist_font', artistA)

    const working = await getWorkingSitePayload(asA, artistA)
    const live = await door()

    const mine = (f: { family: string }) => f.family === 'pubtest-parity'
    expect((working!.fonts ?? []).filter(mine)).toHaveLength(1) // non-vacuous
    expect((working!.fonts ?? []).filter(mine)).toEqual((live.fonts ?? []).filter(mine))
    expect(working!.font_slots.secondary).toBe('pubtest-parity')
    expect(live.font_slots?.secondary).toBe('pubtest-parity')

    await svc.from('artist_fonts').delete().eq('id', id)
    await publishContent(svc, 'artist_font', artistA)
  })

  it('CRITICAL: a slot can never name a font the payload does not carry', async () => {
    // Publishing "only the slots" is not a thing that can be asked for — slots have no
    // entity type of their own. This asserts the property by the one route that could
    // break it: a slot set on a font whose row was never published.
    const { data: row } = await asA
      .from('artist_fonts')
      .insert({
        artist_id: artistA,
        label: 'Unpublished Face',
        family: 'pubtest-unpublished',
        storage_path: `${artistA}/fonts/unpub.woff2`,
        format: 'woff2',
      })
      .select('id')
      .single()
    const id = row!.id as string
    expect((await setFontSlot(asA, artistA, 'custom_3', id)).ok).toBe(true)

    // No publish. The slot is set and live in the working table, and the door says nothing.
    expect((await door()).font_slots?.custom_3).toBeUndefined()

    await svc.from('artist_fonts').delete().eq('id', id)
  })
})
