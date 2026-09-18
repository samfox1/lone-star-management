// After a full publish, the manager's preview matches the public site exactly.
/**
 * PHASE 0 — preview parity: after a full publish, the manager preview
 * (getWorkingSite) matches the public site (getPublishedSite) for the profile +
 * media. Canary for the versioning refactor.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). The row bookkeeping here was already
 * careful — ids captured per table, a `site_content` heading read and written BACK rather
 * than deleted. All of that was scaffolding around a problem it could not solve: this file
 * calls `publishAll` FOUR times, and `publishAll` publishes every type plus the profile.
 * Against the shared seed artist that is not a fixture, it is the artist's live site, and
 * every run committed whatever they had pending — songs, photos, tour dates, styling — as a
 * side effect of a parity check. The bio was overwritten and restored from a hard-coded
 * `SEED_BIO` literal for the same reason, which is the tell: a teardown reconstructing state
 * from a constant is one that does not own the state.
 *
 * With an owned artist the save-and-restore machinery is simply deleted, not rewritten.
 * There is no prior heading to preserve, `publishAll` reaches nothing but this file's rows,
 * and teardown is one cascading delete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishAll, publishContent } from '@/lib/content'
import { getPublishedSite, getWorkingSite, getWorkingSitePayload } from '@/lib/site'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Preview parity', asA)
  artistA = tenantA.id
})

/** Rows this file created, per table — still tracked, because the comparisons below are
 *  scoped to them (see `myMedia`). Teardown no longer needs the list. */
const created: { table: string; id: string; path?: string }[] = []

/** Insert + remember the ids. `.select('id')` is what makes scoped teardown possible. */
async function insertRows(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
) {
  const list = Array.isArray(rows) ? rows : [rows]
  const { data, error } = await client.from(table).insert(rows).select('id')
  if (error) throw new Error(`${table} insert: ${error.message}`)
  ;(data ?? []).forEach((r, i) => {
    created.push({ table, id: r.id as string, path: list[i]?.storage_path as string | undefined })
  })
  return data ?? []
}

/** The rows this file created, on either side of the comparison.
 *
 *  Parity is a property of a row, not of the artist: a PUBLISHED row whose working row was
 *  deleted is legitimately present on one side only (a snapshot outlives its working row
 *  until a tombstone — see content.on-site.test.ts), and the second test below deliberately
 *  creates that asymmetry. The fixtures populate every snapshot field, so drift still shows
 *  up here. */
const myPaths = () => created.filter((r) => r.path).map((r) => r.path!)
const myMedia = (rows: { url: string }[] | undefined) =>
  (rows ?? []).filter((m) => myPaths().some((p) => m.url.includes(p)))

/** site_content is keyed (artist_id, key). On an artist this file created there is no
 *  prior row to preserve, so this is a plain insert — the read-old-value-and-put-it-back
 *  dance only existed because the heading belonged to somebody else. */
async function setHeading(value: string) {
  await insertRows(asA, 'site_content', { artist_id: artistA, key: 'tracks_heading', value })
}

afterAll(async () => {
  // Cascades every row above and every revision published off them.
  await deleteThrowawayArtist(svc, tenantA)
})

const byId = (arr: { id: string }[] | undefined) =>
  Object.fromEntries((arr ?? []).map((x) => [x.id, x]))

