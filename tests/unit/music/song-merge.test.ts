// Merging two songs, field by field: what unions, what wins a tie, and what refuses.
/**
 * MERGING TWO SONGS — the field-by-field resolution, exhaustively.
 *
 * Why this exists: sync.ts REFUSES a title-only cross-platform match when either side
 * lacks a duration, because the two failure modes are not symmetric — a wrong merge
 * absorbs a song permanently and silently, a refusal leaves a duplicate row. That
 * deliberate refusal is what produces the duplicates this feature resolves by hand.
 *
 * The merge itself inherits the same asymmetry, so every field below is pinned rather
 * than sampled: a wrong winner here is data loss with no undo and no trash. The three
 * classes of field are pinned separately because they follow three DIFFERENT rules, and
 * a refactor that collapses them into one would silently change two of them.
 */
import { describe, expect, it } from 'vitest'
import * as merge from '@/lib/song-merge'
import {
  MERGE_COLUMNS,
  planSongMerge,
  mergeTwins,
  CURATED_ABSOLUTE_FIELDS,
  CURATED_FILLABLE_FIELDS,
  ENRICHMENT_FIELDS,
  PLATFORM_IDENTITY,
  type MergeableSong,
} from '@/lib/song-merge'
import { CRUD, PUBLISHABLE } from '@/lib/content'
import { RELEASE_TYPES } from '@/lib/releases'

const song = (o: Partial<MergeableSong> = {}): MergeableSong => ({
  id: 'x',
  title: 'A Song',
  spotify_id: null,
  apple_id: null,
  deezer_id: null,
  apple_url: null,
  deezer_url: null,
  soundcloud_url: null,
  stream_url: null,
  provider_url: null,
  album_name: null,
  cover_url: null,
  duration_ms: null,
  release_date: null,
  on_site: false,
  released: false,
  release_type: 'single',
  release_id: null,
  audio_path: null,
  featured_artists: [],
  drive_file_id: null,
  ...o,
})

/** The plan for a merge expected to succeed — fails loudly instead of returning a union. */
function patchOf(keep: MergeableSong, drop: MergeableSong): Record<string, unknown> {
  const plan = planSongMerge(keep, drop)
  if (!plan.ok) throw new Error(`expected a mergeable pair, got conflicts: ${JSON.stringify(plan.conflicts)}`)
  return plan.patch
}

describe('platform ids and links — UNION, with A winning a tie', () => {
  // Every platform column, one at a time. A column missing here is a column whose
  // resolution is untested — which is how a link would silently fail to carry over.
  it.each(PLATFORM_IDENTITY.map((p) => [p.field, p] as const))(
    '%s: B fills it when A has none',
    (field) => {
      expect(patchOf(song(), song({ [field]: 'b-value' }))[field]).toBe('b-value')
    },
  )

  it.each(PLATFORM_IDENTITY.map((p) => [p.field, p] as const))(
    '%s: A keeps its own, and it is not rewritten',
    (field) => {
      // Identical values are not a conflict, and writing them back is pointless churn.
      expect(patchOf(song({ [field]: 'same' }), song({ [field]: 'same' }))).not.toHaveProperty(field)
    },
  )

  it('unions across DIFFERENT platforms — the whole point of the feature', () => {
    const keep = song({ spotify_id: 'sp1', stream_url: 'https://open.spotify.com/track/sp1' })
    const drop = song({ apple_id: 'ap1', apple_url: 'https://music.apple.com/x', soundcloud_url: 'https://sc/x' })
    expect(patchOf(keep, drop)).toMatchObject({
      apple_id: 'ap1',
      apple_url: 'https://music.apple.com/x',
      soundcloud_url: 'https://sc/x',
    })
  })

  it('never writes a null over a value A already has', () => {
    const patch = patchOf(song({ spotify_id: 'sp1', apple_url: 'https://music.apple.com/x' }), song())
    expect(patch).not.toHaveProperty('spotify_id')
    expect(patch).not.toHaveProperty('apple_url')
  })
})

/**
 * THE REFUSAL. Two rows carrying different handles for the SAME platform are evidence
 * of two different recordings, not one duplicated song. Merging them would union two
 * identities onto one row and delete the other — losing a real song, silently, forever.
 *
 * Deliberately strict: URLs count as identity, not just ids. A storefront-variant Apple
 * link therefore refuses a merge that a human might have allowed. That false positive
 * costs the manager one cleared field and a retry; the false NEGATIVE costs a song. The
 * same asymmetry sync.ts already reasons from.
 */
