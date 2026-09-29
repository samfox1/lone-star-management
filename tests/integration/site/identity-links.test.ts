// The public door sends identity_links: connected profiles that identify the artist, button or not — never a payment handle or an invite. Runs against the real database.
/**
 * ⚠ NEEDS 20260928170000_identity_links.sql PUSHED. Until `npm run db:push` runs it, every
 * test here is red: `links.identity_url` does not exist (the writes store no verdict) and
 * the door sends no `identity_links`. That is the expected red, not a bug.
 *
 * IDENTITY LINKS (AI_VISIBILITY_AUDIT.md 1.2; Sam, 2026-09-28: "add all the connections and
 * links"). The fact card's `sameAs` was built from `links`, which the door gates on
 * `on_site`, and a new connection starts off the site, so most connections never reached it.
 * The door now also sends `identity_links: [{ url, label }]`.
 *
 * THE PRIVACY RULE this file pins at the door: a link the manager did not put on the site is
 * published only when TypeScript judged it an identity profile. The judgement is stored in
 * `links.identity_url` by `createContent` / `updateContent` (the real write path, used here),
 * and the door publishes a link only while its PUBLISHED url equals that verdict:
 *
 *   • an off-site identity profile (Spotify artist page) rides `identity_links`, and so does
 *     an off-site creator page that names the artist (Ko-fi: decided 2026-09-28);
 *   • an off-site payment handle (PayPal) and an invite (Discord) do not — and PayPal is proven
 *     PUBLISHED first (planted witness, AGENTS.md rule 2), so its absence means something;
 *   • `links` (the buttons) is unchanged: on-site only, and no `identity_url` on the wire;
 *   • a draft url edit re-judges, and the published url then has no verdict until Publish.
 *
 * The artist is a throwaway, created and dropped here (rule 6): never Skeen, never a seed
 * fixture. Row state is read back with the service client (rule 3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent, publishProfile, updateContent } from '@/lib/content'
import { getWorkingSitePayload } from '@/lib/site'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let artist: ThrowawayArtist
let asA: SupabaseClient
const svc = serviceClient()

const SPOTIFY = 'https://open.spotify.com/artist/26KkyYBR3k3Ynp9tdb9Z4W'
const PLAYLIST = 'https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd'
const PAYPAL = 'https://paypal.me/idlthrowaway'
const DISCORD = 'https://discord.gg/idlthrowaway'
const INSTAGRAM = 'https://instagram.com/idlthrowaway'
const KOFI = 'https://ko-fi.com/idlthrowaway'

const ids: Record<string, string> = {}

type Door = { links?: { label: string; url: string }[]; identity_links?: { url: string; label: string | null }[] }
async function door(): Promise<Door> {
  const { data, error } = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
  if (error) throw new Error(error.message)
  return (data ?? {}) as Door
}
const identityUrls = async () => ((await door()).identity_links ?? []).map((l) => l.url).sort()
const buttonUrls = async () => ((await door()).links ?? []).map((l) => l.url).sort()

async function verdict(id: string) {
  const { data, error } = await svc.from('links').select('url, identity_url, on_site').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as { url: string; identity_url: string | null; on_site: boolean }
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = await createThrowawayArtist(svc, 'identity links', asA)
  await publishProfile(asA, artist.id)
  // As Connect saves them: off the site. Instagram is the one button.
  ids.spotify = (await createContent(asA, 'link', artist.id, { label: 'Spotify', url: SPOTIFY }, { offSite: true })).id
  ids.paypal = (await createContent(asA, 'link', artist.id, { label: 'PayPal', url: PAYPAL }, { offSite: true })).id
  ids.discord = (await createContent(asA, 'link', artist.id, { label: 'Discord', url: DISCORD }, { offSite: true })).id
  ids.kofi = (await createContent(asA, 'link', artist.id, { label: 'Ko-fi', url: KOFI }, { offSite: true })).id
  ids.instagram = (await createContent(asA, 'link', artist.id, { label: 'Instagram', url: INSTAGRAM })).id
  await publishContent(asA, 'link', artist.id)
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artist)
})

describe('get_public_site — identity_links', () => {
  it('the write path stored each verdict (the premise every door test below stands on)', async () => {
    expect(await verdict(ids.spotify)).toEqual({ url: SPOTIFY, identity_url: SPOTIFY, on_site: false })
    expect(await verdict(ids.instagram)).toEqual({ url: INSTAGRAM, identity_url: INSTAGRAM, on_site: true })
    expect(await verdict(ids.paypal)).toEqual({ url: PAYPAL, identity_url: null, on_site: false })
    expect(await verdict(ids.discord)).toEqual({ url: DISCORD, identity_url: null, on_site: false })
    expect(await verdict(ids.kofi)).toEqual({ url: KOFI, identity_url: KOFI, on_site: false })
  })

  it('CRITICAL: an OFF-site identity profile rides identity_links, beside the on-site one', async () => {
    expect(await identityUrls()).toEqual([INSTAGRAM, KOFI, SPOTIFY].sort())
  })

  it('an off-site creator page that names the artist rides too (Ko-fi), as its connection labelled it', async () => {
    expect(((await door()).identity_links ?? []).find((l) => l.url === KOFI)).toEqual({ url: KOFI, label: 'Ko-fi' })
  })

  it('CRITICAL: each entry is url + label and nothing else', async () => {
    const entries = (await door()).identity_links ?? []
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(['label', 'url'])
    expect(entries.find((e) => e.url === SPOTIFY)).toEqual({ url: SPOTIFY, label: 'Spotify' })
  })

  it('CRITICAL: an off-site payment handle and an invite are never sent — though both ARE published', async () => {
    // Planted witness: put PayPal and Discord on the site for a moment. They then show as
    // buttons, which proves their snapshots are published and the door can see them.
    await svc.from('links').update({ on_site: true }).in('id', [ids.paypal, ids.discord])
    try {
      expect(await buttonUrls()).toEqual(expect.arrayContaining([PAYPAL, DISCORD]))
      expect(await identityUrls()).not.toContain(PAYPAL)
      expect(await identityUrls()).not.toContain(DISCORD)
    } finally {
      await svc.from('links').update({ on_site: false }).in('id', [ids.paypal, ids.discord])
    }
    expect(await identityUrls()).not.toContain(PAYPAL)
    expect(await identityUrls()).not.toContain(DISCORD)
  })

  it('CRITICAL: `links` is unchanged — buttons only, and no verdict on the wire', async () => {
    expect(await buttonUrls()).toEqual([INSTAGRAM])
    for (const l of (await door()).links ?? []) expect(l).not.toHaveProperty('identity_url')
  })

  it('CRITICAL: the door publishes only the url the verdict names (a verdict for another url vouches for nothing)', async () => {
    // A verdict the write path never made: a hand write naming a different url than the one
    // published. The door must not send the published url on its strength.
    await svc.from('links').update({ identity_url: SPOTIFY }).eq('id', ids.paypal)
    try {
      expect(await identityUrls()).not.toContain(PAYPAL)
      // The control, so the line above can fail: the stored verdict IS the door's only gate.
      // A verdict naming PayPal's own published url (which no TS write would ever make) lets
      // it through — which is why only lib/content.ts and the backfill write this column.
      await svc.from('links').update({ identity_url: PAYPAL }).eq('id', ids.paypal)
      expect(await identityUrls()).toContain(PAYPAL)
    } finally {
      await svc.from('links').update({ identity_url: null }).eq('id', ids.paypal)
    }
  })

  it('CRITICAL: a draft edit to a playlist drops the published profile until it is judged again', async () => {
    await updateContent(asA, 'link', ids.spotify, { url: PLAYLIST })
    expect(await verdict(ids.spotify)).toMatchObject({ url: PLAYLIST, identity_url: null })
    // The published snapshot still says the artist page, but nothing vouches for it now.
    expect(await identityUrls()).toEqual([INSTAGRAM, KOFI].sort())

    // Back to the artist page: judged again, and it matches the published url at once.
    await updateContent(asA, 'link', ids.spotify, { url: SPOTIFY })
    expect(await verdict(ids.spotify)).toMatchObject({ url: SPOTIFY, identity_url: SPOTIFY })
    expect(await identityUrls()).toEqual([INSTAGRAM, KOFI, SPOTIFY].sort())
  })

  it('the preview payload sends the same identity_links as the door (preview parity)', async () => {
    const working = await getWorkingSitePayload(asA, artist.id)
    const published = (await door()).identity_links ?? []
    expect(published.length).toBe(3) // non-vacuous
    const key = (xs: { url: string; label: string | null }[]) => [...xs].sort((a, b) => a.url.localeCompare(b.url))
    expect(key(working?.identity_links ?? [])).toEqual(key(published))
  })

  it('a published link whose working row is gone has no verdict, so it is not sent', async () => {
    // `links` keeps a deleted row's snapshot until a publish tombstones it (links-on-site);
    // identity_links has nothing left to vouch for it and drops it at once.
    await svc.from('links').delete().eq('id', ids.spotify)
    expect(await identityUrls()).toEqual([INSTAGRAM, KOFI].sort())
  })
})
