// Site text is draft until published — the whole round trip against the real door.
/**
 * SITE TEXT IS DRAFT UNTIL PUBLISHED — the whole round trip, against the real door.
 *
 * `site_content` has been publishable since the beginning and nothing proved it reaches
 * the wire. It matters more than it used to: a site can now WRITE its own field (bridge
 * 0.27.0), and ftbk stores its entire desktop arrangement in one — where the manager put
 * every piece, and which pieces he grouped (Sam, 2026-08-21: "The image should stash its
 * x and y axis when I release it and then when its published it changes to that
 * position"). If that value did not survive publish, a manager would arrange his site,
 * publish it, and find the arrangement gone with nothing to explain why.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishContent, publishProfile } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

/**
 * WHY THE ARTIST IS A THROWAWAY (2026-09-18). The row bookkeeping here was already
 * careful — one planted row, deleted by its own id — but the ACT under test is
 * `publishContent(…, 'site_content')`, which snapshots every site_content row the artist
 * has. On a shared artist that commits a manager's pending text the moment a test run
 * starts, and the teardown then had to publish a SECOND time to tombstone the probe,
 * committing anything else that had arrived in between. The self-heal delete (a row
 * orphaned by a killed run breaking the unique key for every later run) also stops being
 * necessary: a fresh artist has no leftovers.
 */
let artist: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const KEY = 'phase0_publish_probe'
/** The planted row, kept for the edit-then-republish half of the test below. */
let rowId: string | null = null

async function publicValue(): Promise<string | undefined> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
  return (data as { site_content?: Record<string, string> } | null)?.site_content?.[KEY]
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = await createThrowawayArtist(svc, 'Publish site content', asA)
  artistA = artist.id
  // The door answers NULL with no `artist` revision, and `publicValue` reads `undefined`
  // out of null — which is exactly what the "not live yet" assertion expects, so without
  // this the first half of the test would pass against a site that does not exist.
  await publishProfile(asA, artistA)
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artist)
})

describe('site text is draft until published', () => {
  it('CRITICAL: a saved value reaches the public wire ONLY after publish', async () => {
    // A JSON payload on purpose: this is the shape ftbk's desktop arrangement travels
    // as, and it is the value most likely to be mangled by a door that assumed short
    // strings — quotes, braces and all.
    const value = JSON.stringify({ positions: { w1: { x: 42.5, y: 17.25 } }, folders: [] })
    const { data: row, error } = await asA
      .from('site_content')
      .insert({ artist_id: artistA, key: KEY, value })
      .select('id')
      .single()
    expect(error).toBeNull()
    rowId = row!.id as string

    // DRAFT: saved, and invisible to the public site.
    expect(await publicValue()).toBeUndefined()

    await publishContent(asA, 'site_content', artistA)

    // PUBLISHED: byte-for-byte what was stored — a JSON value that comes back subtly
    // re-encoded would parse to a different arrangement, or to none at all.
    expect(await publicValue()).toBe(value)
  })

  it('CRITICAL: an EDIT is draft too — the live site keeps the published value until republish', async () => {
    // The half that makes the first test mean something: without it, a door that simply
    // read the working table would pass "reaches the wire" and be wrong about everything
    // else. A manager rearranging his desktop must not change the live site under his
    // visitors' feet before he says so.
    const published = await publicValue()
    expect(published).toBeTruthy()

    const edited = JSON.stringify({ positions: { w1: { x: 90, y: 90 } }, folders: [] })
    await asA.from('site_content').update({ value: edited }).eq('id', rowId!)

    expect(await publicValue()).toBe(published)
    await publishContent(asA, 'site_content', artistA)
    expect(await publicValue()).toBe(edited)
  })
})