describe('conflicting platform identity — refuse, never discard', () => {
  it.each(PLATFORM_IDENTITY.map((p) => [p.field, p] as const))(
    '%s: different non-null values on both sides refuses the whole merge',
    (field, p) => {
      const plan = planSongMerge(song({ [field]: 'a-value' }), song({ [field]: 'b-value' }))
      expect(plan.ok).toBe(false)
      if (plan.ok) return
      expect(plan.conflicts).toEqual([{ field, platform: p.platform, keep: 'a-value', drop: 'b-value' }])
    },
  )

  it('reports EVERY conflicting platform, so one retry can fix them all', () => {
    const plan = planSongMerge(
      song({ spotify_id: 'sp1', apple_id: 'ap1', deezer_id: 'dz1' }),
      song({ spotify_id: 'sp2', apple_id: 'ap2', deezer_id: 'dz1' }),
    )
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.conflicts.map((c) => c.field)).toEqual(['spotify_id', 'apple_id'])
  })

  it('a conflict produces NO patch — nothing is written on a refusal', () => {
    const plan = planSongMerge(song({ spotify_id: 'sp1' }), song({ spotify_id: 'sp2', album_name: 'Would Be Kept' }))
    expect(plan).not.toHaveProperty('patch')
  })

  it('equal values are never a conflict, on any column', () => {
    const both = Object.fromEntries(PLATFORM_IDENTITY.map((p) => [p.field, 'identical']))
    expect(planSongMerge(song(both), song(both)).ok).toBe(true)
  })

  // A one-sided value is the NORMAL case the whole feature is for: the duplicate exists
  // precisely because one row has a platform the other lacks.
  it('a value on only one side is never a conflict', () => {
    for (const p of PLATFORM_IDENTITY) {
      expect(planSongMerge(song({ [p.field]: 'v' }), song()).ok).toBe(true)
      expect(planSongMerge(song(), song({ [p.field]: 'v' })).ok).toBe(true)
    }
  })
})

describe('enrichment fields — fill A only where A is empty', () => {
  it.each(ENRICHMENT_FIELDS.map((f) => [f] as const))('%s: B fills an empty A', (field) => {
    const value = field === 'duration_ms' ? 210_000 : 'b-value'
    expect(patchOf(song(), song({ [field]: value }))[field]).toBe(value)
  })

  it.each(ENRICHMENT_FIELDS.map((f) => [f] as const))('%s: a non-empty A is never overwritten', (field) => {
    const aVal = field === 'duration_ms' ? 200_000 : 'a-value'
    const bVal = field === 'duration_ms' ? 210_000 : 'b-value'
    expect(patchOf(song({ [field]: aVal }), song({ [field]: bVal }))).not.toHaveProperty(field)
  })

  // A differing duration does NOT refuse. Enrichment is a fact several platforms report
  // slightly differently (encoder padding, per-storefront masters); it is not identity.
  it('a differing duration is enrichment, not a conflict', () => {
    expect(planSongMerge(song({ duration_ms: 200_000 }), song({ duration_ms: 214_000 })).ok).toBe(true)
  })

  it('duration_ms 0 counts as a value, not as empty', () => {
    expect(patchOf(song({ duration_ms: 0 }), song({ duration_ms: 210_000 }))).not.toHaveProperty('duration_ms')
  })
})

describe('curated fields — A is the row the manager chose to keep', () => {
  it.each(CURATED_FILLABLE_FIELDS.map((f) => [f] as const))('%s: A wins when A has a value', (field) => {
    expect(patchOf(song({ [field]: 'a-value' }), song({ [field]: 'b-value' }))).not.toHaveProperty(field)
  })

  it.each(CURATED_FILLABLE_FIELDS.map((f) => [f] as const))('%s: B fills a null A', (field) => {
    expect(patchOf(song({ [field]: null }), song({ [field]: 'b-value' }))[field]).toBe('b-value')
  })

  it('an empty-string title is empty, so B names the merged song', () => {
    expect(patchOf(song({ title: '' }), song({ title: 'Real Title' })).title).toBe('Real Title')
  })

  // on_site / released are booleans, and `false` is a DECISION, not an absence. OR-ing
  // them would publish a song the manager took off the site, or mark a demo released,
  // as a side effect of tidying a duplicate. A's setting stands; the manager can flip it.
  it.each(CURATED_ABSOLUTE_FIELDS.map((f) => [f] as const))(
    '%s: A wins even when A is false and B is true',
    (field) => {
      expect(patchOf(song({ [field]: false }), song({ [field]: true }))).not.toHaveProperty(field)
    },
  )

  it('release membership follows A, so the merged song does not jump projects', () => {
    const patch = patchOf(song({ release_id: 'relA' }), song({ release_id: 'relB' }))
    expect(patch).not.toHaveProperty('release_id')
  })
})

