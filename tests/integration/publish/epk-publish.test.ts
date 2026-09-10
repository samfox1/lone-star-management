/**
 * Press-kit fields ride the profile's publish window.
 *
 * Decision 2 (2026-08-04): the EPK PDF and the public /[slug]/epk page must never
 * disagree, so both read PUBLISHED rows. That only holds if the press fields actually
 * travel in the `artist` snapshot — if ARTIST_SNAPSHOT ever loses them, the working row
 * would keep the value while the public door served nothing, and the two surfaces would
 * silently drift apart. This pins it against the real anon door.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishProfile } from '@/lib/content'
import { parsePressQuotes, savePressKit } from '@/lib/epk'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

const PITCH = 'EPK-PUBLISH pitch (draft)'

async function publicArtist(): Promise<Record<string, unknown> | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as { artist?: Record<string, unknown> } | null)?.artist ?? null
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  // Leave the seed artist with no press kit and exactly one clean published snapshot,
  // so later tests still find a live site.
  await svc.from('artists').update({ press_pitch: null, press_quotes: [] }).eq('id', artistA)
  await publishProfile(svc, artistA)
})

describe('press kit publishes with the profile', () => {
  it('CRITICAL: a saved pitch is NOT public until the profile is published', async () => {
    await savePressKit(asA, artistA, { pitch: null, quotes: [] })
    await publishProfile(asA, artistA) // known baseline: no press kit

    expect((await publicArtist())?.press_pitch).toBeNull()

    const saved = await savePressKit(asA, artistA, { pitch: PITCH, quotes: [] })
    expect(saved.ok).toBe(true)

    // Working row has it; the public door must not.
    expect((await publicArtist())?.press_pitch).toBeNull()

    await publishProfile(asA, artistA)
    expect((await publicArtist())?.press_pitch).toBe(PITCH)
  })

  it('quotes survive the round trip through the snapshot', async () => {
    await savePressKit(asA, artistA, {
      pitch: PITCH,
      quotes: [
        { quote: 'A blistering live act.', source: 'NME', url: 'https://nme.com/x' },
        { quote: 'Unmissable.', source: '', url: '' },
      ],
    })
    await publishProfile(asA, artistA)

    expect(parsePressQuotes((await publicArtist())?.press_quotes)).toEqual([
      { quote: 'A blistering live act.', source: 'NME', url: 'https://nme.com/x' },
      { quote: 'Unmissable.', source: '', url: null },
    ])
  })

  it('CRITICAL: a dangerous quote URL never reaches the public door', async () => {
    await savePressKit(asA, artistA, {
      pitch: null,
      quotes: [{ quote: 'Great.', source: 'NME', url: 'javascript:alert(1)' }],
    })
    await publishProfile(asA, artistA)

    // Assert on the RAW stored JSON, not through parsePressQuotes — the parser nulls
    // javascript: URLs at read time, so it would pass even if the raw URL had been
    // stored and every consumer that skips the parser were serving it.
    const raw = (await publicArtist())?.press_quotes as { quote: string; url: unknown }[]
    expect(raw).toHaveLength(1)
    expect(raw[0].url).toBeNull()
  })

  it('the database refuses a press_quotes value that is not an array', async () => {
    const { error } = await asA.from('artists').update({ press_quotes: { not: 'an array' } }).eq('id', artistA)
    expect(error).not.toBeNull()
  })
})
