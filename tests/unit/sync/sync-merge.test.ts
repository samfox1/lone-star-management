// The decisions a catalog pull makes before it writes: refresh, stamp, insert, or refuse.
/**
 * Catalog merge rules — the decisions syncTracks makes BEFORE it writes: which
 * incoming song refreshes a row, which stamps onto a row imported from another
 * platform, which inserts new, and which fields a refresh is allowed to touch.
 *
 * Those decisions are pure, so they run against a ~40-line in-memory stand-in for
 * the query builder instead of the hosted database. That is the point: the
 * destructive permutations (a Live take absorbed into the studio row, an
 * album_name blanked by the last provider to run) are the ones worth enumerating,
 * and enumerating them over the wire is too slow to do properly.
 *
 * RLS / tenancy is deliberately NOT tested here — it only exists in Postgres. See
 * sync.test.ts and siblings for that.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeTitle, syncAppleTracks, syncDeezerTracks, syncSpotifyTracks } from '@/lib/sync'
import type { AppleTrackInput } from '@/lib/apple'
import type { DeezerTrackInput } from '@/lib/deezer'
import type { SpotifyTrackInput } from '@/lib/spotify'

type Row = Record<string, unknown>
type Write = { op: 'insert' | 'update'; id?: string; values: Row }

const ARTIST = 'artist-1'

/**
 * Minimal fake of the supabase-js builder: `select().eq().order()`, `insert()`,
 * and `update().eq()`. Records every write so a test can assert on the PAYLOAD,
 * not just the resulting row — a field left out of an update and a field written
 * back with its old value look identical in the row but differ in intent.
 */