/**
 * COLLABORATORS live on the SONG and are hand-edited (Sam, 2026-09-11: the Featuring row;
 * a Spotify pull only seeds an EMPTY list, so "a hand edit survives"). Two rows of one
 * song each carry credits someone chose to type or keep. The merge used to not read the
 * column at all, so the duplicate's credits were deleted with its row (reviewer,
 * 2026-09-28). The merged song carries every name either row had, A's first.
 */
describe('collaborators — the merged song keeps EVERY credit', () => {
  const feat = (keep: string[] | null, drop: string[] | null) =>
    patchOf(song({ featured_artists: keep }), song({ featured_artists: drop }))

  it("CRITICAL: B's collaborators join A's, A's first", () => {
    expect(feat(['Arlo'], ['Bo Reed', 'Cy'])).toMatchObject({ featured_artists: ['Arlo', 'Bo Reed', 'Cy'] })
  })

  it('CRITICAL: an empty A takes all of B', () => {
    expect(feat([], ['Bo Reed'])).toMatchObject({ featured_artists: ['Bo Reed'] })
  })

  it('a name on both rows is kept once, in A\'s spelling (trim, any case)', () => {
    expect(feat(['Arlo', 'Bo Reed'], [' arlo ', 'BO REED', 'Cy'])).toMatchObject({ featured_artists: ['Arlo', 'Bo Reed', 'Cy'] })
  })

  it('nothing new on B writes nothing', () => {
    expect(feat(['Arlo'], ['arlo'])).not.toHaveProperty('featured_artists')
    expect(feat(['Arlo'], [])).not.toHaveProperty('featured_artists')
  })

  it("a repeat inside A's own list does not hide a new name from B", () => {
    expect(feat(['Arlo', 'arlo'], ['Cy'])).toMatchObject({ featured_artists: ['Arlo', 'Cy'] })
  })

  it('a null list on either side reads as none', () => {
    expect(feat(null, ['Bo Reed'])).toMatchObject({ featured_artists: ['Bo Reed'] })
    expect(feat(['Arlo'], null)).not.toHaveProperty('featured_artists')
  })
})

/**
 * THE TYPE TAG. A platform sync only ever stamps single / EP / album (sync-match's
 * classifyRelease). Remix, Live set and Featured are only ever set BY HAND (Sam,
 * 2026-08-21 / 09-10). The merge treated release_type like a title — A wins whenever it
 * has one — and A always has one (the column defaults to 'single'), so tidying a duplicate
 * silently turned a hand-tagged Remix or Live set back into a Single (reviewer, 2026-09-28).
 */
describe('the type tag — a hand-set tag survives the merge', () => {
  const hand: readonly string[] = merge.HAND_SET_TYPES ?? []
  const stamped = RELEASE_TYPES.filter((t) => !hand.includes(t))

  it('CRITICAL: the reported case — B tagged Remix / Live set by hand, A at the default Single', () => {
    expect(patchOf(song({ release_type: 'single' }), song({ release_type: 'remix' }))).toMatchObject({ release_type: 'remix' })
    expect(patchOf(song({ release_type: 'single' }), song({ release_type: 'live' }))).toMatchObject({ release_type: 'live' })
  })

  it('remix and live set are hand-set; single, EP and album are what a sync stamps', () => {
    expect(hand).toEqual(expect.arrayContaining(['remix', 'live']))
    expect(stamped).toEqual(['single', 'ep', 'album'])
  })

  it.each(hand.flatMap((h) => stamped.map((st) => [h, st] as const)))(
    "CRITICAL: B's hand-set %s beats A's %s",
    (h, st) => {
      expect(patchOf(song({ release_type: st }), song({ release_type: h }))).toMatchObject({ release_type: h })
    },
  )

  it.each(hand.map((h) => [h] as const))("CRITICAL: A's hand-set %s is kept, whatever B says", (h) => {
    for (const other of RELEASE_TYPES) {
      expect(patchOf(song({ release_type: h }), song({ release_type: other }))).not.toHaveProperty('release_type')
    }
  })

  it('two stamped types: A stands (no write)', () => {
    expect(patchOf(song({ release_type: 'single' }), song({ release_type: 'album' }))).not.toHaveProperty('release_type')
  })

  it('an empty A takes B', () => {
    expect(patchOf(song({ release_type: null }), song({ release_type: 'ep' }))).toMatchObject({ release_type: 'ep' })
  })
})

