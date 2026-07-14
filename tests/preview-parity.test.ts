/**
 * PHASE 0 — preview parity: after a full publish, the manager preview
 * (getWorkingSite) matches the public site (getPublishedSite) for the profile +
 * media. Canary for the versioning refactor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishAll, publishProfile } from '@/lib/content'
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

const CONTENT_TABLES = ['tracks', 'tour_dates', 'merch', 'links', 'videos'] as const

afterAll(async () => {
  await svc.from('media').delete().eq('artist_id', artistA)
  await svc.from('site_content').delete().eq('artist_id', artistA)
  for (const t of CONTENT_TABLES) await svc.from(t).delete().eq('artist_id', artistA)
  await svc
    .from('revisions')
    .delete()
    .eq('artist_id', artistA)
    .in('entity_type', ['media', 'artist', 'site_content', 'track', 'tour_date', 'merch', 'link', 'video'])
  await svc.from('artists').update({ bio: SEED_BIO, template: 'classic' }).eq('id', artistA)
  await publishProfile(svc, artistA)
})

const byId = (arr: { id: string }[] | undefined) =>
  Object.fromEntries((arr ?? []).map((x) => [x.id, x]))

describe('preview == live after a full publish', () => {
  it('profile and media match between working (preview) and published (public)', async () => {
    await asA.from('artists').update({ bio: 'PARITY bio', template: 'classic' }).eq('id', artistA)
    await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'profile_photo', storage_path: `${artistA}/profile/parity.jpg` })
    await asA
      .from('site_content')
      .upsert({ artist_id: artistA, key: 'tracks_heading', value: 'PARITY heading' }, { onConflict: 'artist_id,key' })

    await publishAll(asA, artistA)

    const published = await getPublishedSite(anonClient(), SEED.artistASlug)
    const working = await getWorkingSite(asA, artistA)
    expect(published).not.toBeNull()

    expect(working!.artist).toEqual(published!.artist)
    expect(working!.media).toEqual(published!.media)
    // The SQL jsonb_object_agg and the JS Object.fromEntries fold must agree.
    expect(working!.site_content).toEqual(published!.site_content)
    expect(published!.site_content.tracks_heading).toBe('PARITY heading')
  })

  it('CRITICAL: an OFF-SITE gallery photo is absent from BOTH preview and live', async () => {
    // The gate applies to gallery_image ONLY, so the profile_photo above can't
    // catch drift here: get_public_site hides an off-site gallery photo, and
    // getWorkingSite must drop it too or /preview lies about what's on the site.
    await asA.from('media').insert([
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
    expect(working!.media).toEqual(published!.media)
  })

  it('the custom-site draft payload carries media PATHS, and applies the same gate', async () => {
    // getWorkingSitePayload is what the editor posts to a custom site over
    // init-data. It must emit raw paths (skeen resolves them against its own
    // Supabase URL) and must apply the gallery gate exactly like getWorkingSite —
    // they share one builder precisely so they can't drift.
    await asA.from('media').insert([
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
    await svc.from('tracks').insert({
      artist_id: artistA, title: 'PAR track', cover_url: 'https://img/c.jpg', stream_url: 'https://x/s',
      provider_url: 'https://deezer.com/p', audio_path: `${artistA}/audio/par.mp3`, sort_order: 1, source: 'manual',
    })
    await svc.from('tour_dates').insert({
      artist_id: artistA, date: '2026-08-01', venue: 'PAR venue', city: 'Austin', country: 'US',
      ticket_url: 'https://x/t', source: 'manual',
    })
    await svc.from('merch').insert({
      artist_id: artistA, title: 'PAR merch', image_url: 'https://img/m.jpg', price: 25, url: 'https://x/b', source: 'manual',
    })
    await svc.from('links').insert({
      artist_id: artistA, label: 'PAR link', url: 'https://x/l', sort_order: 1, source: 'manual',
    })
    await svc.from('videos').insert({
      artist_id: artistA, title: 'PAR video', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/par',
      youtube_id: 'par', source: 'manual',
    })

    await publishAll(asA, artistA)
    const published = await getPublishedSite(anonClient(), SEED.artistASlug)
    const working = await getWorkingSite(asA, artistA)

    // Keyed by id (order-insensitive): isolates field drift from ordering ties.
    for (const key of ['tracks', 'tour_dates', 'merch', 'links', 'videos'] as const) {
      expect(byId(working![key])).toEqual(byId(published![key]))
    }
  })
})
