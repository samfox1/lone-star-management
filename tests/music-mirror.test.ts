/**
 * MIRROR TEST — "Released" is ONE rule with TWO implementations left. This file is the
 * only thing that stops them drifting silently:
 *
 *   1. @lone-star/music-rules  — releaseIsReleased / trackIsReleased, re-exported by
 *                                src/lib/music.ts as releaseBucket / trackBucket
 *   2. the SQL doors           — music_release_is_released / music_track_on_platform
 *
 * Both get the SAME fixtures and must return the SAME answer. Two real disagreements
 * were live when this file was written:
 *
 *   - the SQL mirror did not count `deezer_url`, so a manager-entered Deezer link made a
 *     song Released in the app and Unreleased in Postgres. Harmless only by accident —
 *     20260710170000 removed music_track_on_platform's last door caller, so it was a
 *     loaded gun with no trigger. Closed by 20260805120000.
 *   - the copilot (a THIRD, hand-kept TypeScript copy in lone-star-agent) used
 *     `inherited ?? own` — the PRE-20260710160000 NARROWING inheritance that the
 *     widen-only migration explicitly reverted — and omitted `released`,
 *     `soundcloud_url` and `deezer_url`. It reported a platform-linked song inside an
 *     Unreleased album as Unreleased, and did so in production for weeks.
 *
 * THE THIRD COPY IS GONE. It existed only because lone-star-agent is a separately
 * deployed package (own package.json, own Vercel build root) that could not import
 * `../src/lib/music` without escaping that root. The rule now lives in
 * `packages/music-rules`, an npm workspace package with zero dependencies that both the
 * Next app and the standalone Node agent depend on by name. `describe('one TypeScript
 * copy')` below proves that by REFERENCE IDENTITY — a re-added copy would be a
 * different function object and fail — and by scanning the agent's source for the
 * rule's shape.
 *
 * WHY THE SQL MIRROR STILL EXISTS (and is not deleted too): the public doors run
 * INSIDE Postgres. `get_public_site` and friends are SECURITY DEFINER functions that
 * decide Released-only visibility in the same query that reads the rows — anon never
 * executes our TypeScript, so the rule has to be expressible in SQL or the door cannot
 * enforce it. That copy is irreducible; this test is its leash.
 *
 * The SQL functions are revoked from anon/authenticated, so they are called with the
 * service-role client — this file asserts pure classification, never RLS.
 */
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { releaseBucket, trackBucket, type ReleaseProvenance, type TrackProvenance } from '@/lib/music'
import * as musicRules from '@lone-star/music-rules'
import { serviceClient } from './helpers/supabase'

const svc = serviceClient()

type TrackRow = TrackProvenance
type ReleaseRow = ReleaseProvenance

/** Every provenance column the rule reads, all empty — fixtures set one at a time. */
const TRACK_BASE: TrackRow = {
  release_id: null,
  source: 'manual',
  audio_path: null,
  spotify_id: null,
  apple_id: null,
  deezer_id: null,
  provider_url: null,
  stream_url: null,
  apple_url: null,
  soundcloud_url: null,
  deezer_url: null,
  released: false,
}

const RELEASE_BASE: ReleaseRow = { source: 'manual', spotify_id: null, links: [], released: false }

type TrackFixture = { name: string; row: TrackRow }
type ReleaseFixture = { name: string; row: ReleaseRow }

const trk = (name: string, over: Partial<TrackRow> = {}): TrackFixture => ({
  name,
  row: { ...TRACK_BASE, ...over },
})
const rel = (name: string, over: Partial<ReleaseRow> = {}): ReleaseFixture => ({
  name,
  row: { ...RELEASE_BASE, ...over },
})

// One fixture per column the rule reads. A column missing from this list is a column
// whose disagreement this test cannot see — that is exactly how deezer_url slipped.
const TRACKS: TrackFixture[] = [
  trk('bare manual (nothing set)'),
  trk('a platform source', { source: 'spotify' }),
  trk('a null source (never a manual add)', { source: null }),
  trk('spotify_id', { spotify_id: 'sp1' }),
  trk('apple_id', { apple_id: 'ap1' }),
  trk('deezer_id', { deezer_id: 'dz1' }),
  trk('provider_url', { provider_url: 'https://x/y' }),
  trk('stream_url', { stream_url: 'https://x/y' }),
  trk('apple_url', { apple_url: 'https://music.apple.com/x' }),
  trk('soundcloud_url', { soundcloud_url: 'https://soundcloud.com/x/y' }),
  trk('deezer_url', { deezer_url: 'https://www.deezer.com/track/1' }),
  trk('the manual released flag', { released: true }),
  trk('released explicitly false', { released: false }),
]

