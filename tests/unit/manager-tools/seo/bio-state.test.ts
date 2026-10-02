/**
 * The change nudge decides what the artist is told about each outside bio: not confirmed, may
 * be out of date since a date, check it's still current, or updated.
 *
 * Code:     src/lib/manager-tools/seo/profiles/bio-state.ts
 * Feature:  SEO tool · Profiles tab · Outside bios (OUTSIDE_PROFILES_PLAN.md, build step 1, "the
 *           change nudge"), and the AI test's one "to check" line
 * Tier:     STRICT (AGENTS.md "Test depth"): it decides what the artist is told to go and redo.
 * Covers:   • factChanges: every Publish whose facts differ from the one before, newest first;
 *             which facts; the first Publish counts; identical republishes and non-fact changes
 *             (template, press kit, JSON-LD type, the hero banner) never count; a fact one of two
 *             snapshots doesn't carry (it joined the snapshot later) is not compared, even when
 *             it arrives with a value; a capped read never guesses its oldest
 *           • bioState: each of the four states; the 6-month edge; a change after the tick
 *             wins over the 6 months
 *           • connectedBios: only bios whose platform is connected, from OUTSIDE_BIOS (never
 *             hand-listed), by link or by source id; contact and role-bound rows don't count
 *           • bioRows: each row reads only the changes after ITS tick: since the oldest of them,
 *             naming every fact they changed
 *           • bioRows / biosToCheck: a read that failed says "couldn't check" and is not counted
 *           • bioReads: the AI test's own read of a bio Tapir can check (YouTube's `youtube`): a
 *             pass or a fail is the row's read, anything else leaves the row to its manual state
 *           • dayLabel: the year only when it is not this year
 * Not here: the rows on screen (tests/components/manager-tools/seo/bio-rows.test.tsx); the tick
 *           itself (profile-marks.test.ts).
 * Fixtures: SKEEN_HISTORY is Skeen's real profile history (the hosted `revisions` rows, entity
 *           'artist', read 2026-10-01): its timestamps, which keys each snapshot carries (genre
 *           and location joined the snapshot 2026-08-26, so Aug 28 is their first Publish, not
 *           a change) and when each fact changed; the bio text is shortened. SKEEN_LINKS are Skeen's real `links` rows (label, url, role).
 */
import { describe, expect, it } from 'vitest'
import { OUTSIDE_BIOS, bioItem } from '@/lib/manager-tools/seo/profiles/bios'
import {
  BIO_FACTS,
  FACT_WORDS,
  RECHECK_AFTER_DAYS,
  RECHECK_AFTER_MS,
  bioConnection,
  bioReads,
  bioRows,
  bioState,
  biosToCheck,
  changedWords,
  connectedBios,
  dayLabel,
  factChanges,
  type BiosInput,
  type ProfileRevision,
} from '@/lib/manager-tools/seo/profiles/bio-state'
import { CONNECTIONS } from '@/lib/connections'

/* ── Skeen's real profile history, newest first ─────────────────────────────────────── */

const HERO = 'https://picsum.photos/seed/skeen-hero/1600/600'
const BIO = { v1: 'Skeen is a Chicago-born DJ, producer, and…', v2: 'My name’s Skeen. A Chicago DJ, producer,…', v3: 'My name is Skeen, a Chicago DJ, producer…', v4: 'My name is Skeen\n\nI am a Chicago DJ, pro…', v5: 'My name is Skeen\n\nI am a Chicago DJ, producer…' }
/** The keys the snapshot carried as columns joined it. */
const early = (bio: string, hero: string | null) => ({ bio, name: 'Skeen', template: 'cinematic', hero_image_url: hero, spotify_artist_id: '26KxuQlgIw8VP8YX2IkMWR' })
const press = (bio: string) => ({ ...early(bio, null), press_pitch: null, press_quotes: [] })
const docs = (bio: string) => ({ ...press(bio), stage_plot_path: null, tech_rider_path: null })
const facts = (bio: string) => ({ ...docs(bio), genre: 'House, Tech House', location: 'Chicago', schema_type: 'MusicGroup' })

