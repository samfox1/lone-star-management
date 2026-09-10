// Binding a link region to a URL by key, guards first and then the live round trip.
/**
 * saveEditorLink — binding a manifest link region (USB / Merch button) to a URL by KEY
 * (Phase 2). The guard cases are pure (they return before any DB call, proven with a
 * client that throws if touched); the round-trip runs against the real project, since
 * `links.role` is a PARTIAL unique index and the read-modify-write exists precisely
 * because PostgREST cannot target one with on_conflict.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEditorLink } from '@/lib/site-editor/save'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

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

// Live: `links.role` + its partial unique index (20260721120000).
describe('saveEditorLink — live round-trip', () => {
  const svc = serviceClient()
  let artistA: string
  let artistB: string
  let asA: SupabaseClient

  beforeAll(async () => {
    artistA = await artistIdBySlug(SEED.artistASlug)
    artistB = await artistIdBySlug(SEED.artistBSlug)
    asA = await signInAs(SEED.managerA)
  })
  afterAll(async () => {
    // The publish below snapshots this fixture into `revisions` on a database every
    // other suite shares. Dropping only the `links` row leaves a PUBLISHED snapshot of a
    // row that no longer exists, so the next publish of this artist writes a tombstone —
    // and this file's fixture surfaces in another file's unpublished diff. Clear the
    // revisions first, the way tour-support.test.ts does.
    const { data } = await svc
      .from('links')
      .select('id')
      .eq('artist_id', artistA)
      .eq('role', 'usb')
      .maybeSingle<{ id: string }>()
    if (data) await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', data.id)
    await svc.from('links').delete().eq('artist_id', artistA).eq('role', 'usb')
    await svc.from('links').delete().eq('artist_id', artistB).eq('role', 'usb')
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

  it("CRITICAL: RLS blocks binding another tenant's link region", async () => {
    // This is the only one of the three editor save paths that INSERTS, and it inserts
    // `on_site: true` — a write that landed would not just corrupt tenant B's draft, it
    // would put an attacker-chosen URL on tenant B's live public site at the next publish.
    await saveEditorLink(asA, artistB, 'usb', 'https://evil.example/drop', 'USB button')
    const { data: after } = await svc
      .from('links')
      .select('id')
      .eq('artist_id', artistB)
      .eq('role', 'usb')
      .maybeSingle()
    expect(after).toBeNull() // nothing written for tenant B
  })
})
