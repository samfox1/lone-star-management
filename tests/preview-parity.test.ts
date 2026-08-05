/**
 * PHASE 0 — preview parity: after a full publish, the manager preview
 * (getWorkingSite) matches the public site (getPublishedSite) for the profile +
 * media. Canary for the versioning refactor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishAll, publishContent, publishProfile } from '@/lib/content'
import { getPublishedSite, getWorkingSite, getWorkingSitePayload } from '@/lib/site'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const SEED_BIO = 'Dusty alt-country out of West Texas.'

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

/** Rows this file created, per table. Teardown removes ONLY these.
 *
 *  This file publishes EVERYTHING for the artist, so a teardown by artist_id was deleting
 *  every photo, song, date, merch item, link and video on the shared live project — a
 *  human's uploads between runs, and every fixture the suites after it read. */
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
 *  Parity is a property of a row, not of the artist: the site is shared, and a PUBLISHED row
 *  whose working row another suite deleted is legitimately present on one side only (a
 *  snapshot outlives its working row until a tombstone — see content.on-site.test.ts). The
 *  fixtures below populate every snapshot field, so drift still shows up here. */
const mine = (table: string) => new Set(created.filter((r) => r.table === table).map((r) => r.id))
const myPaths = () => created.filter((r) => r.path).map((r) => r.path!)
const myMedia = (rows: { url: string }[] | undefined) =>
  (rows ?? []).filter((m) => myPaths().some((p) => m.url.includes(p)))

/** site_content is keyed (artist_id, key), so this heading may already exist for real.
 *  Overwrite it and remember the old value instead of inserting a duplicate — and put the
 *  value back in teardown rather than deleting a row this file did not create. */
let priorHeading: { id: string; value: string } | null = null

async function setHeading(value: string) {
  const { data: prior } = await svc
    .from('site_content')
    .select('id, value')
    .eq('artist_id', artistA)
    .eq('key', 'tracks_heading')
    .maybeSingle()
  if (prior) {
    priorHeading = { id: prior.id as string, value: prior.value as string }
    const { error } = await asA.from('site_content').update({ value }).eq('id', prior.id)
    if (error) throw new Error(error.message)
    return
  }
  await insertRows(asA, 'site_content', { artist_id: artistA, key: 'tracks_heading', value })
}

afterAll(async () => {
  if (priorHeading) {
    await svc.from('site_content').update({ value: priorHeading.value }).eq('id', priorHeading.id)
    await publishContent(svc, 'site_content', artistA) // the snapshot must follow it back
  }
  if (created.length) {
    await svc.from('revisions').delete().in('entity_id', created.map((r) => r.id))
    for (const table of new Set(created.map((r) => r.table))) {
      await svc.from(table).delete().in('id', created.filter((r) => r.table === table).map((r) => r.id))
    }
    created.length = 0
  }
  // The profile is a singleton snapshot: restore the seed bio and republish, so the artist
  // is left LIVE rather than with its publish history deleted.
  await svc.from('artists').update({ bio: SEED_BIO }).eq('id', artistA)
  await publishProfile(svc, artistA)
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

    const published = await getPublishedSite(anonClient(), SEED.artistASlug)
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

    const published = await getPublishedSite(anonClient(), SEED.artistASlug)
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

  it('GUARDRAIL: every content section matches working↔published (snapshot ↔ door drift)', async () => {
    // Insert rows with EVERY snapshot field populated — including ones only sync/
    // upload set (provider_url, audio_path) — so a field the SQL door drops or the
    // TS getWorkingSite mapping forgets surfaces as a parity mismatch.
    await insertRows(svc, 'tracks', {
      artist_id: artistA, title: 'PAR track', cover_url: 'https://img/c.jpg', stream_url: 'https://x/s',
      provider_url: 'https://deezer.com/p', audio_path: `${artistA}/audio/par.mp3`, sort_order: 1, source: 'manual',
    })
    await insertRows(svc, 'tour_dates', {
      artist_id: artistA, date: '2026-08-01', venue: 'PAR venue', city: 'Austin', country: 'US',
      ticket_url: 'https://x/t', source: 'manual',
    })
    await insertRows(svc, 'merch', {
      artist_id: artistA, title: 'PAR merch', image_url: 'https://img/m.jpg', price: 25, url: 'https://x/b', source: 'manual',
    })
    await insertRows(svc, 'links', {
      artist_id: artistA, label: 'PAR link', url: 'https://x/l', sort_order: 1, source: 'manual',
    })
    await insertRows(svc, 'videos', {
      artist_id: artistA, title: 'PAR video', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/par',
      youtube_id: 'par', source: 'manual',
    })

    await publishAll(asA, artistA)
    const published = await getPublishedSite(anonClient(), SEED.artistASlug)
    const working = await getWorkingSite(asA, artistA)

    // Keyed by id (order-insensitive): isolates field drift from ordering ties.
    for (const [key, table] of [
      ['tracks', 'tracks'], ['tour_dates', 'tour_dates'], ['merch', 'merch'],
      ['links', 'links'], ['videos', 'videos'],
    ] as const) {
      const ids = mine(table)
      const only = (rows: { id: string }[] | undefined) => (rows ?? []).filter((r) => ids.has(r.id))
      expect(Object.keys(byId(only(published![key])))).toHaveLength(1) // non-vacuous
      expect(byId(only(working![key]))).toEqual(byId(only(published![key])))
    }
  })
})