/** Which songs "Merge" offers: likely DUPLICATES only (the song modal and a release's
 *  tracklist both use this). */
describe('mergeTwins — what Merge offers', () => {
  const me = { id: 'me', title: 'Night Drive', release_id: 'r1' }
  const ids = (targets: { id: string; title: string; release_id?: string | null }[]) => mergeTwins(me, targets).map((t) => t.id)

  it('CRITICAL: only songs whose title normalises to this one\'s', () => {
    expect(ids([{ id: 'a', title: 'Night Drive (feat. Kay)' }, { id: 'b', title: 'Day Drive' }])).toEqual(['a'])
  })

  it('CRITICAL: never itself', () => {
    expect(ids([{ id: 'me', title: 'Night Drive', release_id: 'r1' }])).toEqual([])
  })

  it('the same title on ANOTHER release is the intended twin row, not a duplicate', () => {
    expect(ids([{ id: 'a', title: 'Night Drive', release_id: 'r2' }])).toEqual([])
  })

  it('the same title on the SAME release, or with no release on either side, is a duplicate', () => {
    expect(ids([{ id: 'a', title: 'Night Drive', release_id: 'r1' }, { id: 'b', title: 'night drive', release_id: null }])).toEqual(['a', 'b'])
    expect(mergeTwins({ ...me, release_id: null }, [{ id: 'c', title: 'Night Drive', release_id: 'r9' }]).map((t) => t.id)).toEqual(['c'])
  })
})

/**
 * B's uploaded master. The audio bucket is paid storage and B's row is about to be
 * deleted, so whichever object the merged row does NOT adopt has to be reported to the
 * caller or it sits in the bucket referenced by nothing, forever.
 */
/**
 * THE DRIVE FILE a song was imported from (`drive_file_id`) badges that file "imported" in
 * the Drive browser. A merge used to leave it on the duplicate, so it died with the row
 * and the file read as never imported — free to import a third copy. It is filled like a
 * curated field (A's stands; B's fills an empty A), but B HOLDS it under a unique index
 * (artist_id, drive_file_id) until B is deleted, so the plan hands it over AFTER the
 * delete (`afterDelete`), never in the first write — which the index would refuse.
 */
describe("the Drive file id — handed over after the duplicate is gone", () => {
  const plan = (keep: string | null, drop: string | null) => {
    const p = planSongMerge(song({ drive_file_id: keep }), song({ drive_file_id: drop }))
    if (!p.ok) throw new Error('expected a mergeable pair')
    return p
  }

  it("CRITICAL: B's Drive id moves to A, after the delete — not in the first write", () => {
    const p = plan(null, 'drive-b')
    expect(p.afterDelete).toEqual({ drive_file_id: 'drive-b' })
    expect(p.patch).not.toHaveProperty('drive_file_id')
  })

  it("A's own Drive id stands when both have one", () => {
    expect(plan('drive-a', 'drive-b').afterDelete).toEqual({})
  })

  it('nothing to hand over when B has none', () => {
    expect(plan('drive-a', null).afterDelete).toEqual({})
    expect(plan(null, null).afterDelete).toEqual({})
  })

  it('is read by the merge (a column missing from the SELECT reads as null)', () => {
    expect(MERGE_COLUMNS.split(', ')).toContain('drive_file_id')
    expect(Object.keys(merge.NOT_MERGED)).not.toContain('drive_file_id')
  })
})