function fakeDb(seed: Row[] = []) {
  const rows: Row[] = seed.map((r, i) => ({
    id: `row-${i + 1}`,
    // Insertion order is the only stable order a fake can offer; the real select
    // pins it with .order('created_at') so Postgres row order can't decide.
    created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    source: 'manual',
    title: '',
    duration_ms: null,
    cover_url: null,
    album_name: null,
    spotify_id: null,
    apple_id: null,
    deezer_id: null,
    stream_url: null,
    apple_url: null,
    provider_url: null,
    ...r,
  }))
  const writes: Write[] = []
  const orderedBy: string[] = []
  let n = rows.length

  const readQuery = () => {
    const q = {
      eq: () => q,
      order: (col: string) => {
        orderedBy.push(col)
        return q
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows.map((r) => ({ ...r })), error: null }),
    }
    return q
  }

  const client = {
    from: () => ({
      select: readQuery,
      insert: (values: Row) => {
        writes.push({ op: 'insert', values })
        rows.push({ id: `row-${++n}`, created_at: new Date().toISOString(), ...values })
        return Promise.resolve({ error: null })
      },
      update: (values: Row) => ({
        eq: (_col: string, id: string) => {
          writes.push({ op: 'update', id, values })
          const row = rows.find((r) => r.id === id)
          if (row) Object.assign(row, values)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  }

  return { db: client as unknown as SupabaseClient, rows, writes, orderedBy }
}

const sp = (over: Partial<SpotifyTrackInput> = {}): SpotifyTrackInput => ({
  spotify_id: 'sp1',
  title: 'Rain',
  cover_url: null,
  stream_url: null,
  featured_artists: [],
  album_name: null,
  duration_ms: 200_000,
  ...over,
})

const ap = (over: Partial<AppleTrackInput> = {}): AppleTrackInput => ({
  apple_id: 'ap1',
  title: 'Rain',
  album_name: null,
  cover_url: null,
  provider_url: null,
  duration_ms: 200_000,
  ...over,
})

const dz = (over: Partial<DeezerTrackInput> = {}): DeezerTrackInput => ({
  deezer_id: 'dz1',
  title: 'Rain',
  cover_url: null,
  album_name: null,
  provider_url: null,
  duration_ms: 200_000,
  ...over,
})

describe('normalizeTitle', () => {
  it('collapses punctuation, casing and non-version qualifiers so one song matches across platforms', () => {
    expect(normalizeTitle("Don't Look Back")).toBe(normalizeTitle('Dont look   back'))
    expect(normalizeTitle('Drive (feat. Nova)')).toBe(normalizeTitle('Drive'))
    expect(normalizeTitle('Drive [Explicit]')).toBe(normalizeTitle('Drive'))
  })

  it('keeps version markers as part of the identity — an alternate take is a different song', () => {
    const base = normalizeTitle('Rain')
    for (const variant of [
      'Rain (Live)',
      'Rain (Live at Wembley)',
      'Rain (Acoustic)',
      'Rain (Remix)',
      'Rain (Demo)',
      'Rain (Radio Edit)',
      'Rain (Instrumental)',
      'Rain (Extended Mix)',
    ]) {
      expect(normalizeTitle(variant)).not.toBe(base)
    }
    // …and distinct from EACH OTHER, so the Live take can't absorb the Acoustic one.
    const keys = ['Rain (Live)', 'Rain (Acoustic)', 'Rain (Remix)', 'Rain (Demo)'].map(normalizeTitle)
    expect(new Set(keys).size).toBe(4)
  })

  it('matches the same marked version across platforms despite formatting', () => {
    expect(normalizeTitle('Rain (Live)')).toBe(normalizeTitle('Rain [live]'))
    expect(normalizeTitle('Rain (Live Acoustic)')).toBe(normalizeTitle('Rain (Acoustic, Live)'))
  })
})

describe('syncTracks — exact-id refresh', () => {
  it('refreshes the row this platform owns', async () => {
    const { db, rows } = fakeDb([{ deezer_id: 'dz1', source: 'deezer', title: 'Stale', duration_ms: 200_000 }])
    const res = await syncDeezerTracks(db, ARTIST, [dz({ title: 'Fresh' })])
    expect(res).toMatchObject({ added: 0, updated: 1, merged: 0, skipped: 0, failed: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Fresh')
  })

  it('skips a row a human has taken over (source=manual)', async () => {
    const { db, rows } = fakeDb([{ deezer_id: 'dz1', source: 'manual', title: 'My Edit' }])
    const res = await syncDeezerTracks(db, ARTIST, [dz({ title: 'SHOULD NOT OVERWRITE' })])
    expect(res).toMatchObject({ added: 0, updated: 0, skipped: 1 })
    expect(rows[0].title).toBe('My Edit')
  })

  it('NEVER blanks an enrichment field another platform filled', async () => {
    // The real failure: refreshMusicAction runs Spotify → Apple → Deezer. Apple fills
    // album_name/cover_url, Deezer runs last with nothing to say, and every Sync click
    // wiped them.
    const { db, rows, writes } = fakeDb([
      {
        deezer_id: 'dz1',
        source: 'deezer',
        title: 'Rain',
        album_name: 'Weather',
        cover_url: 'https://img/cover.jpg',
        duration_ms: 200_000,
      },
    ])
    await syncDeezerTracks(db, ARTIST, [dz({ album_name: null, cover_url: null, duration_ms: null })])
    expect(rows[0]).toMatchObject({
      album_name: 'Weather',
      cover_url: 'https://img/cover.jpg',
      duration_ms: 200_000,
    })
    // Not merely written back — never sent, so a concurrent writer can't lose either.
    const patch = writes.find((w) => w.op === 'update')!.values
    expect(patch).not.toHaveProperty('album_name')
    expect(patch).not.toHaveProperty('cover_url')
    expect(patch).not.toHaveProperty('duration_ms')
  })

  it('still writes an enrichment field the platform DOES know', async () => {
    const { db, rows } = fakeDb([{ deezer_id: 'dz1', source: 'deezer', title: 'Rain', album_name: null, duration_ms: 200_000 }])
    await syncDeezerTracks(db, ARTIST, [dz({ album_name: 'Weather' })])
    expect(rows[0].album_name).toBe('Weather')
  })

  it('overwrites an enrichment field it owns with a newer value', async () => {
    const { db, rows } = fakeDb([{ deezer_id: 'dz1', source: 'deezer', title: 'Rain', album_name: 'Old', duration_ms: 200_000 }])
    await syncDeezerTracks(db, ARTIST, [dz({ album_name: 'New' })])
    expect(rows[0].album_name).toBe('New')
  })
})

describe('syncTracks — cross-platform stamp', () => {
  it('stamps a second platform onto the same song instead of duplicating it', async () => {
    const { db, rows } = fakeDb([
      { spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000, stream_url: 'https://open.spotify.com/track/sp1' },
    ])
    const res = await syncAppleTracks(db, ARTIST, [
      ap({ duration_ms: 201_000, provider_url: 'https://music.apple.com/us/song/ap1' }),
    ])
    expect(res).toMatchObject({ added: 0, updated: 0, merged: 1, failed: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      title: 'Rain',
      source: 'spotify', // ownership never changes on a stamp
      spotify_id: 'sp1',
      apple_id: 'ap1',
      apple_url: 'https://music.apple.com/us/song/ap1',
      stream_url: 'https://open.spotify.com/track/sp1',
    })
  })

  it('merges through punctuation and casing differences — what normalizeTitle is for', async () => {
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: "Don't Look Back", duration_ms: 200_000 }])
    const res = await syncAppleTracks(db, ARTIST, [ap({ title: 'Dont Look Back', duration_ms: 200_000 })])
    expect(res).toMatchObject({ merged: 1, added: 0 })
    expect(rows).toHaveLength(1)
  })

  it('fills only the columns the matched row is MISSING', async () => {
    const { db, rows } = fakeDb([
      { spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000, cover_url: 'https://img/spotify.jpg', album_name: null },
    ])
    await syncAppleTracks(db, ARTIST, [ap({ cover_url: 'https://img/apple.jpg', album_name: 'Weather' })])
    expect(rows[0]).toMatchObject({
      cover_url: 'https://img/spotify.jpg', // already known — untouched
      album_name: 'Weather', // was missing — filled
    })
  })

  it('does not re-stamp on a second run — one row, no duplicate', async () => {
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000 }])
    const first = await syncAppleTracks(db, ARTIST, [ap()])
    const second = await syncAppleTracks(db, ARTIST, [ap()])
    expect(first).toMatchObject({ merged: 1, added: 0 })
    expect(second).toMatchObject({ merged: 0, added: 0, skipped: 1 }) // now apple_id matches, but source is spotify
    expect(rows).toHaveLength(1)
  })

  it('a same-platform re-sync updates rather than inserting a duplicate', async () => {
    const { db, rows } = fakeDb([])
    const first = await syncSpotifyTracks(db, ARTIST, [sp()])
    const second = await syncSpotifyTracks(db, ARTIST, [sp({ title: 'Rain v2' })])
    expect(first).toMatchObject({ added: 1 })
    expect(second).toMatchObject({ added: 0, updated: 1 })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Rain v2')
  })
})