const SKEEN_HISTORY: ProfileRevision[] = [
  { published_at: '2026-09-29T02:38:24.152066+00:00', data: facts(BIO.v5) },
  { published_at: '2026-09-28T15:34:01.458713+00:00', data: facts(BIO.v5) },
  { published_at: '2026-09-09T18:34:14.863126+00:00', data: facts(BIO.v5) },
  { published_at: '2026-08-28T17:15:41.909228+00:00', data: facts(BIO.v5) }, // genre + city JOIN the snapshot
  { published_at: '2026-08-22T00:22:53.661278+00:00', data: docs(BIO.v5) },
  { published_at: '2026-08-19T16:28:13.392434+00:00', data: docs(BIO.v5) },
  { published_at: '2026-08-06T17:24:22.140293+00:00', data: docs(BIO.v5) },
  { published_at: '2026-08-04T18:07:56.839893+00:00', data: docs(BIO.v5) },
  { published_at: '2026-08-04T14:41:46.053783+00:00', data: press(BIO.v5) },
  { published_at: '2026-07-29T14:43:45.742933+00:00', data: early(BIO.v5, null) }, // photo cleared
  { published_at: '2026-07-16T17:29:17.449282+00:00', data: early(BIO.v5, HERO) }, // bio
  { published_at: '2026-07-16T16:14:45.165854+00:00', data: early(BIO.v4, HERO) }, // bio
  { published_at: '2026-07-16T16:13:35.12744+00:00', data: early(BIO.v3, HERO) }, // bio
  { published_at: '2026-07-16T16:11:31.086449+00:00', data: early(BIO.v2, HERO) }, // bio
  { published_at: '2026-07-14T23:30:37.451623+00:00', data: early(BIO.v1, HERO) }, // first
]
const SKEEN_CHANGED = '2026-07-16T17:29:17.449282+00:00'

/** Skeen's fact changes, newest first. The Jul 29 Publish cleared the hero banner only: not a
 *  fact. Aug 28 is the first snapshot to CARRY genre and city: not a change either. */
const SKEEN_CHANGES = [
  { at: SKEEN_CHANGED, fields: ['bio'], first: false },
  { at: '2026-07-16T16:14:45.165854+00:00', fields: ['bio'], first: false },
  { at: '2026-07-16T16:13:35.12744+00:00', fields: ['bio'], first: false },
  { at: '2026-07-16T16:11:31.086449+00:00', fields: ['bio'], first: false },
  { at: '2026-07-14T23:30:37.451623+00:00', fields: ['name', 'bio'], first: true },
]

/** A newer Publish on top of Skeen's history. */
const republish = (at: string, data: Record<string, unknown>): ProfileRevision[] => [{ published_at: at, data }, ...SKEEN_HISTORY]

