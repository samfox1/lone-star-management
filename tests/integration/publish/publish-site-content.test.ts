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
import { publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
/** The one row this file plants. Teardown removes exactly it: the project is shared and
 *  live, and deleting every site_content row for the artist would erase the editor copy
 *  of a real site (the lesson of the 2026-08-20 isolation suite). */
let rowId: string | null = null
const KEY = 'phase0_publish_probe'

async function publicValue(): Promise<string | undefined> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as { site_content?: Record<string, string> } | null)?.site_content?.[KEY]
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  // Self-heal a row orphaned by a killed run — the unique (artist_id, key) would
  // otherwise fail every later insert and skip this whole file (2026-08-20).
  await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', KEY)
})

afterAll(async () => {
  if (!rowId) return
  await svc.from('site_content').delete().eq('id', rowId)
  // It was published, so it lives in the snapshot until the next publish tombstones it.
  await publishContent(asA, 'site_content', artistA)
  await svc.from('revisions').delete().eq('entity_id', rowId)
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