describe('preview == live after a full publish', () => {
  it('profile and media match between working (preview) and published (public)', async () => {
    await asA.from('artists').update({ bio: 'PARITY bio', template: 'classic' }).eq('id', artistA)
    await insertRows(asA, 'media', {
      artist_id: artistA,
      purpose: 'profile_photo',
      storage_path: `${artistA}/profile/parity.jpg`,
    })
    await setHeading('PARITY heading')

    await publishAll(asA, artistA)

    const published = await getPublishedSite(anonClient(), tenantA.slug)
    const working = await getWorkingSite(asA, artistA)
    expect(published).not.toBeNull()

    expect(working!.artist).toEqual(published!.artist)
    expect(myMedia(working!.media)).toEqual(myMedia(published!.media))
    // The SQL jsonb_object_agg and the JS Object.fromEntries fold must agree.
    expect(working!.site_content).toEqual(published!.site_content)
    expect(published!.site_content.tracks_heading).toBe('PARITY heading')
  })

  it('CRITICAL: an OFF-SITE gallery photo is absent from BOTH preview and live', async () => {
    // The gate applies to gallery_image ONLY, so the profile_photo above can't
    // catch drift here: get_public_site hides an off-site gallery photo, and
    // getWorkingSite must drop it too or /preview lies about what's on the site.
    await insertRows(asA, 'media', [
      { artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/gallery/on.jpg`, on_site: true },
      { artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/gallery/off.jpg`, on_site: false },
    ])
    await publishAll(asA, artistA)

    const published = await getPublishedSite(anonClient(), tenantA.slug)
    const working = await getWorkingSite(asA, artistA)

    const shows = (site: { media: { url: string }[] } | null, name: string) =>
      (site?.media ?? []).some((m) => m.url.includes(name))

    expect(shows(published, 'gallery/on.jpg')).toBe(true)
    expect(shows(published, 'gallery/off.jpg')).toBe(false) // the door gates it
    expect(shows(working, 'gallery/on.jpg')).toBe(true)
    expect(shows(working, 'gallery/off.jpg')).toBe(false) // preview must agree
    expect(myMedia(working!.media)).toEqual(myMedia(published!.media))
  })

  it('the custom-site draft payload carries media PATHS, and applies the same gate', async () => {
    // getWorkingSitePayload is what the editor posts to a custom site over
    // init-data. It must emit raw paths (skeen resolves them against its own
    // Supabase URL) and must apply the gallery gate exactly like getWorkingSite —
    // they share one builder precisely so they can't drift.
    await insertRows(asA, 'media', [
      { artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/gallery/p-on.jpg`, on_site: true },
      { artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/gallery/p-off.jpg`, on_site: false },
    ])

    const payload = await getWorkingSitePayload(asA, artistA)
    const paths = (payload?.media ?? []).map((m) => m.path)

    expect(paths).toContain(`${artistA}/gallery/p-on.jpg`)
    expect(paths).not.toContain(`${artistA}/gallery/p-off.jpg`)
    // Raw path, not a lone-star-built URL — the whole point of the wire shape.
    for (const m of payload?.media ?? []) {
      expect(m).not.toHaveProperty('url')
      expect(m.path.startsWith('http')).toBe(false)
    }
  })

  it('GUARDRAIL: merch ID ORDER matches working↔published (the door is newest-first)', async () => {
    // The section guardrail below is keyed by id ON PURPOSE, so ordering drift is
    // invisible to it — and merch drifted for eight days because of exactly that:
    // 20260910160000 made the door `sort_order nulls last, created_at DESC` and nothing
    // changed PUBLISHABLE.merch.orderBy, so /preview listed products oldest-first while
    // the live site listed them newest-first.
    //
    // Three products, no sort_order (an UNDRAGGED list — the case where created_at is
    // the only key), with created_at set explicitly and a day apart so the two possible
    // orders are exact reverses rather than a tie the DB may break either way.
    const day = 86_400_000
    const base = Date.parse('2026-03-01T00:00:00Z')
    const oldestFirst = await insertRows(
      svc,
      'merch',
      ['ORD merch A', 'ORD merch B', 'ORD merch C'].map((title, i) => ({
        artist_id: artistA,
        title,
        price: 10 + i,
        source: 'manual',
        created_at: new Date(base + i * day).toISOString(),
      })),
    )
    const ids = oldestFirst.map((r) => r.id as string)

    await publishContent(svc, 'merch', artistA)
    const published = await getPublishedSite(anonClient(), tenantA.slug)
    const working = await getWorkingSite(asA, artistA)

    const mineInOrder = (rows: { id: string }[] | undefined) =>
      (rows ?? []).filter((m) => ids.includes(m.id)).map((m) => m.id)

    // Planted witness: all three really are on the public payload, so neither
    // comparison below can pass over an empty list.
    expect(mineInOrder(published!.merch)).toHaveLength(3)
    // Pin the DIRECTION, not just the agreement — otherwise both sides being wrong the
    // same way would read as parity.
    expect(mineInOrder(published!.merch)).toEqual([...ids].reverse())
    expect(mineInOrder(working!.merch)).toEqual(mineInOrder(published!.merch))
  })

  it('GUARDRAIL: every content section matches working↔published (snapshot ↔ door drift)', async () => {
    // Insert rows with EVERY snapshot field populated — including ones only sync/
    // upload set (provider_url, audio_path) — so a field the SQL door drops or the
    // TS getWorkingSite mapping forgets surfaces as a parity mismatch.
    //
    // Scoped to THIS test's rows, not every row the FILE created: that set also holds the
    // three merch rows the ordering test above planted, and the exact `toHaveLength(1)`
    // below is what makes this non-vacuous — it must count one row, not "at least one".
    const par: Record<string, string[]> = {}
    const insertPar = async (table: string, row: Record<string, unknown>) => {
      par[table] = (await insertRows(svc, table, row)).map((r) => r.id as string)
    }
    await insertPar('tracks', {
      artist_id: artistA, title: 'PAR track', cover_url: 'https://img/c.jpg', stream_url: 'https://x/s',
      provider_url: 'https://deezer.com/p', audio_path: `${artistA}/audio/par.mp3`, sort_order: 1, source: 'manual',
    })
    await insertPar('tour_dates', {
      artist_id: artistA, date: '2026-08-01', venue: 'PAR venue', city: 'Austin', country: 'US',
      ticket_url: 'https://x/t', source: 'manual',
    })
    await insertPar('merch', {
      artist_id: artistA, title: 'PAR merch', image_url: 'https://img/m.jpg', price: 25, url: 'https://x/b', source: 'manual',
    })
    await insertPar('links', {
      artist_id: artistA, label: 'PAR link', url: 'https://x/l', sort_order: 1, source: 'manual',
    })
    await insertPar('videos', {
      artist_id: artistA, title: 'PAR video', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/par',
      youtube_id: 'par', source: 'manual',
    })

    await publishAll(asA, artistA)
    const published = await getPublishedSite(anonClient(), tenantA.slug)
    const working = await getWorkingSite(asA, artistA)

    // Keyed by id (order-insensitive): isolates field drift from ordering ties.
    for (const [key, table] of [
      ['tracks', 'tracks'], ['tour_dates', 'tour_dates'], ['merch', 'merch'],
      ['links', 'links'], ['videos', 'videos'],
    ] as const) {
      const ids = new Set(par[table])
      const only = (rows: { id: string }[] | undefined) => (rows ?? []).filter((r) => ids.has(r.id))
      expect(Object.keys(byId(only(published![key])))).toHaveLength(1) // non-vacuous
      expect(byId(only(working![key]))).toEqual(byId(only(published![key])))
    }
  })
})