describe('factChanges', () => {
  // Skeen's real history: four bio rewrites on Jul 16. Genre and city joining the snapshot on
  // Aug 28 is not a change: the snapshots before it never said what they were.
  it('Skeen: every fact change, newest first, with what each changed', () => {
    expect(factChanges(SKEEN_HISTORY)).toEqual(SKEEN_CHANGES)
  })

  // The point of the nudge: a Publish that repeats the facts (an editor restyle, a press-kit
  // edit, a template switch, a new hero banner) must never count as a change.
  it('CRITICAL: a republish with the same facts, or only non-fact changes, adds nothing', () => {
    const same = facts(BIO.v5)
    expect(factChanges(republish('2026-10-01T09:00:00.000Z', same))).toEqual(SKEEN_CHANGES)
    const restyled = { ...same, template: 'minimal', press_pitch: 'A new pitch.', press_quotes: [{ quote: 'Big.' }], schema_type: 'Person', spotify_artist_id: 'other', hero_image_url: HERO }
    expect(factChanges(republish('2026-10-01T09:00:00.000Z', restyled))).toEqual(SKEEN_CHANGES)
  })

  // A history of restyles and press-kit edits after the first Publish: a tick after it stays current.
  it('CRITICAL: a restyle-only history never nudges: ticked after the first Publish, still current', () => {
    const first = '2026-07-01T10:00:00.000Z'
    const restyles: ProfileRevision[] = [
      { published_at: '2026-09-30T10:00:00.000Z', data: { ...facts(BIO.v5), template: 'minimal' } },
      { published_at: '2026-09-01T10:00:00.000Z', data: { ...facts(BIO.v5), press_pitch: 'New pitch.' } },
      { published_at: '2026-08-01T10:00:00.000Z', data: facts(BIO.v5) },
      { published_at: first, data: facts(BIO.v5) },
    ]
    const changes = factChanges(restyles)
    expect(changes).toEqual([{ at: first, fields: ['name', 'bio', 'location', 'genre'], first: true }])
    expect(bioState({ confirmedAt: '2026-07-02T10:00:00.000Z', factsChangedAt: changes[0].at, now: Date.parse('2026-10-01T10:00:00.000Z') })).toBe('current')
  })

  // Every fact, on its own, is a change (derived from BIO_FACTS, so a fact added later is
  // covered the day it is).
  it.each(BIO_FACTS)('a change to %s alone counts, and names only it', (fact) => {
    const history: ProfileRevision[] = [
      { published_at: '2026-10-01T09:00:00.000Z', data: { ...facts(BIO.v5), [fact]: `new ${fact}` } },
      { published_at: '2026-09-30T09:00:00.000Z', data: facts(BIO.v5) },
    ]
    expect(factChanges(history)[0]).toEqual({ at: '2026-10-01T09:00:00.000Z', fields: [fact], first: false })
  })

  // Two facts in one Publish are both named, in words.
  it('names every fact that changed in one Publish: bio and city', () => {
    const [change] = factChanges(republish('2026-10-01T09:00:00.000Z', { ...facts('A new bio.'), location: 'Detroit' }))
    expect(change.fields).toEqual(['bio', 'location'])
    expect(changedWords(change.fields)).toBe('bio and city')
  })

  // The first Publish is when the facts first went out: it counts, naming what it set.
  it('the first-ever Publish counts as a change, naming the facts it set', () => {
    expect(factChanges(SKEEN_HISTORY.slice(-1))).toEqual([{ at: '2026-07-14T23:30:37.451623+00:00', fields: ['name', 'bio'], first: true }])
  })

  // CRITICAL: a fact that JOINS the snapshot (a new BIO_FACTS column) is ABSENT from every older
  // revision. Its first Publish arrives with a value, and reading "absent" as "empty" would date a
  // change there and mark every ticked bio out of date. Compared only once both sides carry it;
  // null, '' and spaces are all "nothing", and text compares trimmed.
  it('CRITICAL: a fact joining the snapshot with a value is not a change; once carried, it is compared', () => {
    const history: ProfileRevision[] = [
      { published_at: '2026-12-01T09:00:00.000Z', data: early(BIO.v5, null) }, // genre + city leave: not a change
      { published_at: '2026-11-01T09:00:00.000Z', data: { ...early(BIO.v5, null), genre: 'Techno', location: '  ' } }, // genre changed
      { published_at: '2026-10-01T09:00:00.000Z', data: { ...early(` ${BIO.v5}\n`, ''), genre: 'House', location: null } }, // both JOIN
      { published_at: '2026-09-01T09:00:00.000Z', data: early(BIO.v5, null) },
      { published_at: '2026-08-01T09:00:00.000Z', data: early(BIO.v1, null) },
    ]
    expect(factChanges(history).map((c) => [c.at, c.fields])).toEqual([
      ['2026-11-01T09:00:00.000Z', ['genre']],
      ['2026-09-01T09:00:00.000Z', ['bio']],
      ['2026-08-01T09:00:00.000Z', ['name', 'bio']],
    ])
    // So a bio ticked before the new fact joined stays current.
    const changes = factChanges(history.slice(2))
    expect(bioState({ confirmedAt: '2026-09-15T09:00:00.000Z', factsChangedAt: changes[0]?.at ?? null, now: Date.parse('2026-10-02T09:00:00.000Z') })).toBe('current')
  })

  // Rows in any order give the same answer.
  it('reads newest first whatever order the rows arrive in', () => {
    expect(factChanges([...SKEEN_HISTORY].reverse())).toEqual(SKEEN_CHANGES)
  })

  // The loader reads a capped window. Its oldest row has an unknown Publish before it, so it is
  // NOT the first Publish and must not be dated as a change; changes inside it are still found.
  it('a capped read never takes its oldest row for the first Publish', () => {
    const window = SKEEN_HISTORY.slice(0, 3) // three identical republishes
    expect(factChanges(window, { complete: false })).toEqual([])
    expect(factChanges(window)).toEqual([{ at: '2026-09-09T18:34:14.863126+00:00', fields: ['name', 'bio', 'location', 'genre'], first: true }])
    expect(factChanges(SKEEN_HISTORY.slice(0, 12), { complete: false })).toEqual([SKEEN_CHANGES[0]])
  })

  // No Publish yet: no change. A row with no snapshot or a bad date is skipped, not trusted.
  it('never published: nothing; a row with no snapshot or no date is skipped', () => {
    expect(factChanges([])).toEqual([])
    const history = [{ published_at: '2026-10-01T09:00:00.000Z', data: null }, { published_at: 'not a date', data: facts('X') }, ...SKEEN_HISTORY]
    expect(factChanges(history)).toEqual(SKEEN_CHANGES)
  })
})

