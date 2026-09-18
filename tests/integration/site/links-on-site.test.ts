// The public door filters links on their on-site flag.
/**
 * links.on_site — the door gate (20260714160000).
 *
 * The column was added in 20260708150000 but stayed inert on BOTH ends: nothing
 * read it (get_public_site's links branch had no filter) and nothing wrote it
 * (the editor only called setOnSiteAction for photos and songs). It described a
 * feature that did not exist. These tests pin the reader; the editor toggle that
 * writes it is covered in editor-inspector.test.tsx.
 *
 * Links follow the TRACKS model, not merch/video: toggled LIVE rather than
 * reconciled from a selection at publish, so `link` is deliberately absent from
 * ON_SITE_ENTITIES. The flag also defaults TRUE (a link is on the site unless
 * taken off), which is the opposite of a photo — so the cutover changed nothing.
 *
 * TENANCY, AND WHY THE ARTIST IS A THROWAWAY. This file used to run on the shared seed
 * artist `lone-pine` and tear down, after EVERY test, with
 *
 *     svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'link')
 *     svc.from('links').delete().eq('artist_id', artistA)
 *
 * On the LIVE hosted project that deleted every link that artist has — the whole Links
 * section of a real site — and every link snapshot ever published for it, three times per
 * run, for the sake of one fixture row. Publishing `link` on a shared artist also
 * committed whatever unrelated link draft was pending.
 *
 * The artist is created here and dropped here, so the blanket delete below IS "delete
 * exactly what I created". The public door resolves by SLUG and returns null until an
 * `artist` revision exists, so beforeAll publishes the profile once.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent, publishProfile } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let artist: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

async function publicLinks(): Promise<string[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
  const links = (data as { links?: { label: string }[] } | null)?.links ?? []
  return links.map((l) => l.label)
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = await createThrowawayArtist(svc, 'links on-site', asA)
  artistA = artist.id
  await publishProfile(asA, artistA)
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artist)
})

afterEach(async () => {
  // Safe as a blanket wipe ONLY because this file created the artist: no other suite, and
  // no human, has a link under it. The profile revision is left alone — dropping it would
  // take the whole site off the public door for the next test.
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'link')
  await svc.from('links').delete().eq('artist_id', artistA)
})

describe('get_public_site — links gate on on_site', () => {
  it('a new link defaults ON-site, so publishing puts it straight on the site', async () => {
    await createContent(asA, 'link', artistA, { label: 'LNK spotify', url: 'https://open.spotify.com/a' })
    await publishContent(asA, 'link', artistA)
    expect(await publicLinks()).toContain('LNK spotify')
  })

  it('CRITICAL: taking a published link off-site removes it from the public site', async () => {
    const row = await createContent(asA, 'link', artistA, { label: 'LNK bandcamp', url: 'https://x.bandcamp.com' })
    await publishContent(asA, 'link', artistA)
    expect(await publicLinks()).toContain('LNK bandcamp')

    // The live toggle (what setOnSiteAction writes) — no republish needed.
    await svc.from('links').update({ on_site: false }).eq('id', row.id as string)
    expect(await publicLinks()).not.toContain('LNK bandcamp')

    await svc.from('links').update({ on_site: true }).eq('id', row.id as string)
    expect(await publicLinks()).toContain('LNK bandcamp')
  })

  it('keeps a published link whose working row was deleted (snapshot stays authoritative)', async () => {
    // LEFT JOIN + coalesce(on_site, true): deleting the working row must NOT yank
    // live content before a publish tombstones it — the 20260707200000 convention.
    const row = await createContent(asA, 'link', artistA, { label: 'LNK ghost', url: 'https://ghost.example' })
    await publishContent(asA, 'link', artistA)
    await svc.from('links').delete().eq('id', row.id as string)
    expect(await publicLinks()).toContain('LNK ghost')
  })
})