describe('syncTracks — refusing a destructive merge', () => {
  it('never absorbs an alternate take into the studio recording', async () => {
    // Same artist, same base title, IDENTICAL duration: duration alone cannot save us,
    // so the version marker has to be part of the identity. A wrong merge here deletes
    // the Live take from the catalog outright — it is absorbed, never inserted.
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000 }])
    const res = await syncAppleTracks(db, ARTIST, [ap({ title: 'Rain (Live)', duration_ms: 200_000 })])
    expect(res).toMatchObject({ added: 1, merged: 0 })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.title).sort()).toEqual(['Rain', 'Rain (Live)'])
  })

  it('keeps every alternate take distinct in one pull', async () => {
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000 }])
    const res = await syncAppleTracks(db, ARTIST, [
      ap({ apple_id: 'ap-live', title: 'Rain (Live)', duration_ms: 200_000 }),
      ap({ apple_id: 'ap-ac', title: 'Rain (Acoustic)', duration_ms: 200_000 }),
      ap({ apple_id: 'ap-rmx', title: 'Rain (Remix)', duration_ms: 200_000 }),
      ap({ apple_id: 'ap-demo', title: 'Rain (Demo)', duration_ms: 200_000 }),
    ])
    expect(res).toMatchObject({ added: 4, merged: 0 })
    expect(rows).toHaveLength(5)
  })

  it('refuses a title-only merge when the EXISTING row has no duration', async () => {
    // With no duration on either side there is no evidence these are the same
    // recording. A duplicate is a manager's two-second cleanup; a wrong merge is
    // silent, permanent data loss.
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: null }])
    const res = await syncAppleTracks(db, ARTIST, [ap({ duration_ms: 200_000 })])
    expect(res).toMatchObject({ added: 1, merged: 0 })
    expect(rows).toHaveLength(2)
  })

  it('refuses a title-only merge when the INCOMING song has no duration', async () => {
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000 }])
    const res = await syncAppleTracks(db, ARTIST, [ap({ duration_ms: null })])
    expect(res).toMatchObject({ added: 1, merged: 0 })
    expect(rows).toHaveLength(2)
  })

  it('refuses a merge when the durations disagree', async () => {
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 100_000 }])
    const res = await syncAppleTracks(db, ARTIST, [ap({ duration_ms: 200_000 })])
    expect(res).toMatchObject({ added: 1, merged: 0 })
    expect(rows).toHaveLength(2)
  })

  it('reads candidates in a pinned order', async () => {
    // When several rows share a normalized title the merge picks among them, so an
    // unordered select hands that choice to Postgres row order: the same data can
    // stamp a different song run to run. Asserted on the QUERY because the symptom
    // is by definition not reproducible from the outside.
    const { db, orderedBy } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000 }])
    await syncAppleTracks(db, ARTIST, [ap()])
    expect(orderedBy).toEqual(['created_at', 'id'])
  })

  it('picks the CLOSEST duration when a title has several candidates', async () => {
    const { db, rows } = fakeDb([
      { spotify_id: 'sp-a', source: 'spotify', title: 'Rain', duration_ms: 200_000 },
      { spotify_id: 'sp-b', source: 'spotify', title: 'Rain', duration_ms: 202_500 },
    ])
    await syncAppleTracks(db, ARTIST, [ap({ duration_ms: 202_400 })])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.spotify_id === 'sp-b')!.apple_id).toBe('ap1')
    expect(rows.find((r) => r.spotify_id === 'sp-a')!.apple_id).toBeNull()
  })

  it('never claims one existing row twice in a single pull', async () => {
    const { db, rows } = fakeDb([{ spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000 }])
    const res = await syncAppleTracks(db, ARTIST, [
      ap({ apple_id: 'ap1', duration_ms: 200_000 }),
      ap({ apple_id: 'ap2', duration_ms: 200_100 }),
    ])
    expect(res).toMatchObject({ merged: 1, added: 1 })
    expect(rows).toHaveLength(2)
  })
})

describe('syncTracks — insert defaults', () => {
  it('lands every imported song OFF-SITE', async () => {
    // on_site is `not null default true` and the public doors coalesce to true, so this
    // explicit false is the ONLY thing standing between a raw import and the artist's
    // live site.
    const { db, writes } = fakeDb([])
    await syncSpotifyTracks(db, ARTIST, [sp()])
    const insert = writes.find((w) => w.op === 'insert')!.values
    expect(insert.on_site).toBe(false)
  })

  it('does not touch on_site when refreshing or stamping — nothing already live drops', async () => {
    const { db, writes } = fakeDb([
      { spotify_id: 'sp1', source: 'spotify', title: 'Rain', duration_ms: 200_000, on_site: true },
    ])
    await syncSpotifyTracks(db, ARTIST, [sp({ title: 'Rain v2' })])
    await syncAppleTracks(db, ARTIST, [ap({ duration_ms: 200_000 })])
    const updates = writes.filter((w) => w.op === 'update')
    expect(updates.length).toBeGreaterThan(0)
    for (const w of updates) expect(w.values).not.toHaveProperty('on_site')
  })
})