describe('bioState', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z')
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()
  const DAY = 24 * 60 * 60 * 1000

  // No tick yet: not confirmed, even when the facts changed.
  it('never ticked: not confirmed, whatever changed', () => {
    expect(bioState({ confirmedAt: null, factsChangedAt: SKEEN_CHANGED, now })).toBe('unconfirmed')
    expect(bioState({ confirmedAt: null, factsChangedAt: null, now })).toBe('unconfirmed')
  })

  // The nudge itself: a change after the tick is out of date; a tick after the change is current.
  it('CRITICAL: facts changed after the tick: may be out of date; before it: updated', () => {
    expect(bioState({ confirmedAt: at(10 * DAY), factsChangedAt: at(2 * DAY), now })).toBe('stale')
    expect(bioState({ confirmedAt: at(2 * DAY), factsChangedAt: at(10 * DAY), now })).toBe('current')
    expect(bioState({ confirmedAt: at(2 * DAY), factsChangedAt: null, now })).toBe('current')
  })

  // "Changes + 6 months" (decided 2026-10-01): the edge is inclusive of exactly RECHECK_AFTER_DAYS.
  it('CRITICAL: the 6-month edge: exactly RECHECK_AFTER_DAYS is still current, a moment more asks again', () => {
    expect(RECHECK_AFTER_DAYS).toBeGreaterThanOrEqual(180) // "6 months" (decided 2026-10-01)
    expect(RECHECK_AFTER_DAYS).toBeLessThanOrEqual(186)
    expect(RECHECK_AFTER_MS).toBe(RECHECK_AFTER_DAYS * DAY)
    expect(bioState({ confirmedAt: at(RECHECK_AFTER_MS), factsChangedAt: null, now })).toBe('current')
    expect(bioState({ confirmedAt: at(RECHECK_AFTER_MS + 1), factsChangedAt: null, now })).toBe('recheck')
    expect(bioState({ confirmedAt: at(RECHECK_AFTER_MS + 1), factsChangedAt: null, now: new Date(now) })).toBe('recheck')
  })

  // Both apply: the change wins, because it has a date to say.
  it('a change after an old tick says out of date (it has the date), not just "check"', () => {
    expect(bioState({ confirmedAt: at(300 * DAY), factsChangedAt: at(5 * DAY), now })).toBe('stale')
  })

  // Ticking again after a change clears the nudge.
  it('re-confirming moves the tick past the change: updated again', () => {
    const changed = at(5 * DAY)
    expect(bioState({ confirmedAt: at(9 * DAY), factsChangedAt: changed, now })).toBe('stale')
    expect(bioState({ confirmedAt: at(0), factsChangedAt: changed, now })).toBe('current')
  })
})

