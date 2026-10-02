/**
 * The profile photo joins the change nudge (PROFILE_TOOL_PLAN.md, Sam 2026-10-02): a Publish that
 * changes it may leave every outside bio out of date, like a new bio or city.
 *
 * Code:     src/lib/manager-tools/seo/profiles/bio-state.ts (photoChanges, mergeChanges, bioRows)
 * Feature:  SEO tool · Profiles tab · Outside bios, the Profile page's nudge line, the AI test's
 *           "to check" line
 * Tier:     STRICT (AGENTS.md "Test depth"): it decides what the artist is told to go and redo.
 * Covers:   • the photo is the `media` row with purpose profile_photo, read from its PUBLISHED
 *             revisions. A pick is vacate-then-insert (lib/profile-photo.ts), so a re-pick is a
 *             NEW row: the same file under a new id, published as one moment with the old row's
 *             tombstone. That must not count. Nor must a republish of the same row.
 *           • a first photo, a different photo and a removed photo each count
 *           • a capped read never guesses its oldest moment
 *           • a photo change in the same Publish as a bio change is ONE change naming both, and a
 *             row names the photo among what changed
 * Not here: the facts themselves (bio-state.test.ts); the read (bios-load.ts).
 * Fixtures: Skeen has no profile photo revisions (hosted, read 2026-10-02), so the rows are
 *           built in the shape bios-load.ts reads them: entity id, published_at, the file path
 *           (`data->>storage_path`), null for a tombstone.
 */
import { describe, expect, it } from 'vitest'
import {
  FACT_WORDS,
  bioRows,
  changedWords,
  factChanges,
  mergeChanges,
  photoChanges,
  type BiosInput,
  type PhotoRevision,
  type ProfileRevision,
} from '@/lib/manager-tools/seo/profiles/bio-state'

const A = 'c6c2ea6e/gallery/cd13861d-0819-406b-abc1-0dd28a5d7b3e.jpg'
const B = 'c6c2ea6e/gallery/73e6b920-9e83-413d-b646-44f766eedead.jpg'
const T1 = '2026-09-01T12:00:00.000000+00:00'
const T2 = '2026-09-10T12:00:00.000000+00:00'
const T3 = '2026-09-20T12:00:00.000000+00:00'

const put = (entity_id: string, published_at: string, path: string): PhotoRevision => ({ entity_id, published_at, path })
const gone = (entity_id: string, published_at: string): PhotoRevision => ({ entity_id, published_at, path: null })
const photo = (at: string) => ({ at, fields: ['photo'], first: false })

describe('photoChanges', () => {
  // None → a photo: the outside bios don't have it yet.
  it('the first photo published counts', () => {
    expect(photoChanges([put('p1', T1, A)])).toEqual([photo(T1)])
  })

  // The case the plan names: picking the SAME image again is a new row (vacate-then-insert).
  it('CRITICAL: re-picking the same image (old row tombstoned, new row, same file, one Publish) does not count', () => {
    const rows = [put('p1', T1, A), gone('p1', T2), put('p2', T2, A)]
    expect(photoChanges(rows)).toEqual([photo(T1)])
  })

  // A row whose other columns changed (sort order, alt) republishes with the same file.
  it('a republish of the same row with the same file does not count', () => {
    expect(photoChanges([put('p1', T1, A), put('p1', T2, A), put('p1', T3, A)])).toEqual([photo(T1)])
  })

  // A new photo is what the outside profiles miss, whichever way the row changed.
  it('CRITICAL: a different image counts, as a pick (new row) or as a changed row', () => {
    expect(photoChanges([put('p1', T1, A), gone('p1', T2), put('p2', T2, B)])).toEqual([photo(T2), photo(T1)])
    expect(photoChanges([put('p1', T1, A), put('p1', T2, B)])).toEqual([photo(T2), photo(T1)])
  })

  // Taking the photo off is a change too: the bios may still show it.
  it('a removed photo counts, and so does putting the same one back later', () => {
    expect(photoChanges([put('p1', T1, A), gone('p1', T2), put('p2', T3, A)])).toEqual([photo(T3), photo(T2), photo(T1)])
  })

  // Rows arrive in any order; moments are compared oldest to newest.
  it('reads the rows in time order, whatever order they arrive in', () => {
    const rows = [put('p2', T2, A), put('p1', T1, A), gone('p1', T2)]
    expect(photoChanges(rows)).toEqual([photo(T1)])
  })

  // The read is capped: its oldest moment has an unknown photo before it, so it is no change.
  it('a capped window never counts its oldest moment', () => {
    expect(photoChanges([put('p1', T1, A)], { complete: false })).toEqual([])
    expect(photoChanges([put('p1', T1, A), put('p2', T2, B), gone('p1', T2)], { complete: false })).toEqual([photo(T2)])
  })

  // Nothing to read is no change; a row that can't be placed in time is left out, not guessed.
  it('no rows, no changes; a row with no date or no id is skipped', () => {
    expect(photoChanges([])).toEqual([])
    expect(photoChanges([{ entity_id: 'p1', published_at: 'not a date', path: A }, { entity_id: '', published_at: T1, path: A }])).toEqual([])
  })
})

describe('mergeChanges and the rows', () => {
  const facts = (bio: string) => ({ name: 'Skeen', bio, genre: 'House', location: 'Chicago' })
  const profiles: ProfileRevision[] = [
    { published_at: T2, data: facts('Bio two.') },
    { published_at: T1, data: facts('Bio one.') },
  ]

  // One Publish shipped the bio AND the photo: one change, both named, the first-ness kept.
  it('CRITICAL: a photo change in the same Publish as a bio change is one change naming both', () => {
    const merged = mergeChanges(factChanges(profiles), photoChanges([put('p1', T1, A), gone('p1', T2), put('p2', T2, B)]))
    expect(merged).toEqual([
      { at: T2, fields: ['bio', 'photo'], first: false },
      { at: T1, fields: ['name', 'bio', 'location', 'genre', 'photo'], first: true },
    ])
    expect(changedWords(merged[0].fields)).toBe('bio and photo')
  })

  // A photo change on its own Publish slots in by time, newest first.
  it('a photo change on its own Publish slots in by time', () => {
    const merged = mergeChanges(factChanges(profiles), photoChanges([put('p1', T3, A)]))
    expect(merged.map((c) => [c.at, c.fields])).toEqual([
      [T3, ['photo']],
      [T2, ['bio']],
      [T1, ['name', 'bio', 'location', 'genre']],
    ])
  })

  // The nudge itself: ticked after the bio change, then the photo changed. Out of date since the
  // photo, naming only the photo.
  it('CRITICAL: a bio ticked before a new photo is out of date, naming the photo', () => {
    const changes = mergeChanges(factChanges(profiles), photoChanges([put('p1', T3, A)]))
    const input: BiosInput = {
      bios: [{ key: 'spotify', label: 'Spotify', edit: 'https://artists.spotify.com', def: {} as never, url: null }],
      marks: { bio_spotify: '2026-09-15T00:00:00.000Z' },
      factsKnown: true,
      changes,
    }
    expect(bioRows(input, Date.parse('2026-10-01T00:00:00.000Z'))![0]).toMatchObject({ state: 'stale', since: T3, changed: ['photo'] })
  })

  // "Photo · Sep 29" on the row: its own word, shared with no other fact.
  it('the photo has its own word', () => {
    expect(FACT_WORDS.photo).toBe('photo')
    expect(new Set(Object.values(FACT_WORDS)).size).toBe(Object.keys(FACT_WORDS).length)
  })
})