describe('audio — one master survives, the other is reported for collection', () => {
  it('A keeps its own audio and B’s object is flagged as orphaned', () => {
    const plan = planSongMerge(song({ audio_path: 'a1/audio/keep.mp3' }), song({ audio_path: 'a1/audio/drop.mp3' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.patch).not.toHaveProperty('audio_path')
    expect(plan.orphanedAudioPath).toBe('a1/audio/drop.mp3')
  })

  it('A adopts B’s audio when it has none — nothing is orphaned', () => {
    const plan = planSongMerge(song(), song({ audio_path: 'a1/audio/drop.mp3' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.patch.audio_path).toBe('a1/audio/drop.mp3')
    expect(plan.orphanedAudioPath).toBeNull()
  })

  it('B having no audio orphans nothing', () => {
    const plan = planSongMerge(song({ audio_path: 'a1/audio/keep.mp3' }), song())
    expect(plan.ok && plan.orphanedAudioPath).toBeNull()
  })

  // Both rows pointing at ONE object: deleting it because "B's copy loses" would delete
  // the file the surviving song plays.
  it('never orphans an object the surviving row still points at', () => {
    const shared = 'a1/audio/shared.mp3'
    const plan = planSongMerge(song({ audio_path: shared }), song({ audio_path: shared }))
    expect(plan.ok && plan.orphanedAudioPath).toBeNull()
  })
})

describe('the plan as a whole', () => {
  it('a full cross-platform duplicate merges into one complete row', () => {
    const keep = song({
      title: 'Dust & Diesel',
      spotify_id: 'sp1',
      stream_url: 'https://open.spotify.com/track/sp1',
      on_site: true,
      release_id: 'rel1',
      duration_ms: 201_000,
    })
    const drop = song({
      title: 'Dust and Diesel',
      apple_id: 'ap1',
      apple_url: 'https://music.apple.com/x',
      deezer_id: 'dz1',
      album_name: 'Backroads',
      cover_url: 'https://img/cover.jpg',
      release_date: '2025-04-01',
      duration_ms: 202_000,
      audio_path: 'a1/audio/drop.mp3',
      on_site: false,
    })
    const plan = planSongMerge(keep, drop)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.patch).toEqual({
      apple_id: 'ap1',
      apple_url: 'https://music.apple.com/x',
      deezer_id: 'dz1',
      album_name: 'Backroads',
      cover_url: 'https://img/cover.jpg',
      release_date: '2025-04-01',
      audio_path: 'a1/audio/drop.mp3',
    })
    expect(plan.orphanedAudioPath).toBeNull()
  })

  it('two identical rows produce an empty patch — a no-op merge still deletes the duplicate', () => {
    const plan = planSongMerge(song({ spotify_id: 'sp1' }), song({ spotify_id: 'sp1' }))
    expect(plan.ok && plan.patch).toEqual({})
  })

  // The field lists must not overlap: a field appearing in two of them would be
  // resolved twice, and the later rule would silently win. Nor may a column be both
  // merged and "deliberately left alone".
  it('every field belongs to exactly one resolution rule', () => {
    const merged = MERGE_COLUMNS.split(', ')
    expect(new Set(merged).size).toBe(merged.length)
    const left = Object.keys(merge.NOT_MERGED ?? {})
    expect(left.filter((c) => merged.includes(c))).toEqual([])
  })

  /**
   * ...and TOTAL, derived from the REGISTRY, never from a hand list. The old version of
   * this test compared MERGE_COLUMNS with a hand-written Record of MergeableSong's keys —
   * both written by the same hand, so `featured_artists` was missing from BOTH and the
   * merge deleted every collaborator on the duplicate while this stayed green (reviewer,
   * 2026-09-28).
   *
   * Every track column the app reads or writes (content.ts: the publish snapshot and the
   * manager-editable fields) must be either resolved by a merge rule or listed in
   * NOT_MERGED with its reason. A new column joins those registries to reach the site or
   * the editor, and this fails until someone decides what a merge does with it. The same
   * check against the LIVE table's columns is in tests/integration/music/song-merge.db.test.ts.
   */
  it('CRITICAL: every track column in the content registry is merged or deliberately left', () => {
    const known = new Set([...PUBLISHABLE.track.snapshot, ...CRUD.track.fields])
    const handled = new Set([...MERGE_COLUMNS.split(', '), ...Object.keys(merge.NOT_MERGED ?? {})])
    expect([...known].filter((c) => !handled.has(c))).toEqual([])
  })
})
