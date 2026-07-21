/**
 * saveEditorLink — binding a manifest link region (USB / Merch button) to a URL by KEY
 * (Phase 2). The guard cases are pure (they return before any DB call, proven with a
 * client that throws if touched). The live round-trip is SKIPPED until 20260721120000
 * (the `links.role` column + partial unique index) is applied to the project — un-skip it
 * then.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEditorLink } from '@/lib/site-editor/save'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

// A client that throws if any property is read — proves the guards return before a write.
const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error('DB must not be touched for a rejected save')
    },
  },
) as unknown as SupabaseClient

describe('saveEditorLink — guards (no DB)', () => {
  it('rejects a badly-shaped link key before any write', async () => {
    expect(await saveEditorLink(noDb, 'artist-1', 'bad key!', 'https://x.example', 'X')).toEqual({
      ok: false,
      error: 'Unknown link.',
    })
  })

  it('rejects a non-blank URL that is not safe http(s)/relative', async () => {
    expect(await saveEditorLink(noDb, 'artist-1', 'usb', 'javascript:alert(1)', 'USB')).toEqual({
      ok: false,
      error: 'That URL looks invalid.',
    })
  })
})

// Live: needs supabase/migrations/20260721120000_links_role.sql (applied 2026-07-20).
describe('saveEditorLink — live round-trip (needs links.role)', () => {
  const svc = serviceClient()
  let artistA: string
  let asA: SupabaseClient

  beforeAll(async () => {
    artistA = await artistIdBySlug(SEED.artistASlug)
    asA = await signInAs(SEED.managerA)
  })
  afterAll(async () => {
    await svc.from('links').delete().eq('artist_id', artistA).eq('role', 'usb')
  })

  async function roleRow() {
    const { data } = await asA.from('links').select('url, label, on_site').eq('artist_id', artistA).eq('role', 'usb').maybeSingle()
    return data
  }

  it('inserts a roled, on-site link, then updates it, then a blank URL deletes it', async () => {
    expect(await saveEditorLink(asA, artistA, 'usb', 'https://open.spotify.com/playlist/a', 'USB button')).toEqual({ ok: true })
    expect(await roleRow()).toMatchObject({ url: 'https://open.spotify.com/playlist/a', label: 'USB button', on_site: true })

    expect(await saveEditorLink(asA, artistA, 'usb', 'https://open.spotify.com/playlist/b', 'USB button')).toEqual({ ok: true })
    expect((await roleRow())?.url).toBe('https://open.spotify.com/playlist/b')

    expect(await saveEditorLink(asA, artistA, 'usb', '', 'USB button')).toEqual({ ok: true })
    expect(await roleRow()).toBeNull()
  })

  it('the roled link reaches the public door with its role, once published', async () => {
    // The links branch of get_public_site serves `data` wholesale, so `role` rides the
    // snapshot with no SQL change.
    await saveEditorLink(asA, artistA, 'usb', 'https://open.spotify.com/playlist/c', 'USB button')
    const { publishContent } = await import('@/lib/content')
    await publishContent(asA, 'link', artistA)
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const links = (data as { links?: { role?: string | null; url: string }[] }).links ?? []
    expect(links.some((l) => l.role === 'usb')).toBe(true)
  })
})
