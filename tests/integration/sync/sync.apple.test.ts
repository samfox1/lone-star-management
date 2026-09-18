// Apple Music sync against the real database, including the cross-platform merge.
/**
 * Apple Music track sync (real DB) — now a UNION merge, not a mutually-exclusive
 * source. Same conflict policy for exact-id matches (insert new, refresh
 * apple-owned, never clobber manual), PLUS cross-platform merge: an Apple song that
 * matches an existing track (from another platform) by normalized title + duration
 * is STAMPED onto that row (apple_id + apple_url) instead of duplicated. Apple's
 * link lives in `apple_url`, never the legacy shared `provider_url`. RLS-scoped.
 *
 * TENANCY, AND WHY THE ARTISTS ARE THROWAWAYS. This file used to run on the shared seed
 * artists and wipe BOTH of their `tracks` after every test. That is the teardown
 * AGENTS.md rule 6 forbids, and here it did the precise damage the rule describes: the
 * tenancy test below asserted "artist B has 0 tracks" as proof that a cross-tenant sync
 * was refused, and a teardown two files away (sync.bandsintown.test.ts, same shape) had
 * already guaranteed that zero. The denial had no witness and could not fail. Both
 * artists are now created by this file and dropped by it, so "delete every track for
 * this artist" IS "delete exactly what I created", the absolute counts below are true
 * about an empty table rather than true by accident, and B carries a PLANTED row so the
 * refusal has something to refuse.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncAppleTracks } from '@/lib/sync'
import type { AppleTrackInput } from '@/lib/apple'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const asB = await signInAs(SEED.managerB)
  artistA = (await createThrowawayArtist(svc, 'Apple sync A', asA)).id
  artistB = (await createThrowawayArtist(svc, 'Apple sync B', asB)).id
})

afterAll(async () => {
  // Cascades every track either artist ever held.
  await deleteThrowawayArtist(svc, artistA)
  await deleteThrowawayArtist(svc, artistB)
})

afterEach(async () => {
  // Safe as a blanket wipe ONLY because both artists were created by this file: no other
  // suite, and no human, has a row under them. Each test below asserts absolute counts,
  // so it needs the table genuinely empty rather than merely emptied-of-our-rows.
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('tracks').delete().eq('artist_id', artistB)
})

const ap = (id: string, title: string, extra: Partial<AppleTrackInput> = {}): AppleTrackInput => ({
  apple_id: id,
  title,
  album_name: null,
  cover_url: `https://img/${id}.jpg`,
  provider_url: `https://music.apple.com/us/song/${id}`,
  duration_ms: null,
  ...extra,
})

describe('syncAppleTracks — exact-id conflict policy', () => {
  it('inserts new, refreshes apple-owned, never clobbers manual; link in apple_url', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'My Edit', apple_id: 'ap-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale', apple_id: 'ap-auto', source: 'apple' },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap-manual', 'SHOULD NOT OVERWRITE'),
      ap('ap-auto', 'Fresh'),
      ap('ap-new', 'Brand New'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, merged: 0, failed: 0 })

    const { data } = await svc
      .from('tracks')
      .select('title, source, apple_id, apple_url, provider_url, stream_url, on_site')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.apple_id, r]))
    expect(byId['ap-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    expect(byId['ap-auto']).toMatchObject({ title: 'Fresh', source: 'apple' })
    expect(byId['ap-new']).toMatchObject({
      title: 'Brand New',
      source: 'apple',
      apple_url: 'https://music.apple.com/us/song/ap-new',
      provider_url: null, // Apple's link goes in apple_url, not the legacy column
      stream_url: null,
      // `not null default true` in the DB and coalesced to true by the public doors:
      // without this explicit false a raw import would be live on the artist's site.
      on_site: false,
    })
  })

  it('a refresh never blanks a field another platform filled', async () => {
    // Sync runs Spotify → Apple → Deezer on one click, so any provider that writes
    // nulls unconditionally erases its predecessors' work every time.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Rain', apple_id: 'ap-keep', source: 'apple', album_name: 'Weather', cover_url: 'https://img/keep.jpg', duration_ms: 200000 },
    ])

    await syncAppleTracks(asA, artistA, [
      ap('ap-keep', 'Rain Refreshed', { album_name: null, cover_url: null, duration_ms: null }),
    ])

    const { data } = await svc
      .from('tracks')
      .select('title, album_name, cover_url, duration_ms')
      .eq('artist_id', artistA)
      .single()
    expect(data).toMatchObject({
      title: 'Rain Refreshed', // Apple owns the title, so that DOES refresh
      album_name: 'Weather',
      cover_url: 'https://img/keep.jpg',
      duration_ms: 200000,
    })
  })
})

describe('syncAppleTracks — cross-platform merge', () => {
  it('stamps Apple onto the SAME song imported from Spotify (title + duration match)', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'OutWest', spotify_id: 'sp1', stream_url: 'https://open.spotify.com/track/sp1', source: 'spotify', duration_ms: 98000 },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap1', 'OutWest', { duration_ms: 98000, provider_url: 'https://music.apple.com/us/song/ap1' }),
    ])
    expect(result).toMatchObject({ added: 0, updated: 0, merged: 1, failed: 0 })

    const { data } = await svc.from('tracks').select('*').eq('artist_id', artistA)
    expect(data).toHaveLength(1) // merged, not duplicated
    expect(data![0]).toMatchObject({
      title: 'OutWest', // Spotify's title kept
      source: 'spotify', // ownership unchanged
      spotify_id: 'sp1',
      apple_id: 'ap1', // now also on Apple
      apple_url: 'https://music.apple.com/us/song/ap1',
      stream_url: 'https://open.spotify.com/track/sp1', // Spotify link untouched
    })
  })

  it('matches through a (feat.) title variant — a feature credit names the same recording', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Drive', spotify_id: 'sp2', source: 'spotify', duration_ms: 90000, album_name: null },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap2', 'Drive (feat. Nova)', { duration_ms: 90500, album_name: 'Nightdrive' }),
    ])
    expect(result).toMatchObject({ merged: 1, added: 0 })

    const { data } = await svc.from('tracks').select('title, spotify_id, apple_id, album_name').eq('artist_id', artistA)
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ title: 'Drive', spotify_id: 'sp2', apple_id: 'ap2', album_name: 'Nightdrive' })
  })

  it('does NOT merge a same-title song when durations are far apart — inserts instead', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Reused', spotify_id: 'sp3', source: 'spotify', duration_ms: 100000 },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap3', 'Reused', { duration_ms: 200000 }),
    ])
    expect(result).toMatchObject({ added: 1, merged: 0 })

    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistA)
    expect(count).toBe(2) // two distinct songs that happen to share a title
  })

  it('CRITICAL: with no duration to compare, ONE candidate merges — and the pull names it', async () => {
    // THE RULE CHANGED ON 2026-09-12 (Sam: "the merge should be sorted upon sync. If
    // there are duplicates, notify me when the sync happens"). It used to refuse outright
    // whenever a duration was missing, because a wrong merge is silent and permanent while
    // a duplicate is visible and cheap. The asymmetry that rested on was the SILENCE — so
    // the merge is reported by name, and the hand-added song whose platform link arrives
    // on a later pull (the case Sam described) is no longer left with a twin.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Unknown Length', spotify_id: 'sp4', source: 'spotify', duration_ms: null },
    ])

    const result = await syncAppleTracks(asA, artistA, [ap('ap4', 'Unknown Length', { duration_ms: 120000 })])
    expect(result).toMatchObject({ added: 0, merged: 1 })
    expect(result.notes).toEqual([{ title: 'Unknown Length', kind: 'merged-by-title' }])

    const { data } = await svc.from('tracks').select('id, apple_id').eq('artist_id', artistA)
    expect(data).toHaveLength(1)
    expect(data![0].apple_id).toBe('ap4')
  })

  it('CRITICAL: with no duration and SEVERAL candidates it still refuses — and names the duplicate', async () => {
    // Nothing can tell two same-titled recordings apart, so absorbing one is the permanent
    // loss the old rule feared. The song is inserted, and the manager is told.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Twin', spotify_id: 'sp4a', source: 'spotify', duration_ms: null },
      { artist_id: artistA, title: 'Twin', spotify_id: 'sp4b', source: 'spotify', duration_ms: null },
    ])

    const result = await syncAppleTracks(asA, artistA, [ap('ap4b', 'Twin', { duration_ms: null })])
    expect(result).toMatchObject({ added: 1, merged: 0 })
    expect(result.notes).toEqual([{ title: 'Twin', kind: 'possible-duplicate' }])

    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistA)
    expect(count).toBe(3)
  })

  it('keeps an alternate take as its OWN song even at an identical duration', async () => {
    // The studio cut and the live take can run to the same length, so duration alone
    // cannot separate them. Merging here would absorb the live take and delete it from
    // the catalog — and `remix` is a real release_type elsewhere in the app.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Rain', spotify_id: 'sp5', source: 'spotify', duration_ms: 200000 },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap-live', 'Rain (Live)', { duration_ms: 200000 }),
      ap('ap-ac', 'Rain (Acoustic)', { duration_ms: 200000 }),
      ap('ap-rmx', 'Rain (Remix)', { duration_ms: 200000 }),
      ap('ap-demo', 'Rain (Demo)', { duration_ms: 200000 }),
    ])
    expect(result).toMatchObject({ added: 4, merged: 0 })

    const { data } = await svc.from('tracks').select('title').eq('artist_id', artistA)
    expect((data ?? []).map((r) => r.title).sort()).toEqual([
      'Rain',
      'Rain (Acoustic)',
      'Rain (Demo)',
      'Rain (Live)',
      'Rain (Remix)',
    ])
  })

  it('still merges the SAME marked version across platforms', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Rain - Live', spotify_id: 'sp6', source: 'spotify', duration_ms: 200000 },
      { artist_id: artistA, title: 'Rain (Live)', spotify_id: 'sp7', source: 'spotify', duration_ms: 200000 },
    ])

    // Apple's "Rain [live]" is the same take as Spotify's "Rain (Live)"; the plain
    // "Rain - Live" row has no parenthetical marker, so it keys separately.
    const result = await syncAppleTracks(asA, artistA, [ap('ap-live', 'Rain [live]', { duration_ms: 200000 })])
    expect(result).toMatchObject({ merged: 1, added: 0 })

    const { data } = await svc.from('tracks').select('spotify_id, apple_id').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.spotify_id, r.apple_id]))
    expect(byId['sp7']).toBe('ap-live')
    expect(byId['sp6']).toBeNull()
  })
})

describe('syncAppleTracks — tenancy', () => {
  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    // A PLANTED WITNESS (AGENTS.md rule 2). The old version of this test asserted that B
    // held 0 tracks afterwards — which the afterEach teardown guaranteed before the sync
    // was ever attempted, so the assertion passed whether RLS refused the write or waved
    // it through. Plant a row first: now "B's catalog is untouched" is a statement about
    // a table that HAS something in it, and an insert that landed would show up.
    const { data: witness, error: plantErr } = await svc
      .from('tracks')
      .insert({ artist_id: artistB, title: "B's own song", source: 'manual' })
      .select('id')
      .single()
    expect(plantErr, 'the witness must exist before the denial means anything').toBeNull()

    // Postgres must be the thing refusing — a bare .toThrow() would also pass on a
    // sync that crashed before ever reaching the insert, proving nothing.
    await expect(syncAppleTracks(asA, artistB, [ap('ap-evil', 'evil')])).rejects.toThrow(/row-level security/i)

    const { data } = await svc.from('tracks').select('id, title').eq('artist_id', artistB)
    expect(data).toHaveLength(1) // the witness, and nothing the sync tried to add
    expect(data![0]).toMatchObject({ id: witness!.id, title: "B's own song" })
  })
})
