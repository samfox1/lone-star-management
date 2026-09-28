// One click of Publish is ONE version in the history: everything it sends lands together,
//   under one timestamp, or none of it lands.
/**
 * The version picker lists `publish_moments`, which groups the log by EXACT `published_at`
 * (20260815120000). The column defaults to now(), the TRANSACTION's time, so one insert is
 * one moment and two inserts are two. The multi-kind publishes used to insert once per
 * kind: one Brand Publish (logos, fonts, colours, browser bar) read as up to four versions
 * in the history, and a failure halfway shipped the fonts without the colours.
 *
 * What only the real database can show: that the rows really share one timestamp (a stub
 * would say whatever it was told), that `publish_moments` counts them as one, and that a
 * statement with one refused row writes NONE of them.
 *
 * THE REFUSED ROW. The app cannot build a revision the table refuses (every entity type
 * comes from PUBLISHABLE), so `refusing` below renames one kind's rows to an entity type
 * `revisions_entity_type_check` does not admit, on the way into the real insert. The kind
 * it spoils is the LAST one each publish sends, so a per-kind publish would have landed
 * every other kind before hitting it — which is exactly what these tests fail on.
 *
 * Throwaway artists only (AGENTS.md rule 6): made in each test, dropped in its finally.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addLogo, BRAND_KINDS, publishBrand, setThemeColor } from '@/lib/brand'
import { addBrandColor } from '@/lib/manager-tools/brand/brand-colors'
import { addGoogleFont, setFontSlot } from '@/lib/fonts'
import { createContent, listPublishMoments, publishAll, publishMusic, publishSite } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

const svc = serviceClient()
let asA: SupabaseClient

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
})

type Rev = { entity_type: string; published_at: string }

/** Every revision the artist has, read past RLS: row STATE, not a write's return value. */
async function revisionsOf(artistId: string): Promise<Rev[]> {
  const { data, error } = await svc.from('revisions').select('entity_type, published_at').eq('artist_id', artistId)
  if (error) throw new Error(error.message)
  return (data ?? []) as Rev[]
}

/**
 * The client, with every row of `type` in a `revisions` insert renamed to an entity type
 * the table's CHECK refuses. Reads, RPCs and every other table go to the real client
 * untouched (the wrapper inherits them), so the publish builds exactly what it always does.
 */
function refusing(client: SupabaseClient, type: string): SupabaseClient {
  const wrapped = Object.create(client) as SupabaseClient
  wrapped.from = ((table: string) => {
    const query = client.from(table)
    if (table !== 'revisions') return query
    const insert = query.insert.bind(query)
    const spoil = (r: Record<string, unknown>) => (r.entity_type === type ? { ...r, entity_type: `${type}_refused` } : r)
    return Object.assign(Object.create(query), {
      insert: (rows: Record<string, unknown> | Record<string, unknown>[], options?: Parameters<typeof insert>[1]) =>
        insert(Array.isArray(rows) ? rows.map(spoil) : spoil(rows), options),
    })
  }) as SupabaseClient['from']
  return wrapped
}

/** The one moment a publish made: every row it wrote shares ONE published_at, and the
 *  history the version picker reads lists exactly that moment with all of them in it. */
async function expectOneMoment(artistId: string, entities: number) {
  const revs = await revisionsOf(artistId)
  expect(revs).toHaveLength(entities)
  const stamps = [...new Set(revs.map((r) => r.published_at))]
  expect(stamps, 'every row of one publish must share its published_at').toHaveLength(1)
  const moments = await listPublishMoments(asA, artistId)
  expect(moments).toEqual([{ publishedAt: stamps[0], entities }])
  return revs
}

/** A brand with one change of every kind the Brand page publishes. */
async function stageBrand(t: ThrowawayArtist) {
  expect((await addBrandColor(asA, t.id, { name: 'Cream', hex: '#f4f1ea' })).ok).toBe(true)
  const archivo = await addGoogleFont(asA, t.id, 'Archivo')
  expect(archivo.ok, archivo.error).toBe(true)
  expect((await setFontSlot(asA, t.id, 'primary', archivo.font!.id)).ok).toBe(true)
  expect((await setThemeColor(asA, t.id, '#0a0a0a')).ok).toBe(true)
  const logo = await addLogo(asA, t.id, { title: 'Tour', storagePath: `${t.id}/brand/${crypto.randomUUID()}.png` })
  expect(logo.ok, logo.error).toBe(true)
  // The premise every assertion below leans on: nothing is published yet.
  expect(await revisionsOf(t.id)).toEqual([])
}