describe('changedWords', () => {
  // The words for what changed: "bio", "city and genre", "name, bio and genre".
  it('reads like a person: one, two, then a list', () => {
    expect(changedWords(['bio'])).toBe('bio')
    expect(changedWords(['location', 'genre'])).toBe('city and genre')
    expect(changedWords(['name', 'bio', 'genre'])).toBe('name, bio and genre')
    expect(changedWords([])).toBe('')
  })

  // No two facts share a word (derived from BIO_FACTS).
  it('every fact has its own word', () => {
    expect(new Set(BIO_FACTS.map((f) => FACT_WORDS[f])).size).toBe(BIO_FACTS.length)
  })
})

/* ── which bios ───────────────────────────────────────────────────────────────────────── */

/** Skeen's real links rows (2026-10-01), including the three that are not profiles. */
const SKEEN_LINKS = [
  { id: 'l1', label: 'Bookings', url: 'mailto:bookings@skeen.example', role: null },
  { id: 'l2', label: 'USB button', url: 'https://open.spotify.com/playlist/0MLdp3LsWM0uO2oryTniXi?si=w980RNcdQUenHYKQSbDacw', role: 'usb' },
  { id: 'l3', label: 'Booking email', url: 'ross.guignon@everesttm.com', role: 'booking' },
  { id: 'l4', label: 'TikTok', url: 'https://tiktok.com/@skeen200', role: null },
  { id: 'l5', label: 'Apple Music', url: 'https://music.apple.com/no/artist/skeen/1754431714', role: null },
  { id: 'l6', label: 'Instagram', url: 'https://www.instagram.com/skeeeeeeen/', role: null },
  { id: 'l7', label: 'YouTube', url: 'https://www.youtube.com/@Sskeen', role: null },
  { id: 'l8', label: 'SoundCloud', url: 'https://soundcloud.com/user-818426052', role: null },
  { id: 'l9', label: 'X', url: 'https://x.com/Skeenmusic', role: null },
  { id: 'l10', label: 'Spotify', url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', role: null },
]
const SKEEN_ARTIST = { spotify_artist_id: '26KxuQlgIw8VP8YX2IkMWR', apple_artist_id: null, youtube_channel_id: 'Sskeen', bandsintown_name: null }

describe('connectedBios', () => {
  // A label that drifts (in OUTSIDE_BIOS or in Connections) would drop a bio without a word.
  it('every outside bio names exactly one connection', () => {
    for (const b of OUTSIDE_BIOS) expect(CONNECTIONS.filter((d) => d.label === b.label), b.key).toHaveLength(1)
    for (const b of OUTSIDE_BIOS) expect(bioConnection(b.label)?.label).toBe(b.label)
  })

  // Skeen's real links: seven bios, in OUTSIDE_BIOS order; the booking rows and the USB button are not profiles.
  it('Skeen: every connected platform with a bio, in OUTSIDE_BIOS order; no Bandsintown', () => {
    const bios = connectedBios(SKEEN_LINKS, SKEEN_ARTIST)
    expect(bios.map((b) => b.key)).toEqual(['spotify', 'instagram', 'soundcloud', 'youtube', 'tiktok', 'x', 'apple_music'])
    expect(bios.find((b) => b.key === 'instagram')).toMatchObject({ label: 'Instagram', url: 'https://www.instagram.com/skeeeeeeen/', edit: OUTSIDE_BIOS.find((b) => b.key === 'instagram')!.edit })
  })

  // Derived: one link (or source id) per outside bio connects them all.
  it('an artist with every platform connected gets every outside bio', () => {
    const links: { id: string; label: string; url: string; role: null }[] = []
    const artist: Record<string, string> = {}
    for (const b of OUTSIDE_BIOS) {
      const def = bioConnection(b.label)!
      if (def.social) links.push({ id: b.key, label: def.label, url: `${def.urlHint}someone`, role: null })
      else if (def.source?.idField) artist[def.source.idField] = 'someone'
    }
    expect(connectedBios(links, artist).map((b) => b.key)).toEqual(OUTSIDE_BIOS.map((b) => b.key))
  })

  // Nothing connected, nothing shown; a source id alone connects Apple Music and Bandsintown.
  it('Bandsintown and Apple Music only when connected, by a source id alone too', () => {
    expect(connectedBios([], {}).map((b) => b.key)).toEqual([])
    expect(connectedBios([], { bandsintown_name: 'Skeen', apple_artist_id: '1754431714' }).map((b) => b.key)).toEqual(['apple_music', 'bandsintown'])
  })

  // A platform label on a role-bound button or a mailto: is not that platform's profile.
  it('a contact row or a button bound to a site element is not a connection', () => {
    const links = [
      { id: 'a', label: 'Spotify', url: 'https://open.spotify.com/playlist/0MLdp3LsWM0uO2oryTniXi', role: 'usb' },
      { id: 'b', label: 'Instagram', url: 'mailto:hi@skeen.example', role: null },
    ]
    expect(connectedBios(links, {})).toEqual([])
  })
})

describe('bioRows and biosToCheck', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z')
  const bios = connectedBios(SKEEN_LINKS, SKEEN_ARTIST)
  const changes = factChanges(SKEEN_HISTORY)
  const input = (over: Partial<BiosInput> = {}): BiosInput => ({ bios, marks: {}, factsKnown: true, changes, ...over })

  // Each row reads ITS bio_<key> tick, never another item's.
  it('each row reads its own tick: bio_<key>', () => {
    const marks = { [bioItem('spotify')]: '2026-09-01T00:00:00.000Z', [bioItem('instagram')]: '2026-07-15T00:00:00.000Z', allmusic_bio: '2026-01-01T00:00:00.000Z' }
    const rows = bioRows(input({ marks }), now)!
    const state = Object.fromEntries(rows.map((r) => [r.key, r.state]))
    expect(state.spotify).toBe('current')
    expect(state.instagram).toBe('stale')
    expect(state.x).toBe('unconfirmed')
    expect(rows.find((r) => r.key === 'spotify')?.confirmedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  // Ticked Aug 15, bio changed Sep 1, city Sep 20: out of date since Sep 1 (the OLDEST change
  // after the tick), naming both. A tick between the two sees only the city; no tick, neither.
  it('CRITICAL: two changes after one tick: since the older, naming both; each row reads its own tick', () => {
    const history: ProfileRevision[] = [
      { published_at: '2026-09-20T12:00:00.000Z', data: { ...facts('Bio two.'), location: 'Detroit' } },
      { published_at: '2026-09-01T12:00:00.000Z', data: facts('Bio two.') },
      { published_at: '2026-08-01T12:00:00.000Z', data: facts('Bio one.') },
    ]
    const marks = { [bioItem('spotify')]: '2026-08-15T12:00:00.000Z', [bioItem('instagram')]: '2026-09-10T12:00:00.000Z' }
    const rows = bioRows(input({ marks, changes: factChanges(history) }), now)!
    const row = (k: string) => rows.find((r) => r.key === k)!
    expect(row('spotify')).toMatchObject({ state: 'stale', since: '2026-09-01T12:00:00.000Z', changed: ['bio', 'location'] })
    expect(row('instagram')).toMatchObject({ state: 'stale', since: '2026-09-20T12:00:00.000Z', changed: ['location'] })
    expect(row('x')).toMatchObject({ state: 'unconfirmed', since: null, changed: [] })
  })

  // The AI test's count: everything not current; 0 when all are ticked and nothing changed.
  it('the count: every row not current; nothing for a fine set', () => {
    const allTicked = Object.fromEntries(bios.map((b) => [bioItem(b.key), '2026-09-30T00:00:00.000Z']))
    expect(biosToCheck(bioRows(input({ marks: allTicked }), now))).toBe(0)
    const old = { ...allTicked, [bioItem('x')]: '2025-01-01T00:00:00.000Z', [bioItem('tiktok')]: '2026-07-15T00:00:00.000Z' }
    expect(biosToCheck(bioRows(input({ marks: old }), now))).toBe(2) // recheck + stale
    expect(biosToCheck(bioRows(input(), now))).toBe(bios.length) // none ticked
  })

  // Fail soft: a read that failed is "couldn't check", never a state and never counted.
  it('a failed read: no rows (links), or rows with no state (marks, profiles); none counted', () => {
    expect(bioRows(input({ bios: null }), now)).toBeNull()
    expect(biosToCheck(null)).toBe(0)
    for (const over of [{ marks: null }, { factsKnown: false }] satisfies Partial<BiosInput>[]) {
      const rows = bioRows(input(over), now)!
      expect(rows.map((r) => r.key)).toEqual(bios.map((b) => b.key))
      expect(rows.every((r) => r.state === null)).toBe(true)
      expect(biosToCheck(rows)).toBe(0)
    }
  })
})

describe('what the AI test read (bioReads)', () => {
  const r = (id: string, status: string, more: Record<string, unknown> = {}) => ({ id, status, value: 'no site link', sentence: 'your channel doesn’t link your site.', evidence: [], ...more })

  // The YouTube row reads the newest run's `youtube` result: a pass or a fail (with its lead) is the read.
  it('a pass or a fail of `youtube` is the YouTube row’s read', () => {
    expect(bioReads([r('mb', 'pass'), r('youtube', 'pass', { value: 'says who you are' })])).toEqual({ youtube: { status: 'pass', value: 'says who you are', sentence: 'your channel doesn’t link your site.' } })
    expect(bioReads([r('youtube', 'fail', { lead: 'Almost' })])).toEqual({ youtube: { status: 'fail', value: 'no site link', sentence: 'your channel doesn’t link your site.', lead: 'Almost' } })
  })

  // "Couldn't check", "doesn't apply", another test's result, a malformed row or no run at all is no read: the row keeps its manual state.
  it('anything else is no read', () => {
    for (const results of [[r('youtube', 'unknown')], [r('youtube', 'na')], [r('mb', 'pass')], [{ id: 'youtube', status: 'pass' }], [null], 'junk', null, undefined]) {
      expect(bioReads(results), JSON.stringify(results)).toEqual({})
    }
  })

  // bioRows hands the read to the YouTube row only; every other row has none.
  it('bioRows puts the read on its own row', () => {
    const bios = connectedBios([...SKEEN_LINKS, { id: 'yt', label: 'YouTube', url: 'https://www.youtube.com/@Sskeen', role: null }], SKEEN_ARTIST)
    const rows = bioRows({ bios, marks: {}, factsKnown: true, changes: [], reads: bioReads([r('youtube', 'pass')]) }, Date.now())!
    expect(rows.find((x) => x.key === 'youtube')?.read?.status).toBe('pass')
    expect(rows.filter((x) => x.key !== 'youtube').every((x) => x.read === null)).toBe(true)
  })
})

describe('dayLabel', () => {
  // "Sep 29" this year; "Sep 29, 2025" when it is not this year; nothing for a bad date.
  it('shows the year only when it is not this year', () => {
    const now = new Date(2026, 9, 1, 12)
    expect(dayLabel(new Date(2026, 8, 29, 12).toISOString(), now)).toBe('Sep 29')
    expect(dayLabel(new Date(2025, 8, 29, 12).toISOString(), now)).toBe('Sep 29, 2025')
    expect(dayLabel('not a date', now)).toBe('')
  })
})