const RELEASES: ReleaseFixture[] = [
  rel('manual, no links'),
  rel('a platform source', { source: 'spotify' }),
  rel('a null source', { source: null }),
  rel('spotify_id', { spotify_id: 'sp1' }),
  rel('non-empty DSP links', { links: [{ label: 'Spotify', url: 'https://open.spotify.com/album/x' }] }),
  rel('empty links array', { links: [] }),
  rel('the manual released flag', { released: true }),
]

async function sqlTrack(row: unknown): Promise<boolean> {
  const { data, error } = await svc.rpc('music_track_on_platform', { d: row })
  if (error) throw new Error(`music_track_on_platform: ${error.message}`)
  return data as boolean
}
async function sqlRelease(row: unknown): Promise<boolean> {
  const { data, error } = await svc.rpc('music_release_is_released', { d: row })
  if (error) throw new Error(`music_release_is_released: ${error.message}`)
  return data as boolean
}

// Every SQL answer is fetched once, in parallel, so the assertions below stay synchronous
// (each fixture would otherwise cost a transatlantic round-trip inside its own `it`).
const sqlTrackAnswer = new Map<string, boolean>()
const sqlReleaseAnswer = new Map<string, boolean>()

beforeAll(async () => {
  await Promise.all([
    ...TRACKS.map(async (f) => sqlTrackAnswer.set(f.name, await sqlTrack(f.row))),
    ...RELEASES.map(async (f) => sqlReleaseAnswer.set(f.name, await sqlRelease(f.row))),
  ])
})

describe('releaseBucket mirrors music_release_is_released', () => {
  it.each(RELEASES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const ts = releaseBucket(f.row) === 'released'
    expect(sqlReleaseAnswer.get(f.name)).toBe(ts)
  })
})

describe('trackBucket (loose) mirrors music_track_on_platform', () => {
  it.each(TRACKS.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const ts = trackBucket(f.row) === 'released'
    expect(sqlTrackAnswer.get(f.name)).toBe(ts)
  })
})

/**
 * Release membership is WIDEN-ONLY in both: `own OR release`. The SQL doors spell it
 * out at the call site (`music_track_on_platform(t) or coalesce(rel.released, false)` —
 * 20260710160000), so the mirror here is that same composition. `inherited ?? own`
 * NARROWS, and is the bug this block exists to catch.
 */
describe('widen-only membership mirrors across both', () => {
  const linked = trk('platform-linked song', { spotify_id: 'sp1' })
  const bare = trk('bare manual song')
  const releasedAlbum = rel('released album', { spotify_id: 'al1' })
  const unreleasedAlbum = rel('unreleased album')

  const cases = [
    { name: 'bare song in a RELEASED album → released', t: bare, r: releasedAlbum },
    { name: 'linked song in an UNRELEASED album → released (never demoted)', t: linked, r: unreleasedAlbum },
    { name: 'bare song in an UNRELEASED album → unreleased', t: bare, r: unreleasedAlbum },
    { name: 'linked song in a RELEASED album → released', t: linked, r: releasedAlbum },
  ] as const

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const parented = { ...c.t.row, release_id: 'r1' }
    const releaseIsRel = releaseBucket(c.r.row) === 'released'
    const ts = trackBucket(parented, () => (releaseIsRel ? 'released' : 'unreleased')) === 'released'
    const sql = (await sqlTrack(parented)) || (await sqlRelease(c.r.row))
    expect(sql).toBe(ts)
    // The boolean-shaped entry point the agent calls must compose identically to the
    // bucket-shaped one the app calls — they are two faces of one function, and the
    // agent's face is the one that carried the narrowing bug.
    expect(musicRules.trackIsReleased(parented, releaseIsRel)).toBe(ts)
  })
})

/**
 * ONE TypeScript copy, enforced two ways. The copilot's copy went four weeks reporting
 * the wrong answer in production because nothing could see it; fixture agreement alone
 * cannot see a copy that is merely CORRECT TODAY, so this asserts single-sourcing itself.
 */
describe('one TypeScript copy', () => {
  // Reference identity: src/lib/music.ts must RE-EXPORT the package's functions, not
  // wrap or re-derive them. A reintroduced app-side copy is a different function object.
  it('src/lib/music.ts re-exports the package functions verbatim', () => {
    expect(releaseBucket).toBe(musicRules.releaseBucket)
    expect(trackBucket).toBe(musicRules.trackBucket)
  })

  // The agent is a separate deploy, so it cannot be checked by identity from here in a
  // way that survives it being bundled — its source is checked instead. `!== 'manual'`
  // is the rule's fingerprint: every copy of it, in every language, contains that test.
  it('lone-star-agent holds no copy of the rule, only DB wiring', () => {
    const src = readFileSync(new URL('../lone-star-agent/agent/lib/lonestar.ts', import.meta.url), 'utf8')
    expect(src).toContain('@lone-star/music-rules')
    expect(src).not.toMatch(/!==\s*["']manual["']/)
  })
})
