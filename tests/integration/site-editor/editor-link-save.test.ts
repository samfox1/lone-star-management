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
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

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

/**
 * Live: `links.role` + its partial unique index (20260721120000).
 *
 * TENANCY, AND WHY THE ARTISTS ARE THROWAWAYS. This block used to run on the shared seed
 * artists and tear down with `delete().eq('artist_id', …).eq('role', 'usb')` for BOTH of
 * them. `role = 'usb'` is a real product surface (the USB button a manager binds in the
 * editor), so on the LIVE hosted project that deleted the artist's actual USB link —
 * and the round-trip above had already overwritten it on the way, since saveEditorLink is
 * a read-modify-write on exactly that row. The publish here also committed whatever
 * unrelated link draft the shared artist had pending.
 *
 * Both artists are created and dropped by this file now, so the teardown is the artist
 * row itself and cascades everything (links AND the revisions the publish wrote). The
 * public door resolves by SLUG and returns null until an `artist` revision exists, so
 * beforeAll publishes A's profile once.
 */
describe('saveEditorLink — live round-trip', () => {
  const svc = serviceClient()
  let a: ThrowawayArtist
  let b: ThrowawayArtist
  let artistA: string
  let artistB: string
  let asA: SupabaseClient

  beforeAll(async () => {
    const { publishProfile } = await import('@/lib/content')
    asA = await signInAs(SEED.managerA)
    const asB = await signInAs(SEED.managerB)
    a = await createThrowawayArtist(svc, 'editor link A', asA)
    b = await createThrowawayArtist(svc, 'editor link B', asB)
    artistA = a.id
    artistB = b.id
    await publishProfile(asA, artistA)
  })
  afterAll(async () => {
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, b)
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
    const { data } = await anonClient().rpc('get_public_site', { p_slug: a.slug })
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
    expect(after).toBeNull() // nothing INSERTED for tenant B

    // …and the same for the UPDATE half of the read-modify-write, with a PLANTED witness
    // (AGENTS.md rule 2). Absence alone only proves the insert was refused; B's real case
    // is a usb link that already exists, and RLS makes a denied update return error:null
    // with zero rows matched, so the row's STATE is the only honest evidence (rule 3).
    const { data: witness, error: plantErr } = await svc
      .from('links')
      .insert({ artist_id: artistB, role: 'usb', url: 'https://b.example/real', label: 'B USB', on_site: true })
      .select('id')
      .single<{ id: string }>()
    expect(plantErr, 'the witness must exist before the denial means anything').toBeNull()

    await saveEditorLink(asA, artistB, 'usb', 'https://evil.example/drop', 'HACKED')
    const { data: still } = await svc
      .from('links')
      .select('url, label')
      .eq('id', witness!.id)
      .single<{ url: string; label: string }>()
    expect(still).toMatchObject({ url: 'https://b.example/real', label: 'B USB' })
  })
})