describe('the Brand Publish', () => {
  it('CRITICAL: a colour, a Google font in a slot, the browser bar and a logo publish as ONE moment', async () => {
    const t = await createThrowawayArtist(svc, 'One moment brand', asA)
    try {
      await stageBrand(t)
      const written = await publishBrand(asA, t.id)
      const revs = await expectOneMoment(t.id, written)
      // …and it really was several kinds: all of them, from the registry.
      expect(new Set(revs.map((r) => r.entity_type))).toEqual(new Set(BRAND_KINDS))
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: atomic — one kind refused, and NOTHING from that publish lands', async () => {
    const t = await createThrowawayArtist(svc, 'One moment brand refused', asA)
    try {
      await stageBrand(t)
      const last = BRAND_KINDS.at(-1)!
      await expect(publishBrand(refusing(asA, last), t.id)).rejects.toThrow('revisions_entity_type_check')
      expect(await revisionsOf(t.id), 'no font, no logo, no colour without the rest').toEqual([])
      expect(await listPublishMoments(asA, t.id)).toEqual([])

      // The refusal was the planted row and nothing else: the same publish, unspoiled, lands.
      const written = await publishBrand(asA, t.id)
      expect(written).toBeGreaterThanOrEqual(BRAND_KINDS.length)
      await expectOneMoment(t.id, written)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe("the editor's Publish (publishAll)", () => {
  /** Content in several types, so the publish has several kinds to send. */
  async function stageSite(t: ThrowawayArtist) {
    await createContent(asA, 'link', t.id, { label: 'One moment link', url: 'https://a.example' })
    await createContent(asA, 'tour_date', t.id, { date: '2026-11-11', venue: 'One moment venue' })
    const { error } = await asA.from('site_content').insert({ artist_id: t.id, key: 'bio', value: 'One moment bio' })
    expect(error).toBeNull()
    expect((await addBrandColor(asA, t.id, { name: 'Cream', hex: '#f4f1ea' })).ok).toBe(true)
    expect(await revisionsOf(t.id)).toEqual([])
  }

  it('CRITICAL: every type and the profile publish as ONE moment', async () => {
    const t = await createThrowawayArtist(svc, 'One moment all', asA)
    try {
      await stageSite(t)
      const written = await publishAll(asA, t.id)
      // publishAll counts content rows; the profile singleton rides in the same moment.
      const revs = await expectOneMoment(t.id, written + 1)
      const types = new Set(revs.map((r) => r.entity_type))
      for (const type of ['artist', 'link', 'tour_date', 'site_content', 'brand_color']) expect(types).toContain(type)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: atomic — a refused profile takes the content with it, and the site does not go live', async () => {
    const t = await createThrowawayArtist(svc, 'One moment all refused', asA)
    try {
      await stageSite(t)
      await expect(publishAll(refusing(asA, 'artist'), t.id)).rejects.toThrow('revisions_entity_type_check')
      expect(await revisionsOf(t.id)).toEqual([])
      const { data, error } = await anonClient().rpc('get_public_site', { p_slug: t.slug })
      expect(error).toBeNull()
      expect(data, 'a site with no published profile is not live').toBeNull()

      await publishAll(asA, t.id)
      const { data: live } = await anonClient().rpc('get_public_site', { p_slug: t.slug })
      expect(live, 'the unspoiled publish does make it live, so the null above meant something').not.toBeNull()
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('the Site and Music publishes', () => {
  it('CRITICAL: the Site Publish (photos, site text, profile) is ONE moment', async () => {
    const t = await createThrowawayArtist(svc, 'One moment site', asA)
    try {
      const { error: mErr } = await asA
        .from('media')
        .insert({ artist_id: t.id, purpose: 'gallery_image', storage_path: `${t.id}/gallery/${crypto.randomUUID()}.jpg` })
      expect(mErr).toBeNull()
      const { error: cErr } = await asA.from('site_content').insert({ artist_id: t.id, key: 'bio', value: 'One moment bio' })
      expect(cErr).toBeNull()

      const written = await publishSite(asA, t.id)
      const revs = await expectOneMoment(t.id, written + 1)
      expect(new Set(revs.map((r) => r.entity_type))).toEqual(new Set(['media', 'site_content', 'artist']))
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: the Music Publish (releases and songs) is ONE moment', async () => {
    const t = await createThrowawayArtist(svc, 'One moment music', asA)
    try {
      await createContent(asA, 'release', t.id, { title: 'One moment EP', slug: `om-${crypto.randomUUID().slice(0, 8)}`, links: [] })
      await createContent(asA, 'track', t.id, { title: 'One moment song' })

      const written = await publishMusic(asA, t.id)
      const revs = await expectOneMoment(t.id, written)
      expect(new Set(revs.map((r) => r.entity_type))).toEqual(new Set(['release', 'track']))
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})
